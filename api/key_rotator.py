from __future__ import annotations

import asyncio
import time

from utils.logger import get_logger

log = get_logger("KeyRotator")

class APIKeyRotator:

    def __init__(self, keys: list[str], cooldown: float = 5.5):
        if not keys:
            raise ValueError("At least one API key is required")

        self._keys = keys
        self._cooldown = cooldown
        self._last_used: dict[str, float] = {key: 0.0 for key in keys}
        self._index = 0
        self._lock = asyncio.Lock()
        self._total_requests = 0

        log.info(f"Initialized with {len(keys)} keys, {cooldown}s cooldown per key")
        log.info(f"Theoretical max throughput: {len(keys) / cooldown:.2f} req/s")

    @property
    def total_requests(self) -> int:
        return self._total_requests

    @property
    def key_count(self) -> int:
        return len(self._keys)

    async def get_key(self) -> str:
        max_attempts = len(self._keys) * 2
        attempts = 0

        while attempts < max_attempts:
            wait_time = 0.0

            async with self._lock:
                now = time.monotonic()
                for i in range(len(self._keys)):
                    idx = (self._index + i) % len(self._keys)
                    key = self._keys[idx]
                    elapsed = now - self._last_used[key]

                    if elapsed >= self._cooldown:
                        self._last_used[key] = now
                        self._index = (idx + 1) % len(self._keys)
                        self._total_requests += 1

                        key_preview = f"{key[:4]}...{key[-4:]}"
                        log.debug(
                            f"Key #{idx} ({key_preview}) — "
                            f"idle {elapsed:.1f}s — "
                            f"request #{self._total_requests}"
                        )
                        return key

                soonest_remaining = min(
                    self._cooldown - (now - self._last_used[k]) for k in self._keys
                )
                wait_time = max(soonest_remaining, 0.05)
                log.debug(f"All keys in cooldown, waiting {wait_time:.2f}s")

            await asyncio.sleep(wait_time)
            attempts += 1

        log.warning("Key rotation exhausted all attempts, using first key")
        async with self._lock:
            key = self._keys[0]
            self._last_used[key] = time.monotonic()
            self._total_requests += 1
            return key

    def get_stats(self) -> dict:
        now = time.monotonic()
        active_keys = sum(
            1 for key in self._keys
            if (now - self._last_used[key]) < self._cooldown
        )
        return {
            "total_keys": len(self._keys),
            "active_keys": active_keys,
            "available_keys": len(self._keys) - active_keys,
            "total_requests": self._total_requests,
            "cooldown": self._cooldown,
        }
