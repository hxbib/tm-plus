from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from curl_cffi.requests import AsyncSession

from notifications.queue import WebhookQueue
from utils.logger import get_logger

log = get_logger("Discord")

class DiscordNotifier:

    def __init__(self, config: dict):
        self._config = config
        discord_cfg = config.get("discord", {})
        self._webhook_url = discord_cfg.get("webhook_url", "")
        self._error_webhook_url = discord_cfg.get("error_webhook_url", "") or self._webhook_url
        self._username = discord_cfg.get("username", "Ticketmaster+")
        self._avatar_url = discord_cfg.get("avatar_url", "")
        self._max_retries = discord_cfg.get("max_retries", 10)
        self._rate_limit_buffer = discord_cfg.get("rate_limit_buffer", 0.5)
        self._queue_retry_interval = discord_cfg.get("queue_retry_interval", 15)

        self._webhook_routes: dict[str, str] = discord_cfg.get("webhook_routes", {})

        self._queue = WebhookQueue()
        self._session: AsyncSession | None = None
        self._drain_task: asyncio.Task | None = None
        self._rate_limit_reset: float = 0.0
        self._rate_limit_remaining: int = 5

        self._total_sent = 0
        self._total_failed = 0
        self._total_queued = 0

        self._notification_config = config.get("notifications", {})

    async def start(self) -> None:
        await self._queue.load()
        self._session = AsyncSession(
            impersonate="chrome",
            timeout=15,
        )

        self._drain_task = asyncio.create_task(self._drain_loop())
        log.info("Discord notifier initialized")

        if not self._webhook_url:
            log.warning("No Discord webhook URL configured — notifications will be queued only")

    async def stop(self) -> None:
        if self._drain_task:
            self._drain_task.cancel()
            try:
                await self._drain_task
            except asyncio.CancelledError:
                pass

        if self._session:
            await self._session.close()
            self._session = None

        queue_size = await self._queue.size()
        if queue_size > 0:
            log.warning(f"Shutting down with {queue_size} webhooks still queued")
        log.info("Discord notifier stopped")

    def _is_enabled(self, notification_type: str) -> bool:
        return self._notification_config.get(notification_type, True)

    async def send(self, embed: dict, webhook_url: str | None = None,
                    notification_type: str = "", priority: int = 0) -> bool:

        if notification_type and not self._is_enabled(notification_type):
            log.debug(f"Notification type '{notification_type}' is disabled, skipping")
            return True

        url = webhook_url or self._webhook_routes.get(notification_type, "") or self._webhook_url
        if not url:
            log.warning("No webhook URL — queuing embed")
            await self._queue_webhook(url, embed, priority)
            return False

        payload = self._build_payload(embed)
        return await self._send_with_retry(url, payload, priority)

    async def send_error(self, embed: dict) -> bool:
        if not self._is_enabled("error_alerts"):
            return True

        url = self._error_webhook_url or self._webhook_url
        if not url:
            await self._queue_webhook(url, embed, priority=1)
            return False

        payload = self._build_payload(embed)
        return await self._send_with_retry(url, payload, priority=1)

    def _build_payload(self, embed: dict) -> dict:
        payload = {
            "embeds": [embed],
        }
        if self._username:
            payload["username"] = self._username
        if self._avatar_url:
            payload["avatar_url"] = self._avatar_url
        return payload

    async def _send_with_retry(self, url: str, payload: dict,
                                 priority: int = 0) -> bool:
        if not self._session:
            self._session = AsyncSession(impersonate="chrome", timeout=15)

        for attempt in range(1, self._max_retries + 1):
            try:

                await self._wait_for_rate_limit()

                response = await self._session.post(
                    url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=15,
                )

                self._update_rate_limits(response)

                status = response.status_code

                if status in (200, 204):
                    self._total_sent += 1
                    title = payload.get("embeds", [{}])[0].get("title", "Unknown")
                    log.success(f"Webhook sent: {title}")
                    return True

                elif status == 429:
                    try:
                        body = response.json()
                        retry_after = body.get("retry_after", 5.0)
                    except (json.JSONDecodeError, ValueError):
                        retry_after = float(response.headers.get("Retry-After", "5"))

                    log.warning(
                        f"Discord rate limited — waiting {retry_after}s "
                        f"[attempt {attempt}/{self._max_retries}]"
                    )
                    await asyncio.sleep(retry_after + self._rate_limit_buffer)
                    continue

                elif status >= 500:
                    delay = min(2 ** attempt, 30)
                    log.warning(
                        f"Discord server error ({status}) — retrying in {delay}s "
                        f"[attempt {attempt}/{self._max_retries}]"
                    )
                    await asyncio.sleep(delay)
                    continue

                else:
                    log.error(f"Discord webhook error ({status}): {response.text[:300]}")
                    self._total_failed += 1

                    if status == 400:
                        log.error(f"Bad request — payload may be malformed, not queuing")
                        return False
                    break

            except asyncio.CancelledError:
                raise
            except Exception as e:
                delay = min(2 ** attempt, 30)
                log.error(
                    f"Discord request failed: {type(e).__name__}: {e} — "
                    f"retrying in {delay}s [attempt {attempt}/{self._max_retries}]"
                )
                await asyncio.sleep(delay)

        log.warning(f"All {self._max_retries} attempts failed — queuing webhook")
        await self._queue_webhook(url, payload, priority)
        return False

    def _update_rate_limits(self, response) -> None:
        try:
            remaining = response.headers.get("X-RateLimit-Remaining")
            if remaining is not None:
                self._rate_limit_remaining = int(remaining)

            reset = response.headers.get("X-RateLimit-Reset")
            if reset is not None:
                self._rate_limit_reset = float(reset)

            reset_after = response.headers.get("X-RateLimit-Reset-After")
            if reset_after is not None:
                self._rate_limit_reset = time.time() + float(reset_after)
        except (ValueError, TypeError):
            pass

    async def _wait_for_rate_limit(self) -> None:
        if self._rate_limit_remaining <= 1 and self._rate_limit_reset > time.time():
            wait = self._rate_limit_reset - time.time() + self._rate_limit_buffer
            if wait > 0:
                log.debug(f"Preemptive rate limit wait: {wait:.2f}s")
                await asyncio.sleep(wait)

    async def _queue_webhook(self, url: str, payload: dict, priority: int = 0) -> None:
        self._total_queued += 1
        await self._queue.enqueue(url or self._webhook_url, payload, priority)

    async def _drain_loop(self) -> None:
        log.info(f"Queue drain loop started (interval: {self._queue_retry_interval}s)")
        while True:
            try:
                await asyncio.sleep(self._queue_retry_interval)

                queue_size = await self._queue.size()
                if queue_size == 0:
                    continue

                log.info(f"Draining webhook queue ({queue_size} items)")

                for _ in range(min(5, queue_size)):
                    entry = await self._queue.dequeue()
                    if not entry:
                        break

                    url = entry.get("webhook_url", self._webhook_url)
                    payload = entry.get("payload", {})
                    attempts = entry.get("attempts", 0)

                    if attempts > self._max_retries:
                        log.error(
                            f"Dropping webhook after {attempts} attempts — "
                            f"title: {payload.get('embeds', [{}])[0].get('title', 'Unknown')}"
                        )
                        continue

                    if not url:
                        log.warning("Queued webhook has no URL — dropping")
                        continue

                    try:
                        await self._wait_for_rate_limit()

                        if not self._session:
                            self._session = AsyncSession(impersonate="chrome", timeout=15)

                        response = await self._session.post(
                            url,
                            json=payload,
                            headers={"Content-Type": "application/json"},
                            timeout=15,
                        )
                        self._update_rate_limits(response)

                        if response.status_code in (200, 204):
                            self._total_sent += 1
                            title = payload.get("embeds", [{}])[0].get("title", "Unknown")
                            log.success(f"Queued webhook sent: {title} (attempt #{attempts})")
                        elif response.status_code == 429:
                            try:
                                body = response.json()
                                retry_after = body.get("retry_after", 5.0)
                            except (json.JSONDecodeError, ValueError):
                                retry_after = 5.0
                            log.warning(f"Queue drain rate limited — waiting {retry_after}s")
                            await self._queue.requeue(entry)
                            await asyncio.sleep(retry_after)
                            break
                        else:
                            log.warning(f"Queue drain failed ({response.status_code}) — requeuing")
                            await self._queue.requeue(entry)

                    except asyncio.CancelledError:

                        await self._queue.requeue(entry)
                        raise
                    except Exception as e:
                        log.error(f"Queue drain error: {e} — requeuing")
                        await self._queue.requeue(entry)

            except asyncio.CancelledError:
                log.info("Queue drain loop stopped")
                return
            except Exception as e:
                log.error(f"Queue drain loop error: {e}")
                await asyncio.sleep(self._queue_retry_interval)

    def get_stats(self) -> dict:
        return {
            "total_sent": self._total_sent,
            "total_failed": self._total_failed,
            "total_queued": self._total_queued,
        }
