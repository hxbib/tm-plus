from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

from utils.logger import get_logger

log = get_logger("WebhookQueue")

QUEUE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "state")
QUEUE_FILE = os.path.join(QUEUE_DIR, "webhook_queue.json")

class WebhookQueue:

    def __init__(self):
        self._queue: list[dict] = []
        self._lock = asyncio.Lock()

    async def load(self) -> None:
        async with self._lock:
            os.makedirs(QUEUE_DIR, exist_ok=True)
            if os.path.exists(QUEUE_FILE):
                try:
                    with open(QUEUE_FILE, "r", encoding="utf-8") as f:
                        self._queue = json.load(f)
                    if self._queue:
                        log.info(f"Loaded {len(self._queue)} queued webhooks from disk")
                except (json.JSONDecodeError, IOError) as e:
                    log.warning(f"Failed to load webhook queue: {e}")
                    self._queue = []

    async def _save(self) -> None:
        try:
            os.makedirs(QUEUE_DIR, exist_ok=True)
            temp = QUEUE_FILE + ".tmp"
            with open(temp, "w", encoding="utf-8") as f:
                json.dump(self._queue, f, indent=2, default=str)
            os.replace(temp, QUEUE_FILE)
        except Exception as e:
            log.error(f"Failed to save webhook queue: {e}")

    async def enqueue(self, webhook_url: str, payload: dict,
                       priority: int = 0) -> None:
        async with self._lock:
            entry = {
                "webhook_url": webhook_url,
                "payload": payload,
                "queued_at": time.time(),
                "attempts": 0,
                "last_attempt": None,
                "priority": priority,
            }
            self._queue.append(entry)
            await self._save()
            log.info(f"Queued webhook (queue size: {len(self._queue)})")

    async def dequeue(self) -> dict | None:
        async with self._lock:
            if not self._queue:
                return None
            self._queue.sort(key=lambda x: (-x.get("priority", 0), x.get("queued_at", 0)))
            entry = self._queue.pop(0)
            entry["attempts"] = entry.get("attempts", 0) + 1
            entry["last_attempt"] = time.time()
            await self._save()
            return entry

    async def requeue(self, entry: dict) -> None:
        async with self._lock:
            self._queue.append(entry)
            await self._save()
            log.debug(f"Requeued webhook (attempt #{entry.get('attempts', 0)}, queue size: {len(self._queue)})")

    async def remove_completed(self, entry: dict) -> None:
        pass

    async def size(self) -> int:
        async with self._lock:
            return len(self._queue)

    async def peek(self) -> list[dict]:
        async with self._lock:
            return list(self._queue)

    async def clear(self) -> int:
        async with self._lock:
            count = len(self._queue)
            self._queue.clear()
            await self._save()
            return count
