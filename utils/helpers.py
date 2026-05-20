from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

def format_event_date(date_info: dict) -> str:
    if not date_info:
        return "TBD"

    local_date = date_info.get("localDate", "")
    local_time = date_info.get("localTime", "")
    date_tbd = date_info.get("dateTBD", False)
    date_tba = date_info.get("dateTBA", False)
    time_tba = date_info.get("timeTBA", False)

    if date_tbd:
        return "Date TBD"
    if date_tba:
        return "Date TBA"

    try:
        if local_date and local_time and not time_tba:
            dt = datetime.strptime(f"{local_date} {local_time}", "%Y-%m-%d %H:%M:%S")
            return dt.strftime("%A, %B %-d, %Y at %-I:%M %p")
        elif local_date:
            dt = datetime.strptime(local_date, "%Y-%m-%d")
            time_str = " (Time TBA)" if time_tba else ""
            return dt.strftime(f"%A, %B %-d, %Y{time_str}")
    except ValueError:
        pass

    return local_date or "TBD"

def format_event_date_short(date_info: dict) -> str:
    if not date_info:
        return "TBD"

    local_date = date_info.get("localDate", "")
    local_time = date_info.get("localTime", "")

    if date_info.get("dateTBD") or date_info.get("dateTBA"):
        return "TBD"

    try:
        if local_date and local_time and not date_info.get("timeTBA"):
            dt = datetime.strptime(f"{local_date} {local_time}", "%Y-%m-%d %H:%M:%S")
            return dt.strftime("%b %-d, %Y • %-I:%M %p")
        elif local_date:
            dt = datetime.strptime(local_date, "%Y-%m-%d")
            return dt.strftime("%b %-d, %Y")
    except ValueError:
        pass

    return local_date or "TBD"

def format_timestamp(ts: float | None = None) -> str:
    if ts is None:
        dt = datetime.now()
    else:
        dt = datetime.fromtimestamp(ts)
    return dt.strftime("%b %-d, %Y at %-I:%M:%S %p")

def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def relative_time(seconds: float) -> str:
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        return f"{int(seconds / 60)}m {int(seconds % 60)}s"
    elif seconds < 86400:
        hours = int(seconds / 3600)
        mins = int((seconds % 3600) / 60)
        return f"{hours}h {mins}m"
    else:
        days = int(seconds / 86400)
        hours = int((seconds % 86400) / 3600)
        return f"{days}d {hours}h"

def build_event_url(event_data: dict) -> str:
    url = event_data.get("url", "")
    if url:
        return url

    tm_us_id = event_data.get("references", {}).get("ticketmaster-us", "")
    if tm_us_id:
        return f"https://www.ticketmaster.com/event/{tm_us_id}"

    return ""

def build_artist_url(tm_us_id: str, slug: str = "") -> str:
    if slug:
        return f"https://www.ticketmaster.com/{slug}/artist/{tm_us_id}"
    return f"https://www.ticketmaster.com/artist/{tm_us_id}"

def build_venue_url(venue_data: dict) -> str:
    url = venue_data.get("url", "")
    if url:
        return url
    tm_us_id = venue_data.get("references", {}).get("ticketmaster-us", "")
    if tm_us_id:
        return f"https://www.ticketmaster.com/venue/{tm_us_id}"
    return ""

def select_best_image(images: list[dict], preferred_ratio: str = "16_9",
                       min_width: int = 500) -> str | None:
    
    if not images:
        return None

    tm_images = [
        img for img in images
        if not img.get("fallback", True)
    ]
    if not tm_images:
        tm_images = images

    ratio_matches = [img for img in tm_images if img.get("ratio") == preferred_ratio]
    if ratio_matches:
        suitable = [img for img in ratio_matches if img.get("width", 0) >= min_width]
        if suitable:
            suitable.sort(key=lambda x: x.get("width", 0))
            return suitable[0]["url"]
        ratio_matches.sort(key=lambda x: x.get("width", 0), reverse=True)
        return ratio_matches[0]["url"]

    tm_images.sort(key=lambda x: x.get("width", 0), reverse=True)
    return tm_images[0]["url"]

def select_thumbnail(images: list[dict]) -> str | None:
    if not images:
        return None

    for ratio in ("3_2", "4_3", "16_9"):
        matches = [img for img in images if img.get("ratio") == ratio
                   and img.get("width", 0) >= 200 and img.get("width", 0) <= 700]
        if matches:
            matches.sort(key=lambda x: x.get("width", 0))
            return matches[0]["url"]

    return select_best_image(images, min_width=100)

def safe_get(data: dict | None, *keys, default: Any = None) -> Any:
    current = data
    for key in keys:
        if current is None:
            return default
        if isinstance(current, dict):
            current = current.get(key, None)
        elif isinstance(current, (list, tuple)):
            try:
                current = current[key]
            except (IndexError, TypeError):
                return default
        else:
            return default
    return current if current is not None else default

def extract_status(event_data: dict) -> str:
    return safe_get(event_data, "dates", "status", "code", default="unknown")

def extract_price_range(event_data: dict) -> tuple[float | None, float | None]:
    price_ranges = event_data.get("priceRanges", [])
    if not price_ranges:
        return None, None

    mins = [p.get("min") for p in price_ranges if p.get("min") is not None]
    maxs = [p.get("max") for p in price_ranges if p.get("max") is not None]

    return (min(mins) if mins else None, max(maxs) if maxs else None)

def extract_ticket_limit(event_data: dict) -> int | None:
    limit = safe_get(event_data, "extensions", "ticketmaster", "edb", "webTicketLimit")
    if limit is not None:
        try:
            return int(limit)
        except (ValueError, TypeError):
            pass
    limit = safe_get(event_data, "ticketLimit", "info")
    return limit

def extract_sale_dates(event_data: dict) -> dict:
    public = safe_get(event_data, "sales", "public", default={})
    presales = safe_get(event_data, "sales", "presales", default=[])

    result = {
        "public_start": public.get("startDateTime"),
        "public_end": public.get("endDateTime"),
        "public_tbd": public.get("startTBD", False),
        "presales": [],
    }

    for ps in presales:
        result["presales"].append({
            "name": ps.get("name", "Presale"),
            "start": ps.get("startDateTime"),
            "end": ps.get("endDateTime"),
        })

    return result

def extract_venue_info(event_data: dict) -> dict:
    venues = safe_get(event_data, "_embedded", "venues", default=[])
    if not venues:
        return {"name": "Unknown Venue", "url": "", "city": "", "state": ""}

    venue = venues[0]
    city = safe_get(venue, "city", "name", default="")
    state = safe_get(venue, "state", "stateCode", default="")
    location = f"{city}, {state}" if city and state else city or state or ""

    return {
        "name": venue.get("name", "Unknown Venue"),
        "url": venue.get("url", ""),
        "city": city,
        "state": state,
        "location": location,
        "id": venue.get("id", ""),
    }

def extract_attraction_names(event_data: dict) -> list[str]:
    attractions = safe_get(event_data, "_embedded", "attractions", default=[])
    return [a.get("name", "") for a in attractions if a.get("name")]

def status_emoji(status: str) -> str:
    mapping = {
        "onsale": "🟢",
        "offsale": "🔴",
        "cancelled": "❌",
        "postponed": "⏸️",
        "rescheduled": "🔄",
    }
    return mapping.get(status.lower(), "⚪")

def status_color(status: str) -> int:
    mapping = {
        "onsale": 0x00FF7F,
        "offsale": 0xFF4444,
        "cancelled": 0x888888,
        "postponed": 0xFFA500,
        "rescheduled": 0xFF8C00,
    }
    return mapping.get(status.lower(), 0x0099FF)
