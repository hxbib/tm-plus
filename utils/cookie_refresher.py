from __future__ import annotations

import asyncio
import base64
import os
import random
import time
from datetime import datetime, timezone
from curl_cffi.requests import AsyncSession

from utils.logger import get_logger
from utils.cookie_injector import prune_invalid_tmpt

REFRESH_PROFILES = ["chrome120", "chrome123", "chrome124", "safari17_0"]

GEC_SITE_KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
GEC_URL = "https://www.ticketmaster.com/epsf/gec/v3/pageView"

UA_BY_PROFILE = {
    "chrome120": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "chrome123": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "chrome124": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "safari17_0": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
}

log = get_logger("CookieRefresher")

def _synthesize_token() -> str:
    return "0cAFcWeA" + base64.urlsafe_b64encode(os.urandom(1900)).decode().rstrip("=")

class CookieRefresher:

    def __init__(self, config: dict, auto_researchr=None):
        self._config = config
        cr_config = config.get("cookie_refresh", {})
        research_cfg = config.get("auto_research", {})
        self._enabled = cr_config.get("enabled", False)
        self._interval = cr_config.get("interval_minutes", 30) * 60
        self._auto_researchr = auto_researchr
        self._task: asyncio.Task | None = None
        self._last_refresh: float = 0
        self._refresh_count: int = 0
        self._current_tmpt: str = ""
        self._current_ndcd: str = ""
        self._seed_tmpt = research_cfg.get("tmpt_cookie", "")
        self._max_consecutive_failures: int = 3

        self._tmpt_bank: list[str] = list(research_cfg.get("tmpt_cookie_bank", []))
        if self._seed_tmpt and self._seed_tmpt not in self._tmpt_bank:
            self._tmpt_bank.insert(0, self._seed_tmpt)
        self._bank_errors: dict[str, int] = {}
        self._ndcd_seed: str = research_cfg.get("ndcd_cookie", "")

        self._consecutive_endpoint_failures: int = 0
        self._endpoint_failure_threshold: int = 2
        self._suppressed: bool = False
        self._backoff_factor: float = 1.0
        self._max_backoff: float = 4.0

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def last_refresh_ago(self) -> str:
        if self._last_refresh == 0:
            return "never"
        elapsed = time.time() - self._last_refresh
        if elapsed < 60:
            return f"{int(elapsed)}s ago"
        elif elapsed < 3600:
            return f"{int(elapsed / 60)}m ago"
        return f"{elapsed / 3600:.1f}h ago"

    @property
    def bank_size(self) -> int:
        return len(self._tmpt_bank)

    @property
    def status_summary(self) -> str:
        if not self._enabled:
            return "❌ Disabled (static cookies)"
        if self._last_refresh == 0:
            return "⏳ Pending first refresh"
        bank_info = f" · {len(self._tmpt_bank)} cookies in bank" if len(self._tmpt_bank) > 1 else ""
        return (
            f"✅ Active (GEC heartbeat) — {self._refresh_count} refreshes — "
            f"last: {self.last_refresh_ago}{bank_info}"
        )

    async def start(self) -> None:
        if not self._enabled:
            log.info("Cookie auto-refresh disabled in config.")
            return

        if not self._tmpt_bank:
            log.warning(
                "⚠️ No tmpt cookies in bank. "
                "Copy tmpt from your browser and add to config.json → auto_research.tmpt_cookie_bank"
            )

        log.info(
            f"Starting GEC pageView cookie heartbeat (interval: {self._interval / 60:.0f}m)"
        )
        self._task = asyncio.create_task(self._refresh_loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info(f"Cookie refresher stopped ({self._refresh_count} total refreshes)")

    async def force_refresh(self) -> tuple[str, str]:
        return await self._do_refresh()

    async def _refresh_loop(self) -> None:
        try:
            await self._do_refresh()
        except asyncio.CancelledError:
            return
        except Exception as e:
            log.error(f"Initial cookie refresh failed: {e}")

        while True:
            try:
                effective_interval = self._interval * self._backoff_factor
                if self._suppressed and effective_interval > self._interval:
                    log.debug(
                        f"Refresh suppressed — sleeping {effective_interval:.0f}s "
                        f"(backoff x{self._backoff_factor:.1f})"
                    )
                await asyncio.sleep(effective_interval)
                await self._do_refresh()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error(f"Cookie refresh cycle failed: {e}")
                await asyncio.sleep(min(300, self._interval / 4))

    async def _do_refresh(self) -> tuple[str, str]:
        bank_size = len(self._tmpt_bank)

        tmpts_to_refresh = list(self._tmpt_bank) if self._tmpt_bank else []
        if not tmpts_to_refresh:
            active = self._current_tmpt or self._seed_tmpt
            if active:
                tmpts_to_refresh = [active]

        if not tmpts_to_refresh:
            log.error(
                "❌ No tmpt cookies available to refresh. "
                "Copy tmpt from browser → config.json or run tmpt_generator.py"
            )
            return "", ""

        if self._suppressed:
            log.info(
                f"Refresh cycle suppressed — endpoint has rejected all probes "
                f"({self._consecutive_endpoint_failures} consecutive cycles). "
                f"Probing 1 cookie to detect recovery..."
            )
            tmpts_to_refresh = tmpts_to_refresh[:1]
            bank_size = 1
        elif bank_size > 1:
            log.info(f"Refreshing {bank_size} tmpt cookies via GEC heartbeat...")
        else:
            log.info("Refreshing tmpt via GEC pageView heartbeat...")

        tmpt = ""
        ndcd = ""

        alive_count = 0
        dead_count = 0
        edge_block_count = 0
        risk_block_count = 0
        status_codes: dict[int, int] = {}
        first_failure_body: str = ""
        renewed_count = 0

        profile = random.choice(REFRESH_PROFILES)
        ua = UA_BY_PROFILE.get(profile, UA_BY_PROFILE["chrome124"])
        log.debug(f"Heartbeat using TLS profile: {profile}")
        async with AsyncSession(impersonate=profile) as session:
            try:
                hp = await session.get(
                    "https://www.ticketmaster.com/",
                    headers={
                        "User-Agent": ua,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Accept-Encoding": "gzip, deflate, br, zstd",
                    },
                    timeout=20,
                )
                if hp.status_code >= 400:
                    log.warning(
                        f"Homepage warmup returned HTTP {hp.status_code} — "
                        f"VPS IP is being blocked at the WAF layer (Akamai/Imperva). "
                        f"GEC heartbeat will fail until this clears."
                    )
            except Exception as e:
                log.error(f"Homepage visit failed: {e}")
                self._note_endpoint_failure()
                return self._current_tmpt or self._seed_tmpt, self._current_ndcd

            base_headers = {
                "User-Agent": ua,
                "Content-Type": "application/json",
                "Origin": "https://www.ticketmaster.com",
                "Referer": "https://www.ticketmaster.com/",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "DNT": "1",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"' if "chrome" in profile else '"macOS"',
            }

            for idx, cookie_tmpt in enumerate(tmpts_to_refresh):
                try:
                    session.cookies.set("LANGUAGE", "en-us", domain=".ticketmaster.com")
                    session.cookies.set("NDMA", "200", domain=".ticketmaster.com")
                    session.cookies.set("tmpt", cookie_tmpt, domain=".ticketmaster.com")
                    if self._ndcd_seed:
                        session.cookies.set("ndcd", self._ndcd_seed, domain=".ticketmaster.com")

                    gec_resp = await session.post(
                        GEC_URL,
                        json={
                            "hostname": "www.ticketmaster.com",
                            "key": GEC_SITE_KEY,
                            "token": _synthesize_token(),
                        },
                        headers=base_headers,
                        timeout=15,
                    )

                    sc = gec_resp.status_code
                    status_codes[sc] = status_codes.get(sc, 0) + 1

                    if sc == 200:
                        alive_count += 1
                        self._bank_errors.pop(cookie_tmpt[:20], None)
                        new_tmpt = (
                            session.cookies.get("tmpt", domain=".ticketmaster.com") or ""
                        )
                        if new_tmpt and new_tmpt != cookie_tmpt:
                            renewed_count += 1
                            self._tmpt_bank[idx] = new_tmpt
                    else:
                        dead_count += 1
                        body_preview = ""
                        try:
                            body_preview = gec_resp.text[:200]
                        except Exception:
                            pass
                        if body_preview.startswith("{") and "block" in body_preview:
                            risk_block_count += 1
                        elif "<" in body_preview[:5]:
                            edge_block_count += 1
                        errs = self._bank_errors.get(cookie_tmpt[:20], 0) + 1
                        self._bank_errors[cookie_tmpt[:20]] = errs
                        if not first_failure_body:
                            first_failure_body = body_preview[:120]

                    if not ndcd:
                        ndcd = (
                            session.cookies.get("ndcd", domain=".ticketmaster.com") or ""
                        )

                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    dead_count += 1
                    if dead_count == 1:
                        log.debug(f"Heartbeat exception: {type(e).__name__}: {e}")

                if idx < len(tmpts_to_refresh) - 1:
                    await asyncio.sleep(0.5)

        tmpt = self._current_tmpt or self._seed_tmpt or (
            tmpts_to_refresh[0] if tmpts_to_refresh else ""
        )

        if tmpt:
            self._current_tmpt = tmpt

        if ndcd:
            self._current_ndcd = ndcd

        self._last_refresh = time.time()
        self._refresh_count += 1
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")

        attempted = max(alive_count + dead_count, 1)
        fail_rate = dead_count / attempted

        if alive_count == 0 and dead_count > 0:
            self._note_endpoint_failure(
                status_codes, first_failure_body, edge_block_count, risk_block_count
            )
        elif fail_rate >= 0.9:
            self._note_endpoint_failure(
                status_codes, first_failure_body, edge_block_count, risk_block_count
            )
        else:
            self._note_endpoint_success()

        sc_summary = ", ".join(
            f"{c}×HTTP {s}" for s, c in sorted(status_codes.items())
        )
        renewed_str = f", {renewed_count} renewed" if renewed_count else ""
        if bank_size > 1:
            log.info(
                f"Heartbeat #{self._refresh_count} at {ts} — "
                f"{alive_count}/{bank_size} alive, {dead_count} failed{renewed_str}"
                f"{f' ({sc_summary})' if sc_summary else ''}"
            )
        else:
            log.info(
                f"Heartbeat #{self._refresh_count} at {ts} — "
                f"tmpt={'✅' if alive_count else '❌'} ndcd={'✅' if ndcd else '❌'}"
                f"{renewed_str}"
            )

        if not self._suppressed:
            self._prune_dead_cookies(tmpts_to_refresh)

        if self._auto_researchr:
            self._inject_cookies(tmpt, ndcd)

        return tmpt, ndcd

    def _note_endpoint_failure(
        self,
        status_codes: dict[int, int] | None = None,
        sample_body: str = "",
        edge_blocks: int = 0,
        risk_blocks: int = 0,
    ) -> None:
        self._consecutive_endpoint_failures += 1

        if (
            not self._suppressed
            and self._consecutive_endpoint_failures >= self._endpoint_failure_threshold
        ):
            self._suppressed = True
            self._backoff_factor = min(self._max_backoff, self._backoff_factor * 2 or 2.0)
            codes_str = (
                ", ".join(f"HTTP {s}: {c}" for s, c in sorted((status_codes or {}).items()))
                or "n/a"
            )

            if risk_blocks > edge_blocks:
                cause = (
                    "the EPSF risk engine is rejecting this host's IP "
                    "(body: {\"response\":\"block\"}). The body shape and TLS "
                    "fingerprint are correct, but IP reputation is flagged. "
                    "Run from a clean residential IP or rotate via proxy."
                )
            elif edge_blocks > 0:
                cause = (
                    "Akamai/Imperva is blocking at the WAF edge before "
                    "EPSF sees the request (response is the HTML challenge "
                    "page). This means TLS fingerprint or request shape failed "
                    "validation — try a different impersonate profile."
                )
            else:
                cause = "unknown — see Sample 403 body in debug logs"

            log.warning(
                f"Cookie refresh endpoint /epsf/gec/v3/pageView is rejecting all "
                f"probes ({codes_str}). Cause: {cause} Entering quiet mode: "
                f"interval x{self._backoff_factor:.1f} "
                f"(≈{self._interval * self._backoff_factor / 60:.0f}m), single-probe "
                f"checks until recovery. tmpt cookies remain usable; the event "
                f"monitor does NOT depend on this endpoint."
            )
            if sample_body:
                log.debug(f"Sample 403 body: {sample_body}")
        elif self._suppressed:
            self._backoff_factor = min(self._max_backoff, self._backoff_factor * 1.5)

    def _note_endpoint_success(self) -> None:
        if self._suppressed and self._consecutive_endpoint_failures > 0:
            log.success(
                "Cookie refresh endpoint recovered — resuming normal cadence"
            )
        self._consecutive_endpoint_failures = 0
        self._suppressed = False
        self._backoff_factor = 1.0

    def _prune_dead_cookies(self, refreshed_cookies: list[str]) -> None:
        to_prune = []
        for cookie in refreshed_cookies:
            key = cookie[:20]
            failures = self._bank_errors.get(key, 0)
            if failures >= self._max_consecutive_failures:
                to_prune.append(cookie)

        for cookie in to_prune:
            log.warning(
                f"Pruning dead tmpt cookie ({self._bank_errors.get(cookie[:20], 0)} "
                f"consecutive failures)"
            )
            self._bank_errors.pop(cookie[:20], None)
            if cookie in self._tmpt_bank:
                self._tmpt_bank.remove(cookie)
            prune_invalid_tmpt(
                self._config, cookie, self._auto_researchr, self
            )

    def _inject_cookies(self, tmpt: str, ndcd: str) -> None:
        try:
            if self._tmpt_bank and hasattr(self._auto_researchr, "_tmpt_bank"):
                self._auto_researchr._tmpt_bank = list(self._tmpt_bank)
                self._auto_researchr._tmpt_bank_idx = 0
            elif tmpt and hasattr(self._auto_researchr, "set_tmpt_cookie"):
                self._auto_researchr.set_tmpt_cookie(tmpt)

            if ndcd and hasattr(self._auto_researchr, "_ndcd_cookie"):
                self._auto_researchr._ndcd_cookie = ndcd

            log.info(
                f"Injected cookies into Autoresearchr "
                f"(bank: {len(self._tmpt_bank)} cookie{'s' if len(self._tmpt_bank) != 1 else ''})"
            )
        except Exception as e:
            log.error(f"Failed to inject cookies: {e}")
