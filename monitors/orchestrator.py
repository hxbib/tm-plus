from __future__ import annotations

import asyncio
import signal
import sys
import time
import traceback

from api.client import TicketmasterClient
from api.key_rotator import APIKeyRotator
from api.auto_reserve import AutoReserver
from monitors.event_monitor import EventMonitor
from monitors.status_monitor import StatusMonitor
from notifications.discord import DiscordNotifier
from notifications.embeds import (
    build_heartbeat_embed,
    build_shutdown_embed,
    build_startup_embed,
)
from utils.logger import get_logger
from utils.state import StateManager
from utils.cookie_refresher import CookieRefresher
from utils.cookie_injector import CookieInjectorServer

log = get_logger("Orchestrator")

class MonitorOrchestrator:

    def __init__(self, config: dict):
        self._config = config
        self._monitor_config = config.get("monitor", {})
        self._start_time = time.time()

        self._key_rotator: APIKeyRotator | None = None
        self._client: TicketmasterClient | None = None
        self._notifier: DiscordNotifier | None = None
        self._state: StateManager | None = None
        self._auto_reserver: AutoReserver | None = None
        self._cookie_refresher: CookieRefresher | None = None

        self._event_monitors: list[EventMonitor] = []
        self._status_monitor: StatusMonitor | None = None
        self._cookie_injector: CookieInjectorServer | None = None

        self._heartbeat_task: asyncio.Task | None = None
        self._pulse_task: asyncio.Task | None = None
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        log.info("Initializing Ticketmaster+ components...")

        try:

            self._state = StateManager()
            await self._state.load()

            api_keys = self._config.get("api", {}).get("keys", [])
            cooldown = self._config.get("api", {}).get("key_cooldown", 5.5)
            self._key_rotator = APIKeyRotator(api_keys, cooldown)

            self._client = TicketmasterClient(self._config, self._key_rotator)
            await self._client.start()

            self._notifier = DiscordNotifier(self._config)
            await self._notifier.start()

            reserve_config = self._config.get("auto_reserve", {})
            if reserve_config.get("enabled", False):
                self._auto_reserver = AutoReserver(self._config)
                await self._auto_reserver.start()
                log.success(
                    f"Auto-reserve ENABLED — "
                    f"qty={reserve_config.get('quantity', 2)}, "
                    f"sort={reserve_config.get('sort', 'quality')}"
                )
            else:
                log.info("Auto-reserve is DISABLED (set auto_reserve.enabled=true to activate)")

            self._cookie_refresher = CookieRefresher(self._config, self._auto_reserver)
            await self._cookie_refresher.start()

            self._cookie_injector = CookieInjectorServer(
                self._config, self._auto_reserver, self._cookie_refresher
            )
            await self._cookie_injector.start()

            if self._monitor_config.get("startup_webhook", True):
                stats = await self._state.get_stats()
                embed = build_startup_embed(self._config, stats)
                await self._notifier.send(embed, notification_type="startup")

            attractions = self._config.get("attractions", [])
            polling_interval = self._monitor_config.get("polling_interval", 3.0)
            notification_config = self._config.get("notifications", {})

            for attraction in attractions:
                if not attraction.get("enabled", True):
                    log.info(f"Skipping disabled attraction: {attraction.get('name', 'Unknown')}")
                    continue

                if not attraction.get("attraction_id"):
                    log.warning(f"Skipping attraction with no ID: {attraction.get('name', 'Unknown')}")
                    continue

                monitor = EventMonitor(
                    attraction_config=attraction,
                    client=self._client,
                    notifier=self._notifier,
                    state=self._state,
                    polling_interval=polling_interval,
                    notification_config=notification_config,
                    auto_reserver=self._auto_reserver,
                )
                self._event_monitors.append(monitor)
                await monitor.start()

            if not self._event_monitors:
                log.warning("No event monitors started — check your config!")

            status_interval = self._monitor_config.get("status_check_interval", 30.0)
            self._status_monitor = StatusMonitor(
                config=self._config,
                client=self._client,
                notifier=self._notifier,
                state=self._state,
                check_interval=status_interval,
            )
            await self._status_monitor.start()

            if self._monitor_config.get("heartbeat_webhook", True):
                self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

            self._pulse_task = asyncio.create_task(self._pulse_loop())

            self._install_signal_handlers()

            ar_status = "ARMED" if self._auto_reserver else "OFF"
            log.success(
                f"Ticketmaster+ is ONLINE — "
                f"{len(self._event_monitors)} attraction(s) monitored, "
                f"auto-reserve {ar_status}"
            )

            polling_interval = self._monitor_config.get("polling_interval", 3.0)
            status_interval_log = self._monitor_config.get("status_check_interval", 30.0)
            log.info(
                f"Polling cadence: events every {polling_interval:.0f}s · "
                f"status checks every {status_interval_log:.0f}s · "
                f"first event poll in ~0.5s, first status check in ~10s"
            )

            await self._shutdown_event.wait()

        except Exception as e:
            log.error(f"Fatal startup error: {type(e).__name__}: {e}\n{traceback.format_exc()}")
            raise
        finally:
            await self._shutdown()

    def _install_signal_handlers(self) -> None:
        if sys.platform == "win32":

            def _win_handler(signum: int, _frame) -> None:
                try:
                    sig = signal.Signals(signum)
                except ValueError:
                    sig = signum
                self._signal_handler(sig)

            signal.signal(signal.SIGINT, _win_handler)
            if hasattr(signal, "SIGTERM"):
                try:
                    signal.signal(signal.SIGTERM, _win_handler)
                except (OSError, ValueError):
                    pass
            return

        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, self._signal_handler, sig)

    def _signal_handler(self, sig: signal.Signals | int) -> None:
        sig_name = sig.name if hasattr(sig, "name") else str(sig)
        log.warning(f"Received {sig_name} — initiating graceful shutdown...")
        self._shutdown_event.set()

    async def _shutdown(self) -> None:
        log.info("Shutting down Ticketmaster+...")

        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass

        if self._pulse_task:
            self._pulse_task.cancel()
            try:
                await self._pulse_task
            except asyncio.CancelledError:
                pass

        for monitor in self._event_monitors:
            await monitor.stop()

        if self._status_monitor:
            await self._status_monitor.stop()

        if (self._notifier and
                self._monitor_config.get("shutdown_webhook", True)):
            uptime = time.time() - self._start_time
            api_stats = self._client.get_stats() if self._client else {}
            state_stats = await self._state.get_stats() if self._state else {}
            combined_stats = {**api_stats, **state_stats}

            embed = build_shutdown_embed("Manual shutdown", combined_stats, uptime)
            await self._notifier.send(embed, notification_type="shutdown")

            await asyncio.sleep(1)

        if self._cookie_injector:
            await self._cookie_injector.stop()
        if self._cookie_refresher:
            await self._cookie_refresher.stop()
        if self._auto_reserver:
            await self._auto_reserver.close()

        if self._client:
            await self._client.close()

        if self._notifier:
            await self._notifier.stop()

        if self._state:
            await self._state.save()

        log.info("Ticketmaster+ has been shut down cleanly.")

    async def _pulse_loop(self) -> None:
        interval = float(self._monitor_config.get("pulse_interval", 900.0))
        if interval <= 0:
            return

        while True:
            try:
                await asyncio.sleep(interval)
                uptime = time.time() - self._start_time
                api_stats = self._client.get_stats() if self._client else {}
                total_cycles = sum(m.cycle_count for m in self._event_monitors)
                state_stats = await self._state.get_stats() if self._state else {}
                tracked_events = state_stats.get("tracked_events", 0)

                uptime_h = uptime / 3600
                uptime_str = (
                    f"{uptime_h:.1f}h" if uptime_h >= 1 else f"{uptime / 60:.1f}m"
                )
                log.info(
                    f"💓 Pulse: alive {uptime_str} · "
                    f"{total_cycles} poll cycle(s) across {len(self._event_monitors)} monitor(s) · "
                    f"{api_stats.get('total_requests', 0)} API requests · "
                    f"{tracked_events} event(s) tracked"
                )
            except asyncio.CancelledError:
                return
            except Exception as e:
                log.debug(f"Pulse loop error: {e}")

    async def _heartbeat_loop(self) -> None:
        interval = self._monitor_config.get("heartbeat_interval", 1800)
        log.info(f"Heartbeat loop started (interval: {interval}s)")

        while True:
            try:
                await asyncio.sleep(interval)

                uptime = time.time() - self._start_time
                api_stats = self._client.get_stats() if self._client else {}
                state_stats = await self._state.get_stats() if self._state else {}
                combined_stats = {**api_stats, **state_stats}

                attractions_status = []
                for monitor in self._event_monitors:
                    events = await self._state.get_events_for_attraction(
                        monitor.attraction_id
                    )
                    attractions_status.append({
                        "name": monitor.name,
                        "event_count": len(events),
                        "cycles": monitor.cycle_count,
                    })

                embed = build_heartbeat_embed(
                    combined_stats, uptime, attractions_status
                )
                await self._notifier.send(embed, notification_type="heartbeat")

            except asyncio.CancelledError:
                log.info("Heartbeat loop stopped")
                return
            except Exception as e:
                log.error(f"Heartbeat error: {e}")
