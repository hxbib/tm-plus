from __future__ import annotations

import asyncio
import json
import random
import time
from typing import Any

from curl_cffi.requests import AsyncSession, Response

from api.endpoints import (
    attraction_detail_url,
    event_detail_url,
    event_images_url,
    event_search_url,
)
from api.key_rotator import APIKeyRotator
from models.attraction import Attraction
from models.event import Event
from utils.logger import get_logger

log = get_logger("APIClient")

class APIError(Exception):

    def __init__(self, message: str, status_code: int | None = None,
                 response_body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body

class RateLimitError(APIError):
    pass

class TicketmasterClient:

    def __init__(self, config: dict, key_rotator: APIKeyRotator):
        self._config = config
        self._rotator = key_rotator
        self._timeout = config.get("api", {}).get("request_timeout", 15)
        self._max_retries = config.get("api", {}).get("max_retries", 3)
        self._retry_base = config.get("api", {}).get("retry_base_delay", 1.0)
        self._retry_max = config.get("api", {}).get("retry_max_delay", 30.0)
        self._log_responses = config.get("logging", {}).get("log_api_responses", False)
        self._session: AsyncSession | None = None
        self._request_count = 0
        self._error_count = 0

    PROFILES = ["chrome120", "chrome123", "chrome124", "safari17_0"]

    async def start(self) -> None:
        profile = random.choice(self.PROFILES)
        self._session = AsyncSession(
            impersonate=profile,
            timeout=self._timeout,
            verify=True,
        )
        log.info(f"HTTP session initialized (TLS profile: {profile})")

    async def close(self) -> None:
        if self._session:
            await self._session.close()
            self._session = None
            log.info("HTTP session closed")

    async def _request(self, url: str, params: dict | None = None) -> dict:
        if not self._session:
            await self.start()

        params = params or {}
        last_error: Exception | None = None

        for attempt in range(1, self._max_retries + 1):
            api_key = await self._rotator.get_key()
            request_params = {**params, "apikey": api_key}

            try:
                self._request_count += 1
                start_time = time.monotonic()

                response: Response = await self._session.get(
                    url,
                    params=request_params,
                    timeout=self._timeout,
                )

                elapsed = time.monotonic() - start_time
                status = response.status_code

                log.debug(
                    f"GET {url.split('/')[-1].split('?')[0]} → "
                    f"{status} ({elapsed:.2f}s) "
                    f"[attempt {attempt}/{self._max_retries}]"
                )

                if 200 <= status < 300:
                    rl_avail = response.headers.get("Rate-Limit-Available")
                    rl_over = response.headers.get("Rate-Limit-Over")
                    if rl_avail is not None:
                        try:
                            avail = int(rl_avail)
                            if avail < 100:
                                log.warning(f"API key quota low: {avail} remaining")
                            elif avail < 500:
                                log.debug(f"API key quota: {avail} remaining")
                        except ValueError:
                            pass
                    if rl_over and rl_over != "0":
                        log.warning(f"API key OVER quota by {rl_over} requests")

                    try:
                        data = response.json()
                    except (json.JSONDecodeError, ValueError):
                        data = {"_raw": response.text}

                    if self._log_responses:
                        log.debug(f"Response: {json.dumps(data, indent=2)[:500]}")

                    return data

                elif status == 429:
                    retry_after = response.headers.get("Retry-After", "5")
                    try:
                        wait = float(retry_after)
                    except ValueError:
                        wait = 5.0
                    log.warning(
                        f"Rate limited (429) — waiting {wait}s "
                        f"[attempt {attempt}/{self._max_retries}]"
                    )
                    await asyncio.sleep(wait)
                    last_error = RateLimitError(
                        f"Rate limited on attempt {attempt}",
                        status_code=429,
                    )
                    continue

                elif status == 401:
                    log.warning(
                        f"Unauthorized (401) on key {api_key[:4]}...{api_key[-4:]} "
                        f"— rotating to next key [attempt {attempt}/{self._max_retries}]"
                    )
                    last_error = APIError(
                        "Unauthorized — invalid API key",
                        status_code=401,
                        response_body=response.text[:500],
                    )
                    await asyncio.sleep(min(1.0 * attempt, 5.0))
                    continue

                elif status >= 500:
                    delay = min(
                        self._retry_base * (2 ** (attempt - 1)),
                        self._retry_max,
                    )
                    log.warning(
                        f"Server error ({status}) — retrying in {delay:.1f}s "
                        f"[attempt {attempt}/{self._max_retries}]"
                    )
                    await asyncio.sleep(delay)
                    last_error = APIError(
                        f"Server error {status}",
                        status_code=status,
                        response_body=response.text[:500],
                    )
                    continue

                else:
                    self._error_count += 1
                    log.error(
                        f"Request failed ({status}): {response.text[:200]}"
                    )
                    last_error = APIError(
                        f"Request failed with status {status}",
                        status_code=status,
                        response_body=response.text[:500],
                    )
                    break

            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._error_count += 1
                delay = min(
                    self._retry_base * (2 ** (attempt - 1)),
                    self._retry_max,
                )
                log.error(
                    f"Request exception: {type(e).__name__}: {e} — "
                    f"retrying in {delay:.1f}s "
                    f"[attempt {attempt}/{self._max_retries}]"
                )
                await asyncio.sleep(delay)
                last_error = e

        raise APIError(
            f"All {self._max_retries} attempts failed for {url}",
            status_code=getattr(last_error, "status_code", None),
        )

    async def search_events(
        self,
        attraction_id: str,
        country_code: str = "US",
        size: int = 200,
        include_tba: bool = True,
        include_tbd: bool = True,
    ) -> list[Event]:
        params = {
            "attractionId": attraction_id,
            "countryCode": country_code,
            "size": size,
            "sort": "date,asc",
            "includeTBA": "yes" if include_tba else "no",
            "includeTBD": "yes" if include_tbd else "no",
            "locale": "en-us",
        }

        log.debug(f"Searching events for attraction {attraction_id}")

        try:
            data = await self._request(event_search_url(), params)
        except APIError as e:
            log.error(f"Event search failed for {attraction_id}: {e}")
            raise

        events_data = data.get("_embedded", {}).get("events", [])
        events = []
        for ed in events_data:
            try:
                events.append(Event.from_api_response(ed))
            except Exception as e:
                log.warning(f"Failed to parse event: {e}")

        log.debug(f"Found {len(events)} events for attraction {attraction_id}")
        return events

    async def get_event_details(self, event_id: str) -> Event:
        log.debug(f"Fetching event details for {event_id}")

        try:
            data = await self._request(
                event_detail_url(event_id),
                params={
                    "locale": "en-us",
                    "includeTBA": "yes",
                    "includeTBD": "yes",
                },
            )
        except APIError as e:
            log.error(f"Event detail fetch failed for {event_id}: {e}")
            raise

        return Event.from_api_response(data)

    async def get_attraction(self, attraction_id: str) -> Attraction:
        log.debug(f"Fetching attraction {attraction_id}")

        try:
            data = await self._request(
                attraction_detail_url(attraction_id),
                params={
                    "locale": "en-us",
                    "upcomingEventsBy": "country",
                },
            )
        except APIError as e:
            log.error(f"Attraction fetch failed for {attraction_id}: {e}")
            raise

        return Attraction.from_api_response(data)

    async def get_event_images(self, event_id: str) -> list[dict]:
        log.debug(f"Fetching images for event {event_id}")

        try:
            data = await self._request(
                event_images_url(event_id),
                params={"locale": "en-us"},
            )
        except APIError as e:
            log.error(f"Event images fetch failed for {event_id}: {e}")
            return []

        return data.get("images", [])

    def get_stats(self) -> dict:
        return {
            "total_requests": self._request_count,
            "total_errors": self._error_count,
            "key_stats": self._rotator.get_stats(),
        }
