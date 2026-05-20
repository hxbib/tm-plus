from __future__ import annotations

import asyncio
import traceback
import time

from api.client import TicketmasterClient, APIError
from models.event import Event
from notifications.discord import DiscordNotifier
from notifications.embeds import (
    build_error_embed,
    build_price_change_embed,
    build_status_change_embed,
)
from utils.logger import get_logger
from utils.state import StateManager

log = get_logger("StatusMonitor")

class StatusMonitor:

    def __init__(
        self,
        config: dict,
        client: TicketmasterClient,
        notifier: DiscordNotifier,
        state: StateManager,
        check_interval: float = 30.0,
    ):
        self._config = config
        self._client = client
        self._notifier = notifier
        self._state = state
        self._interval = check_interval
        self._notification_config = config.get("notifications", {})
        self._attractions_config = {
            a["attraction_id"]: a
            for a in config.get("attractions", [])
            if a.get("attraction_id")
        }

        self._running = False
        self._task: asyncio.Task | None = None
        self._cycle_count = 0
        self._changes_detected = 0
        self._last_pulse_ts: float = 0.0
        self._pulse_interval: float = 600.0

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        log.info(f"Status monitor started (interval: {self._interval}s)")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("Status monitor stopped")

    async def _monitor_loop(self) -> None:

        await asyncio.sleep(10)

        while self._running:
            try:
                await self._check_cycle()
            except asyncio.CancelledError:
                log.info("Status monitor loop cancelled")
                return
            except Exception as e:
                log.error(
                    f"Status monitor error: {type(e).__name__}: {e}\n"
                    f"{traceback.format_exc()}"
                )
            await asyncio.sleep(self._interval)

    async def _check_cycle(self) -> None:
        self._cycle_count += 1
        cycle_start = time.monotonic()
        all_events = await self._state.get_all_events()

        if not all_events:
            now = time.monotonic()
            if self._cycle_count <= 2 or (now - self._last_pulse_ts) >= self._pulse_interval:
                log.info(
                    f"Status check #{self._cycle_count}: no events to verify "
                    f"(monitor will populate on first event detection) "
                    f"— next in {self._interval:.0f}s"
                )
                self._last_pulse_ts = now
            return

        prior_changes = self._changes_detected
        errors = 0
        checked = 0

        for event_id, stored_data in all_events.items():
            if not self._running:
                return

            try:
                await self._check_event(event_id, stored_data)
                checked += 1
            except APIError as e:
                errors += 1
                log.debug(f"Status check failed for {event_id}: {e}")
            except Exception as e:
                errors += 1
                log.warning(f"Status check error for {event_id}: {e}")

            await asyncio.sleep(0.5)

        elapsed = time.monotonic() - cycle_start
        cycle_changes = self._changes_detected - prior_changes
        now = time.monotonic()
        time_for_pulse = (now - self._last_pulse_ts) >= self._pulse_interval

        if self._cycle_count <= 2 or time_for_pulse or cycle_changes or errors:
            log.info(
                f"Status check #{self._cycle_count}: "
                f"{checked}/{len(all_events)} events verified, "
                f"{cycle_changes} change(s){f', {errors} error(s)' if errors else ''} "
                f"— {elapsed:.2f}s — next in {self._interval:.0f}s"
            )
            self._last_pulse_ts = now

    async def _check_event(self, event_id: str, stored_data: dict) -> None:
        try:
            event = await self._client.get_event_details(event_id)
        except APIError:
            raise

        attraction_id = stored_data.get("attraction_id", "")
        attraction_config = self._attractions_config.get(attraction_id, {})

        old_status = stored_data.get("status", "unknown")
        new_status = event.status

        if old_status != new_status and old_status != "unknown":
            self._changes_detected += 1
            log.success(
                f"Status change for {event.name}: "
                f"{old_status} → {new_status}"
            )

            if self._notification_config.get("status_change", True):
                embed = build_status_change_embed(
                    event, old_status, new_status, attraction_config
                )
                await self._notifier.send(
                    embed,
                    notification_type="status_change",
                    priority=2,
                )

        old_min = stored_data.get("price_min")
        old_max = stored_data.get("price_max")
        new_min = event.price_min
        new_max = event.price_max

        price_changed = (
            (old_min is not None or old_max is not None) and
            (old_min != new_min or old_max != new_max)
        )

        if price_changed:
            self._changes_detected += 1
            log.info(
                f"Price change for {event.name}: "
                f"${old_min}-${old_max} → ${new_min}-${new_max}"
            )

            if self._notification_config.get("price_change", True):
                embed = build_price_change_embed(
                    event, old_min, old_max, new_min, new_max, attraction_config
                )
                await self._notifier.send(
                    embed,
                    notification_type="price_change",
                    priority=1,
                )

        old_sale_start = stored_data.get("sale_start")
        new_sale_start = event.sale_start

        if (old_sale_start and new_sale_start and
                old_sale_start != new_sale_start):
            self._changes_detected += 1
            log.info(
                f"Sale date change for {event.name}: "
                f"{old_sale_start} → {new_sale_start}"
            )

        await self._state.update_event(event_id, {
            "status": new_status,
            "name": event.name,
            "price_min": new_min,
            "price_max": new_max,
            "sale_start": new_sale_start,
            "sale_end": event.sale_end,
            "ticket_limit": event.ticket_limit,
        })

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "cycle_count": self._cycle_count,
            "changes_detected": self._changes_detected,
        }
