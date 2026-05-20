from __future__ import annotations

import base64
import json
import random
import re
import time
import uuid
from typing import Any

from curl_cffi.requests import AsyncSession

IOS_MAJOR_VERSIONS = [15, 16, 17, 18]

IPHONE_RESOLUTIONS = [
    "1334x750",
    "1920x1080",
    "2436x1125",
    "1792x828",
    "2688x1242",
    "2532x1170",
    "2340x1080",
    "2778x1284",
    "2556x1179",
    "2796x1290",
    "2622x1206",
    "2868x1320",
]

def rot13(text: str) -> str:
    result = []
    for char in text:
        if 'A' <= char <= 'Z':
            result.append(chr((ord(char) - ord('A') + 13) % 26 + ord('A')))
        elif 'a' <= char <= 'z':
            result.append(chr((ord(char) - ord('a') + 13) % 26 + ord('a')))
        else:
            result.append(char)
    return "".join(result)

def generate_uuid(upper: bool = False) -> str:
    val = str(uuid.uuid4())
    return val.upper() if upper else val

class NuDataSolver:
    def __init__(self, session: AsyncSession = None):
        self.session = session or AsyncSession(impersonate="chrome120")
        self.session_uuid = generate_uuid(upper=True)
        self.session_id = f"{self.session_uuid}+{int(time.time() * 1000)}"

        self.widget_id = "w-481390"
        self.req_script_url = f"https://nudata.ticketmaster.com/2.2/w/{self.widget_id}/init/js/"
        self.req_headers = {
            "accept": "*/*",
            "user-agent": "NuDetectSDK/2.7.5 (iOS; iOS 18.0.0; en_US)",
            "accept-language": "en-GB,en;q=0.9",
            "accept-encoding": "gzip, deflate, br",
        }
        self.version = "2.7.5"
        self.mode = "LoginNew"

    async def solve(self) -> dict[str, str]:
        start_time = time.time()

        initial_payload = self._initial_payload()

        try:
            widget_token = await self._get_widget_token(initial_payload)
        except Exception as wt_err:
            widget_token = generate_uuid(upper=False)
            import logging
            logging.getLogger("nudata_solver").debug(
                f"Widget token fetch failed ({wt_err}), using generated fallback"
            )

        final_payload_str = self._final_payload(widget_token)

        nudata_payload = {
            "nds-pmd": final_payload_str,
            "sid": self.session_id
        }

        nudata_payload_json = json.dumps(nudata_payload)
        encoded_pmd = base64.b64encode(nudata_payload_json.encode()).decode()

        return {
            "nds-pmd": encoded_pmd,
            "sid": self.session_id,
            "solve_time": f"{time.time() - start_time:.3f}s"
        }

    def _initial_payload(self) -> str:
        payload = {
            "r": random.randint(1000, 1000000),
            "sid": self.session_id,
            "jsv": self.version,
            "wpp": 1,
            "ls": {},
            "wp": self.mode
        }
        return json.dumps(payload)

    async def _get_widget_token(self, initial_payload: str) -> str:
        params = {"q": initial_payload}
        resp = await self.session.get(
            self.req_script_url,
            params=params,
            headers=self.req_headers,
            timeout=10
        )
        body = resp.text

        match = re.search(r"ndwti\((.*?)\)", body)
        if match:
            json_body = match.group(1)
            data = json.loads(json_body)
            return data.get("fd", {}).get("wt", "")

        raise ValueError("Widget token not found in response")

    def _final_payload(self, widget_token: str) -> str:
        mpmv = random.choice(IOS_MAJOR_VERSIONS)
        msm = random.randint(2_103_562_240, 12_103_562_240)
        wkr = random.randint(1_000, 1_000_000)
        sr = random.choice(IPHONE_RESOLUTIONS)
        mhbcs = round(random.uniform(0.25, 0.95), 5)
        midfv = generate_uuid(upper=True)

        widget_data = {
            "mpmiv": 0,
            "mhs": ["mimt"],
            "msc": "--",
            "didtz": -180,
            "miui": "phone",
            "mpi": "ios",
            "mbmf": "Apple",
            "mpmv": mpmv,
            "mbm": "iPhone",
            "mid": False,
            "msm": msm,
            "ua": self.version,
            "mie": False,
            "ic": "0,no;",
            "dit": False,
            "wkr": wkr,
            "sr": sr,
            "mso": "--",
            "mbb": "Apple",
            "mhbcs": mhbcs,
            "midfv": midfv,
            "ipr": "",
            "mbp": "iPhone",
            "mul": "en-US"
        }

        final_payload = {
            "sid": self.session_id,
            "widgetData": widget_data,
            "wt": widget_token
        }

        final_json = json.dumps(final_payload)
        return rot13(final_json)
