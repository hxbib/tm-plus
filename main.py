from __future__ import annotations

import asyncio
import json
import os
import sys

VERSION = "v5.23.25"
AUTHOR = "habib"

GRAD = ["#FF9144", "#FF5E0E", "#0088DD", "#004488"]
ACCENT = "#FF5E0E"

def _rgb(r, g, b):
    return f"\033[38;2;{r};{g};{b}m"

def _bold():
    return "\033[1m"

def _dim():
    return "\033[2m"

def _reset():
    return "\033[0m"

def _hx(h):
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

def _grad_at(t, stops=GRAD):
    if t <= 0:
        return _hx(stops[0])
    if t >= 1:
        return _hx(stops[-1])
    seg = t * (len(stops) - 1)
    i = int(seg)
    f = seg - i
    a = _hx(stops[i])
    b = _hx(stops[i + 1])
    return tuple(int(a[k] + (b[k] - a[k]) * f) for k in range(3))

TICKET = r"""
████████╗██╗ ██████╗██╗  ██╗███████╗████████╗
╚══██╔══╝██║██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝
   ██║   ██║██║     █████╔╝ █████╗     ██║
   ██║   ██║██║     ██╔═██╗ ██╔══╝     ██║
   ██║   ██║╚██████╗██║  ██╗███████╗   ██║
   ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝
""".strip("\n").splitlines()

MASTER = r"""
███╗   ███╗ █████╗ ███████╗████████╗███████╗██████╗      ██╗
████╗ ████║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗     ██║
██╔████╔██║███████║███████╗   ██║   █████╗  ██████╔╝  ████████╗
██║╚██╔╝██║██╔══██║╚════██║   ██║   ██╔══╝  ██╔══██╗  ╚══██╔══╝
██║ ╚═╝ ██║██║  ██║███████║   ██║   ███████╗██║  ██║     ██║
╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝     ╚═╝
""".strip("\n").splitlines()

def _paint(line, t0, t1):
    width = max(1, len(line) - 1)
    out = []
    for i, ch in enumerate(line):
        if ch == " ":
            out.append(" ")
            continue
        t = t0 + (i / width) * (t1 - t0)
        r, g, b = _grad_at(t)
        out.append(f"{_rgb(r, g, b)}{ch}")
    return "".join(out) + _reset()

def print_banner() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    print()
    for ln in TICKET:
        print(" " + _paint(ln, 0.00, 0.55))
    for ln in MASTER:
        print(" " + _paint(ln, 0.45, 1.00))

    r, g, b = _hx(ACCENT)
    rule = "\u2500" * 62
    print()
    print(f"  {_dim()}{rule}{_reset()}  {_rgb(r, g, b)}\u25C6{_reset()}  {_dim()}{rule}{_reset()}")
    print()

    dot = f"{_dim()}\u00B7{_reset()}"
    brand = f"{_rgb(r, g, b)}{_bold()}TICKETMASTER+{_reset()}"
    print(f"   {brand} {dot} Event Monitor")
    meta = f"{_dim()}VERSION{_reset()} {VERSION}  {dot}  {_dim()}AUTHOR{_reset()} {AUTHOR}"
    print(f"   {meta}")
    print()

def load_config(config_path: str) -> dict:
    if not os.path.exists(config_path):
        print(f"\033[91m  ERROR: Config file not found: {config_path}\033[0m")
        print(f"  Create a config.json file or specify the path with --config")
        sys.exit(1)

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        print(f"\033[91m  ERROR: config.json formatting is incorrect - double check it!: {e}\033[0m")
        sys.exit(1)

    errors = []

    api_keys = config.get("api", {}).get("keys", [])
    if not api_keys:
        errors.append("No API keys in api.keys")

    attractions = config.get("attractions", [])
    enabled = [a for a in attractions if a.get("enabled", True)]
    if not enabled:
        errors.append("No valid attractions in config - double check all values")

    for a in enabled:
        if not a.get("attraction_id"):
            errors.append(f"Attraction '{a.get('name', 'Unknown')}' has no attraction_id")

    webhook = config.get("discord", {}).get("webhook_url", "")
    if not webhook:
        print(f"\033[93m  WARNING: No Discord webhook URL configured — notifications will be queued - ADD DISCORD WEBHOOK TO CONFIG.JSON \033[0m")

    if errors:
        print(f"\033[91m  CONFIG ERRORS:\033[0m")
        for err in errors:
            print(f"\033[91m    • {err}\033[0m")
        sys.exit(1)

    return config

async def main():
    print_banner()

    config_path = os.path.join(os.path.dirname(__file__), "config.json")
    if "--config" in sys.argv:
        idx = sys.argv.index("--config")
        if idx + 1 < len(sys.argv):
            config_path = sys.argv[idx + 1]

    config = load_config(config_path)

    from utils.logger import init_logging
    init_logging(config)

    from utils.logger import get_logger
    log = get_logger("Main")

    log.info(f"Ticketmaster+ {VERSION}")
    log.info(f"Config loaded from: {config_path}")
    log.info(f"API keys: {len(config.get('api', {}).get('keys', []))}")

    enabled_attractions = [
        a for a in config.get("attractions", [])
        if a.get("enabled", True) and a.get("attraction_id")
    ]
    log.info(f"Tracked attractions: {len(enabled_attractions)}")
    for a in enabled_attractions:
        log.info(f"  • {a['name']} ({a['attraction_id']})")

    from monitors.orchestrator import MonitorOrchestrator

    orchestrator = MonitorOrchestrator(config)
    await orchestrator.start()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\033[93m  Interrupted by user.\033[0m")
    except Exception as e:
        print(f"\n\033[91m  FATAL ERROR: {type(e).__name__}: {e}\033[0m")
        import traceback
        traceback.print_exc()
        sys.exit(1)
