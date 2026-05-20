from __future__ import annotations

import asyncio
import json
import os
from aiohttp import web

from utils.logger import get_logger

log = get_logger("CookieInjector")

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
INJECT_PORT = 18731

class CookieInjectorServer:

    def __init__(self, config: dict, auto_researchr=None, cookie_refresher=None):
        self._config = config
        self._auto_researchr = auto_researchr
        self._cookie_refresher = cookie_refresher
        self._app: web.Application | None = None
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None
        self._injected_count: int = 0

    @property
    def injected_count(self) -> int:
        return self._injected_count

    async def start(self) -> None:
        self._app = web.Application()
        self._app.router.add_post("/inject", self._handle_inject)
        self._app.router.add_get("/status", self._handle_status)
        self._app.router.add_options("/inject", self._handle_cors_preflight)
        self._app.router.add_options("/status", self._handle_cors_preflight)

        self._runner = web.AppRunner(self._app, access_log=None)
        await self._runner.setup()

        try:
            self._site = web.TCPSite(self._runner, "127.0.0.1", INJECT_PORT)
            await self._site.start()
            log.info(f"Cookie injection server listening on http://127.0.0.1:{INJECT_PORT}")
        except OSError as e:
            log.warning(f"Could not start injection server on port {INJECT_PORT}: {e}")
            self._site = None

    async def stop(self) -> None:
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
        log.info(f"Cookie injection server stopped ({self._injected_count} total injections)")

    def _cors_headers(self) -> dict:
        return {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        }

    async def _handle_cors_preflight(self, request: web.Request) -> web.Response:
        return web.Response(status=204, headers=self._cors_headers())

    async def _handle_status(self, request: web.Request) -> web.Response:
        research_cfg = self._config.get("auto_research", {})
        bank = research_cfg.get("tmpt_cookie_bank", [])
        body = {
            "status": "online",
            "bank_size": len(bank),
            "injected_total": self._injected_count,
        }
        return web.json_response(body, headers=self._cors_headers())

    async def _handle_inject(self, request: web.Request) -> web.Response:
        try:
            payload = await request.json()
        except (json.JSONDecodeError, Exception):
            return web.json_response(
                {"ok": False, "error": "Invalid JSON"},
                status=400,
                headers=self._cors_headers(),
            )

        cookies = payload.get("cookies", [])
        if not cookies or not isinstance(cookies, list):
            single = payload.get("tmpt_cookie_bank", [])
            if single and isinstance(single, list):
                cookies = single
            else:
                return web.json_response(
                    {"ok": False, "error": "No cookies provided"},
                    status=400,
                    headers=self._cors_headers(),
                )

        cookies = [c for c in cookies if isinstance(c, str) and len(c) > 10]
        if not cookies:
            return web.json_response(
                {"ok": False, "error": "No valid cookies in payload"},
                status=400,
                headers=self._cors_headers(),
            )

        added = self._merge_cookies_to_config(cookies)
        self._inject_to_runtime(cookies)
        self._injected_count += added

        log.info(
            f"Injected {added} new cookies from extension "
            f"(received {len(cookies)}, {added} new, bank now: "
            f"{len(self._config.get('auto_research', {}).get('tmpt_cookie_bank', []))})"
        )

        return web.json_response(
            {
                "ok": True,
                "added": added,
                "total_bank": len(self._config.get("auto_research", {}).get("tmpt_cookie_bank", [])),
                "duplicates_skipped": len(cookies) - added,
            },
            headers=self._cors_headers(),
        )

    def _merge_cookies_to_config(self, cookies: list[str]) -> int:
        research_cfg = self._config.setdefault("auto_research", {})
        bank = research_cfg.setdefault("tmpt_cookie_bank", [])

        existing = set(bank)
        new_cookies = [c for c in cookies if c not in existing]

        if not new_cookies:
            return 0

        bank.extend(new_cookies)
        self._persist_config()
        return len(new_cookies)

    def _inject_to_runtime(self, cookies: list[str]) -> None:
        if self._auto_researchr:
            for cookie in cookies:
                if cookie not in self._auto_researchr._tmpt_bank:
                    self._auto_researchr._tmpt_bank.append(cookie)

        if self._cookie_refresher:
            for cookie in cookies:
                if cookie not in self._cookie_refresher._tmpt_bank:
                    self._cookie_refresher._tmpt_bank.append(cookie)

    def _persist_config(self) -> None:
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(self._config, f, indent=2, ensure_ascii=False)
                f.write("\n")
        except Exception as e:
            log.error(f"Failed to persist config: {e}")

def prune_invalid_tmpt(config: dict, invalid_cookie: str, auto_researchr=None, cookie_refresher=None) -> bool:
    research_cfg = config.get("auto_research", {})
    bank = research_cfg.get("tmpt_cookie_bank", [])

    if invalid_cookie not in bank:
        return False

    bank.remove(invalid_cookie)
    log.info(f"Pruned invalid tmpt cookie from config (bank now: {len(bank)})")

    if auto_researchr and invalid_cookie in auto_researchr._tmpt_bank:
        auto_researchr._tmpt_bank.remove(invalid_cookie)

    if cookie_refresher and invalid_cookie in cookie_refresher._tmpt_bank:
        cookie_refresher._tmpt_bank.remove(invalid_cookie)

    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
            f.write("\n")
    except Exception as e:
        log.error(f"Failed to persist config after pruning: {e}")
        return False

    return True
