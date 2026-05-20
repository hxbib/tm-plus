from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Optional

log = logging.getLogger("reese84_solver")

SOLVE_TIMEOUT_SECONDS = 30

class Reese84Solver:

    def __init__(self, binary_path: str = "./bin/reese84"):
        self.binary_path = Path(binary_path)
        self.is_available = self.binary_path.exists() and os.access(self.binary_path, os.X_OK)

    async def solve(self, challenge_script: str, site_key: str = "", user_agent: str = "") -> Optional[str]:
        if not self.is_available:
            log.error(
                f"Reese84 binary not found at {self.binary_path}. "
                "Rebuild: cd build/reese84 && "
                "cargo zigbuild --release --target x86_64-unknown-linux-musl && "
                "cp target/x86_64-unknown-linux-musl/release/reese84 ../../bin/reese84"
            )
            return None

        log.info("Executing reese84-rs challenge solver...")

        try:
            process = await asyncio.create_subprocess_exec(
                str(self.binary_path),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=challenge_script.encode()),
                timeout=SOLVE_TIMEOUT_SECONDS,
            )

            if process.returncode != 0:
                log.error(f"Reese84 solver failed (code {process.returncode}): {stderr.decode()[:500]}")
                return None

            output = stdout.decode().strip()
            if not output:
                log.error("Reese84 solver returned empty output")
                return None

            try:
                result = json.loads(output)
                token = result.get("solution") or result.get("token") or result.get("reese84")
                if token:
                    token_str = json.dumps(token) if isinstance(token, dict) else str(token)
                    log.info(f"Reese84 solved: {token_str[:40]}...")
                    return token_str
                log.warning(f"Reese84 output has no solution key: {list(result.keys())}")
                return output
            except json.JSONDecodeError:
                log.info(f"Reese84 raw output: {output[:40]}...")
                return output

        except asyncio.TimeoutError:
            log.error(f"Reese84 solver timed out after {SOLVE_TIMEOUT_SECONDS}s")
            try:
                process.kill()
            except Exception:
                pass
            return None
        except Exception as e:
            log.error(f"Reese84 solver error: {e}")
            return None
