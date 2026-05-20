from __future__ import annotations

import asyncio
import json
import os
import time
from copy import deepcopy
from typing import Any

from utils.logger import get_logger

log = get_logger("State")

STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "state")
STATE_FILE = os.path.join(STATE_DIR, "state.json")

class StateManager:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._state: dict[str, Any] = {
            "attractions": {},
            "events": {},
            "seen_event_ids": {},
            "meta": {
                "last_startup": None,
                "total_events_detected": 0,
                "monitor_version": "v5.23.25",
            },
        }
        self._dirty = False

    async def load(self) -> None:
        async with self._lock:
            os.makedirs(STATE_DIR, exist_ok=True)
            if os.path.exists(STATE_FILE):
                try:
                    with open(STATE_FILE, "r", encoding="utf-8") as f:
                        saved = json.load(f)
                    for key in self._state:
                        if key in saved:
                            self._state[key] = saved[key]
                    log.info(f"Loaded state — {len(self._state.get('events', {}))} known events")
                except (json.JSONDecodeError, KeyError) as e:
                    log.warning(f"Can't load state file, starting fresh: {e}")
            else:
                log.info("No state file found — creating one and starting fresh")

            self._state["meta"]["last_startup"] = time.time()
            self._dirty = True
            await self._save_internal()

    async def _save_internal(self) -> None:
        if not self._dirty:
            return
        try:
            os.makedirs(STATE_DIR, exist_ok=True)
            temp_path = STATE_FILE + ".tmp"
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(self._state, f, indent=2, default=str)
            os.replace(temp_path, STATE_FILE)
            self._dirty = False
        except Exception as e:
            log.error(f"Failed to save state: {e}")

    async def save(self) -> None:
        async with self._lock:
            await self._save_internal()

    async def get_seen_event_ids(self, attraction_id: str) -> set[str]:
        async with self._lock:
            ids = self._state["seen_event_ids"].get(attraction_id, [])
            return set(ids)

    async def add_event(self, attraction_id: str, event_id: str, event_data: dict) -> None:
        async with self._lock:
            if attraction_id not in self._state["seen_event_ids"]:
                self._state["seen_event_ids"][attraction_id] = []

            if event_id not in self._state["seen_event_ids"][attraction_id]:
                self._state["seen_event_ids"][attraction_id].append(event_id)

            self._state["events"][event_id] = {
                "name": event_data.get("name", "Unknown"),
                "status": event_data.get("status", "unknown"),
                "attraction_id": attraction_id,
                "url": event_data.get("url", ""),
                "date": event_data.get("date", ""),
                "venue": event_data.get("venue_name", ""),
                "first_seen": time.time(),
                "last_checked": time.time(),
                "price_min": event_data.get("price_min"),
                "price_max": event_data.get("price_max"),
                "ticket_limit": event_data.get("ticket_limit"),
                "sale_start": event_data.get("sale_start"),
                "sale_end": event_data.get("sale_end"),
            }
            self._state["meta"]["total_events_detected"] += 1
            self._dirty = True
            await self._save_internal()
            log.success(f"Saved new event to state: {event_data.get('name', event_id)}")

    async def remove_event(self, attraction_id: str, event_id: str) -> dict | None:
        async with self._lock:
            event_data = self._state["events"].pop(event_id, None)
            if attraction_id in self._state["seen_event_ids"]:
                try:
                    self._state["seen_event_ids"][attraction_id].remove(event_id)
                except ValueError:
                    pass
            self._dirty = True
            await self._save_internal()
            return event_data

    async def get_event(self, event_id: str) -> dict | None:
        async with self._lock:
            return deepcopy(self._state["events"].get(event_id))

    async def update_event(self, event_id: str, updates: dict) -> None:
        async with self._lock:
            if event_id in self._state["events"]:
                self._state["events"][event_id].update(updates)
                self._state["events"][event_id]["last_checked"] = time.time()
                self._dirty = True
                await self._save_internal()

    async def update_event_status(self, event_id: str, new_status: str) -> None:
        await self.update_event(event_id, {"status": new_status})

    async def get_all_events(self) -> dict[str, dict]:
        async with self._lock:
            return deepcopy(self._state["events"])

    async def get_events_for_attraction(self, attraction_id: str) -> dict[str, dict]:
        async with self._lock:
            result = {}
            for eid, edata in self._state["events"].items():
                if edata.get("attraction_id") == attraction_id:
                    result[eid] = deepcopy(edata)
            return result

    async def get_upcoming_count(self, attraction_id: str) -> int | None:
        async with self._lock:
            data = self._state["attractions"].get(attraction_id, {})
            return data.get("upcoming_count")

    async def set_upcoming_count(self, attraction_id: str, count: int) -> None:
        async with self._lock:
            if attraction_id not in self._state["attractions"]:
                self._state["attractions"][attraction_id] = {}
            self._state["attractions"][attraction_id]["upcoming_count"] = count
            self._state["attractions"][attraction_id]["last_checked"] = time.time()
            self._dirty = True
            await self._save_internal()

    async def get_stats(self) -> dict:
        async with self._lock:
            return {
                "total_events_detected": self._state["meta"].get("total_events_detected", 0),
                "tracked_events": len(self._state["events"]),
                "tracked_attractions": len(self._state["attractions"]),
                "last_startup": self._state["meta"].get("last_startup"),
            }
