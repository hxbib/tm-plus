from __future__ import annotations

import asyncio
import traceback
import time

from api.client import TicketmasterClient, APIError
from api.auto_reserve import AutoResearchOnly
from models.event import Event
from notifications.discord import DiscordNotifier
from notifications.embeds import (
    build_error_embed,
    build_event_removed_embed,
    build_new_event_embed,
    build_reserve_success_embed,
    build_reserve_failure_embed,
)
from utils.logger import get_logger
from utils.state import StateManager

log = get_logger("EventMonitor")

class EventMonitor:

    def __init__(
        self,
        attraction_config: dict,
        client: TicketmasterClient,
        notifier: DiscordNotifier,
        state: StateManager,
        polling_interval: float = 3.0,
        notification_config: dict | None = None,
        auto_researchOnly: AutoResearchOnly | None = None,
    ):
        self._config = attraction_config
        self._client = client
        self._notifier = notifier
        self._state = state
        self._interval = polling_interval
        self._notification_config = notification_config or {}
        self._auto_researchOnly = auto_researchOnly

        self._attraction_id = attraction_config.get("attraction_id", "")
        self._name = attraction_config.get("name", "Unknown")
        self._short_name = self._name[:32].rstrip()
        self._running = False
        self._task: asyncio.Task | None = None
        self._cycle_count = 0
        self._last_error: str | None = None
        self._consecutive_errors = 0
        self._last_pulse_ts: float = 0.0
        self._pulse_interval: float = 300.0
        self._last_known_event_count: int = -1
        self._total_cycle_time: float = 0.0

    @property
    def name(self) -> str:
        return self._name

    @property
    def attraction_id(self) -> str:
        return self._attraction_id

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def cycle_count(self) -> int:
        return self._cycle_count

    async def start(self) -> None:
        if not self._attraction_id:
            log.warning(f"Skipping {self._name} — no attraction ID configured")
            return

        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        log.info(f"Started monitoring: {self._name} ({self._attraction_id})")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info(f"Stopped monitoring: {self._name}")

    async def _monitor_loop(self) -> None:

        await asyncio.sleep(0.5)

        while self._running:
            try:
                await self._poll_cycle()
                self._consecutive_errors = 0
                self._last_error = None
            except asyncio.CancelledError:
                log.info(f"Monitor loop cancelled: {self._name}")
                return
            except APIError as e:
                self._consecutive_errors += 1
                self._last_error = str(e)
                log.error(
                    f"API error in monitor cycle for {self._name}: {e} "
                    f"(consecutive errors: {self._consecutive_errors})"
                )

                if self._consecutive_errors == 3:
                    await self._send_error_notification(e)

                backoff = min(self._interval * (2 ** min(self._consecutive_errors, 5)), 60)
                await asyncio.sleep(backoff)
                continue
            except Exception as e:
                self._consecutive_errors += 1
                self._last_error = str(e)
                log.error(
                    f"Unexpected error in monitor cycle for {self._name}: "
                    f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
                )
                if self._consecutive_errors == 3:
                    await self._send_error_notification(e)

                backoff = min(self._interval * (2 ** min(self._consecutive_errors, 5)), 60)
                await asyncio.sleep(backoff)
                continue

            await asyncio.sleep(self._interval)

    async def _poll_cycle(self) -> None:
        self._cycle_count += 1
        cycle_start = time.monotonic()

        events = await self._client.search_events(self._attraction_id)
        current_event_ids = {e.id for e in events}
        known_event_ids = await self._state.get_seen_event_ids(self._attraction_id)

        new_ids = current_event_ids - known_event_ids
        if new_ids:
            log.success(
                f"🎟️  {len(new_ids)} NEW EVENT(S) for {self._name}!"
            )
            for event in events:
                if event.id in new_ids:
                    await self._handle_new_event(event)

        status_changes = 0
        for event in events:
            if event.id in new_ids:
                continue

            stored = await self._state.get_event(event.id)
            if not stored:
                continue

            old_status = stored.get("status", "")
            new_status = event.status or ""

            if old_status and new_status and old_status != new_status:
                status_changes += 1
                log.success(
                    f"🔔 Status change for {event.name}: "
                    f"{old_status} → {new_status}"
                )

                await self._state.update_event_status(
                    event.id, new_status
                )

                if self._notification_config.get("status_change", True):
                    from notifications.embeds import build_status_change_embed
                    embed = build_status_change_embed(
                        event, old_status, new_status, self._config
                    )
                    await self._notifier.send(
                        embed,
                        notification_type="status_change",
                        priority=3,
                    )

                if (new_status == "onsale" and
                        old_status in ("offsale", "rescheduled", "") and
                        self._auto_researchOnly and
                        self._auto_researchOnly.enabled and
                        event.tm_us_id):
                    log.success(
                        f"🎯 STATUS → ONSALE! Triggering auto-reserve: "
                        f"{event.name}"
                    )
                    await self._auto_reserve(event)

        removed_count = 0
        if self._notification_config.get("event_removed", True):
            removed_ids = known_event_ids - current_event_ids
            removed_count = len(removed_ids)
            if removed_ids:
                log.warning(f"⚠️  {removed_count} event(s) removed for {self._name}")
                for eid in removed_ids:
                    await self._handle_removed_event(eid)

        attraction_count_changed = False
        try:
            attraction = await self._client.get_attraction(self._attraction_id)
            current_count = attraction.upcoming_events_count
            last_count = await self._state.get_upcoming_count(self._attraction_id)

            if last_count is not None and current_count > last_count:
                attraction_count_changed = True
                log.success(
                    f"📈 Upcoming events count increased: "
                    f"{last_count} → {current_count} for {self._name}"
                )

            await self._state.set_upcoming_count(self._attraction_id, current_count)

        except APIError as e:
            log.warning(f"Attraction detail check failed for {self._name}: {e}")

        elapsed = time.monotonic() - cycle_start
        self._total_cycle_time += elapsed
        self._emit_cycle_log(
            elapsed=elapsed,
            active_count=len(current_event_ids),
            known_count=len(known_event_ids),
            new_count=len(new_ids),
            status_changes=status_changes,
            removed_count=removed_count,
            forced=attraction_count_changed,
        )

    def _emit_cycle_log(
        self,
        elapsed: float,
        active_count: int,
        known_count: int,
        new_count: int,
        status_changes: int,
        removed_count: int,
        forced: bool,
    ) -> None:
        now = time.monotonic()
        is_first_cycles = self._cycle_count <= 3
        count_changed = active_count != self._last_known_event_count
        time_for_pulse = (now - self._last_pulse_ts) >= self._pulse_interval

        had_change = bool(new_count or status_changes or removed_count)

        should_log = (
            is_first_cycles
            or time_for_pulse
            or count_changed
            or forced
            or had_change
        )

        if not should_log:
            return

        avg_cycle = self._total_cycle_time / max(self._cycle_count, 1)

        parts = [
            f"[{self._short_name}]",
            f"cycle #{self._cycle_count}:",
            f"{active_count} active",
        ]
        if known_count != active_count:
            parts.append(f"({known_count} known)")
        if new_count:
            parts.append(f"+{new_count} NEW")
        if status_changes:
            parts.append(f"{status_changes} status change(s)")
        if removed_count:
            parts.append(f"-{removed_count} removed")
        parts.append(f"— {elapsed:.2f}s")
        if self._cycle_count > 1:
            parts.append(f"(avg {avg_cycle:.2f}s)")
        parts.append(f"— next in {self._interval:.0f}s")

        log.info(" ".join(parts))

        self._last_pulse_ts = now
        self._last_known_event_count = active_count

    async def _handle_new_event(self, event: Event) -> None:
        log.success(
            f"  ├─ Event: {event.name}\n"
            f"  ├─ Date:  {event.date_formatted}\n"
            f"  ├─ Venue: {event.venue_name} ({event.venue_location})\n"
            f"  ├─ Status: {event.status}\n"
            f"  ├─ Price: {event.price_display}\n"
            f"  ├─ Limit: {event.ticket_limit_display}\n"
            f"  ├─ URL:   {event.url}\n"
            f"  └─ ID:    {event.id} (TM-US: {event.tm_us_id})"
        )

        try:
            detailed_event = await self._client.get_event_details(event.id)

            if detailed_event.price_min is not None and event.price_min is None:
                event = detailed_event
            elif detailed_event.sale_start and not event.sale_start:
                event = detailed_event
        except APIError:
            pass

        await self._state.add_event(
            self._attraction_id,
            event.id,
            event.to_state_dict(),
        )

        if self._notification_config.get("new_event", True):
            embed = build_new_event_embed(event, self._config)
            await self._notifier.send(
                embed,
                notification_type="new_event",
                priority=2,
            )

        if (self._auto_researchOnly and
                self._auto_researchOnly.enabled and
                event.tm_us_id):
            if event.status == "onsale":
                await self._auto_reserve(event)
            elif event.status in ("offsale", "rescheduled"):
                log.info(
                    f"⏳ Event is '{event.status}' — will auto-reserve "
                    f"when status changes to onsale: {event.name}"
                )

    async def _auto_reserve(self, event: Event) -> None:
        log.info(f"🎯 AUTO-RESERVE triggered for: {event.name} ({event.tm_us_id})")

        try:
            result = await self._auto_researchOnly.reserve_best_seats(
                event_id=event.id,
                tm_us_event_id=event.tm_us_id,
            )

            if result.success:
                log.success(
                    f"🎫 AUTO-RESERVE SUCCESS!\n"
                    f"  ├─ Section: {result.seat_pick.section}\n"
                    f"  ├─ Row: {result.seat_pick.row}\n"
                    f"  ├─ Seats: {', '.join(result.seat_pick.seats)}\n"
                    f"  ├─ Price: ${result.seat_pick.total_price:.2f}/ea\n"
                    f"  ├─ Research ID: {result.request_id}\n"
                    f"  └─ Checkout: {result.checkout_url}"
                )

                embed = build_reserve_success_embed(event, result, self._config)
                await self._notifier.send(
                    embed,
                    notification_type="auto_reserve",
                    priority=10,
                )
            else:
                log.warning(
                    f"⚠️ AUTO-RESERVE FAILED: {result.error_message} ({result.error_code})"
                )

                embed = build_reserve_failure_embed(event, result, self._config)
                await self._notifier.send(
                    embed,
                    notification_type="auto_reserve",
                    priority=5,
                )

        except Exception as e:
            log.error(
                f"Auto-reserve error: {type(e).__name__}: {e}\n"
                f"{traceback.format_exc()}"
            )

    async def _handle_removed_event(self, event_id: str) -> None:
        event_data = await self._state.get_event(event_id)
        if event_data:
            log.warning(
                f"  ├─ Removed: {event_data.get('name', event_id)}\n"
                f"  └─ Was: {event_data.get('status', 'unknown')}"
            )

            embed = build_event_removed_embed(event_data, self._config)
            await self._notifier.send(
                embed,
                notification_type="event_removed",
                priority=1,
            )

        await self._state.remove_event(self._attraction_id, event_id)

    async def _send_error_notification(self, error: Exception) -> None:
        embed = build_error_embed(
            error_type=type(error).__name__,
            error_message=str(error),
            details=f"Attraction: {self._name}\nConsecutive errors: {self._consecutive_errors}",
            module="EventMonitor",
        )
        await self._notifier.send_error(embed)

    def get_status(self) -> dict:
        return {
            "name": self._name,
            "attraction_id": self._attraction_id,
            "running": self._running,
            "cycle_count": self._cycle_count,
            "consecutive_errors": self._consecutive_errors,
            "last_error": self._last_error,
        }
