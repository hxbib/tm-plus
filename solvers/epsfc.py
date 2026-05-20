from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Optional

from curl_cffi.requests import AsyncSession

log = logging.getLogger("epsfc_solver")

TM_BASE = "https://www.ticketmaster.com"
ASYNC_PROFILES = ["chrome124", "chrome123", "chrome120", "safari17_0"]

def _solve_pow_worker(challenge: str, difficulty: int, start_nonce: int, step: int) -> int:
    prefix = "0" * difficulty
    nonce = start_nonce
    challenge_bytes = challenge.encode()

    while True:
        data = challenge_bytes + str(nonce).encode()
        if hashlib.sha256(data).hexdigest().startswith(prefix):
            return nonce
        nonce += step

def solve_pow(challenge: str, difficulty: int) -> int:
    prefix = "0" * difficulty
    nonce = 0
    challenge_bytes = challenge.encode()

    while True:
        data = challenge_bytes + str(nonce).encode()
        if hashlib.sha256(data).hexdigest().startswith(prefix):
            return nonce
        nonce += 1

async def solve_pow_parallel(challenge: str, difficulty: int, workers: int = 0) -> int:
    if workers <= 0:
        workers = os.cpu_count() or 4

    loop = asyncio.get_event_loop()

    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = []
        for i in range(workers):
            future = loop.run_in_executor(
                executor,
                _solve_pow_worker,
                challenge, difficulty, i, workers,
            )
            futures.append(future)

        done, pending = await asyncio.wait(futures, return_when=asyncio.FIRST_COMPLETED)

        for task in pending:
            task.cancel()

        return done.pop().result()

class EpsfcSolver:

    def __init__(self, binary_path: str = "./bin/epsfc", profile: str = "chrome124"):
        self.binary_path = Path(binary_path)
        self.has_binary = self.binary_path.exists() and os.access(self.binary_path, os.X_OK)
        self.is_available = True
        self._profile = profile

        if self.has_binary:
            log.info(f"EPSFC solver: Go binary available at {self.binary_path}")
        else:
            log.info("EPSFC solver: using native Python SHA-256 solver")

    async def solve_challenge(self, challenge: str, difficulty: int, parallel: bool = True) -> int:
        start = time.time()

        if parallel and difficulty >= 4:
            nonce = await solve_pow_parallel(challenge, difficulty)
        else:
            nonce = solve_pow(challenge, difficulty)

        elapsed = time.time() - start
        hash_hex = hashlib.sha256(f"{challenge}{nonce}".encode()).hexdigest()
        log.info(
            f"PoW solved: difficulty={difficulty} nonce={nonce} "
            f"time={elapsed:.3f}s hash={hash_hex[:16]}..."
        )
        return nonce

    async def solve(self, session: AsyncSession | None = None) -> Optional[str]:
        if self.has_binary:
            result = await self._solve_with_binary()
            if result:
                return result

        return await self._solve_native(session)

    async def _solve_native(self, session: AsyncSession | None = None) -> Optional[str]:
        own_session = session is None
        if own_session:
            session = AsyncSession(impersonate=self._profile)

        try:
            if own_session:
                await session.get(TM_BASE, timeout=20)
                await session.get(f"{TM_BASE}/eps-mgr", timeout=15)

            log.info("Requesting PoW challenge from /epsf/pow/request...")
            r = await session.get(
                f"{TM_BASE}/epsf/pow/request",
                headers={
                    "Accept": "application/json",
                    "Origin": TM_BASE,
                    "Referer": f"{TM_BASE}/",
                },
                timeout=15,
            )

            if r.status_code == 401:
                log.warning(
                    "PoW endpoint requires authentication (HTTP 401). "
                    "Pass an authenticated session or use the Go binary."
                )
                return None

            if r.status_code != 200:
                log.error(f"PoW request failed: HTTP {r.status_code} | {r.text[:200]}")
                return None

            try:
                pow_data = r.json()
            except Exception:
                log.error(f"PoW response is not JSON: {r.text[:200]}")
                return None

            challenge = pow_data.get("challenge", "")
            difficulty = pow_data.get("difficulty", 4)
            signature = pow_data.get("signature", "")

            if not challenge:
                log.error(f"PoW response missing challenge: {pow_data}")
                return None

            log.info(f"PoW challenge: {challenge} (difficulty: {difficulty})")

            nonce = await self.solve_challenge(challenge, difficulty)

            log.info("Validating PoW solution...")
            r = await session.post(
                f"{TM_BASE}/epsf/pow/validate",
                json={
                    "challenge": challenge,
                    "difficulty": difficulty,
                    "signature": signature,
                    "nonce": nonce,
                },
                headers={
                    "Content-Type": "application/json",
                    "Origin": TM_BASE,
                    "Referer": f"{TM_BASE}/",
                },
                timeout=15,
            )

            if r.status_code != 200:
                log.error(f"PoW validation failed: HTTP {r.status_code} | {r.text[:200]}")
                return None

            epsfc = session.cookies.get("epsfc", domain=".ticketmaster.com")
            if epsfc:
                log.info(f"epsfc cookie obtained: {epsfc[:40]}...")
                return epsfc

            set_cookie = r.headers.get("set-cookie", "")
            if "epsfc" in set_cookie:
                import re
                m = re.search(r"epsfc=([^;]+)", set_cookie)
                if m:
                    epsfc = m.group(1)
                    log.info(f"epsfc cookie from header: {epsfc[:40]}...")
                    return epsfc

            log.warning("PoW validated but no epsfc cookie received")
            return None

        except Exception as e:
            log.error(f"EPSFC native solver error: {e}")
            return None
        finally:
            if own_session:
                await session.close()

    async def _solve_with_binary(self) -> Optional[str]:
        if not self.has_binary:
            return None

        log.info("Solving EPSFC via Go binary...")

        try:
            process = await asyncio.create_subprocess_exec(
                str(self.binary_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=30
            )

            if process.returncode != 0:
                log.error(f"EPSFC binary failed (code {process.returncode}): {stderr.decode()}")
                return None

            output = stdout.decode().strip()
            try:
                result = json.loads(output)
                cookie = result.get("cookie", result.get("epsfc", ""))
            except json.JSONDecodeError:
                cookie = output

            if cookie:
                log.info(f"EPSFC cookie solved (Go): {cookie[:30]}...")
            return cookie or None

        except asyncio.TimeoutError:
            log.error("EPSFC binary timed out after 30s")
            return None
        except Exception as e:
            log.error(f"EPSFC binary error: {e}")
            return None
