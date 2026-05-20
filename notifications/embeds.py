from __future__ import annotations

import time
from datetime import datetime, timezone

from utils.helpers import (
    format_event_date,
    format_event_date_short,
    format_timestamp,
    relative_time,
    status_color,
    status_emoji,
)
from utils.seat_images import get_section_image, get_section_map_image

BRAND_NAME = "Ticketmaster+"
VERSION = "v5.23.25"
BRAND_COLOR = 0x026CDF
SUCCESS_COLOR = 0x00FF7F
ERROR_COLOR = 0xFF4444
WARNING_COLOR = 0xFFA500
INFO_COLOR = 0x7289DA
HEARTBEAT_COLOR = 0x9B59B6
REMOVED_COLOR = 0x95A5A6

BRAND_ICON = "https://s1.ticketm.net/dam/a/4e8/8a4e79ab-2c55-4d43-a326-003f33d3b4e8_RETINA_PORTRAIT_16_9.jpg"

TM_LOGO = "https://i.imgur.com/iJQfWGP.png"

AUTHOR = "habib"

def _footer() -> dict:
    return {
        "text": f"{BRAND_NAME} {VERSION} — made by {AUTHOR}  •  {datetime.now().strftime('%m/%d/%Y %I:%M:%S %p')}",
        "icon_url": TM_LOGO,
    }

def _divider_field() -> dict:
    return {"name": "\u200b", "value": "\u200b", "inline": False}

def build_new_event_embed(event, attraction_config: dict) -> dict:
    status = event.status
    emoji = status_emoji(status)
    color = BRAND_COLOR if status == "onsale" else status_color(status)

    desc_parts = []
    if event.attraction_names:
        desc_parts.append(f"**{' • '.join(event.attraction_names)}**")
    desc_parts.append(f"")
    desc_parts.append(f"A new event has been detected on Ticketmaster for **{attraction_config.get('name', 'Unknown Artist')}**!")

    description = "\n".join(desc_parts)

    fields = []

    fields.append({
        "name": "📅  Date & Time",
        "value": f"```\n{event.date_formatted}\n```",
        "inline": False,
    })

    venue_val = event.venue_name
    if event.venue_url:
        venue_val = f"[{event.venue_name}]({event.venue_url})"
    if event.venue_location:
        venue_val += f"\n📍 {event.venue_location}"
    fields.append({
        "name": "🏟️  Venue",
        "value": venue_val,
        "inline": True,
    })

    fields.append({
        "name": "🎯  Status",
        "value": f"{emoji}  **{status.upper()}**",
        "inline": True,
    })

    fields.append(_divider_field())

    fields.append({
        "name": "💰  Price",
        "value": f"```\n{event.price_display}\n```",
        "inline": True,
    })

    fields.append({
        "name": "🎫  Ticket Limit",
        "value": f"```\n{event.ticket_limit_display}\n```",
        "inline": True,
    })

    if event.sale_start:
        try:
            dt = datetime.fromisoformat(event.sale_start.replace("Z", "+00:00"))
            sale_str = dt.strftime("%b %-d, %Y at %-I:%M %p UTC")
        except (ValueError, AttributeError):
            sale_str = str(event.sale_start)
        fields.append({
            "name": "🕐  Public Onsale",
            "value": f"```\n{sale_str}\n```",
            "inline": False,
        })

    if event.presales:
        presale_lines = []
        for ps in event.presales[:3]:
            ps_name = ps.get("name", "Presale")
            ps_start = ps.get("start", "")
            if ps_start:
                try:
                    dt = datetime.fromisoformat(ps_start.replace("Z", "+00:00"))
                    ps_start = dt.strftime("%b %-d at %-I:%M %p UTC")
                except (ValueError, AttributeError):
                    pass
            presale_lines.append(f"• **{ps_name}** — {ps_start}")
        fields.append({
            "name": "🔓  Presales",
            "value": "\n".join(presale_lines),
            "inline": False,
        })

    fields.append(_divider_field())

    links = []
    if event.url:
        links.append(f"🔗 [**Buy Tickets**]({event.url})")
    artist_url = attraction_config.get("artist_url", "")
    if artist_url:
        links.append(f"🎭 [**Artist Page**]({artist_url})")
    if event.venue_url:
        links.append(f"🏟️ [**Venue Page**]({event.venue_url})")

    if links:
        fields.append({
            "name": "🔗  Quick Links",
            "value": "  |  ".join(links),
            "inline": False,
        })

    id_parts = [f"`{event.id}`"]
    if event.tm_us_id:
        id_parts.append(f"TM-US: `{event.tm_us_id}`")
    fields.append({
        "name": "📋  Event ID",
        "value": "  •  ".join(id_parts),
        "inline": False,
    })

    embed = {
        "title": f"🎟️  NEW EVENT DETECTED",
        "description": description,
        "color": color,
        "fields": fields,
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if event.thumbnail_url:
        embed["thumbnail"] = {"url": event.thumbnail_url}

    if event.image_url:
        embed["image"] = {"url": event.image_url}

    return embed

def build_event_removed_embed(event_data: dict, attraction_config: dict) -> dict:
    fields = [
        {
            "name": "📅  Date",
            "value": event_data.get("date", "Unknown"),
            "inline": True,
        },
        {
            "name": "🏟️  Venue",
            "value": event_data.get("venue_name", event_data.get("venue", "Unknown")),
            "inline": True,
        },
    ]

    if event_data.get("url"):
        fields.append({
            "name": "🔗  Last Known URL",
            "value": f"[Event Page]({event_data['url']})",
            "inline": False,
        })

    return {
        "title": "⚠️  EVENT REMOVED",
        "description": (
            f"**{event_data.get('name', 'Unknown Event')}** is no longer listed "
            f"under **{attraction_config.get('name', 'Unknown Artist')}**."
        ),
        "color": REMOVED_COLOR,
        "fields": fields,
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

def build_status_change_embed(
    event, old_status: str, new_status: str, attraction_config: dict
) -> dict:
    old_emoji = status_emoji(old_status)
    new_emoji = status_emoji(new_status)
    color = status_color(new_status)

    fields = [
        {
            "name": "📊  Status Change",
            "value": f"```\n{old_emoji}  {old_status.upper()}  →  {new_emoji}  {new_status.upper()}\n```",
            "inline": False,
        },
        {
            "name": "📅  Date & Time",
            "value": event.date_formatted,
            "inline": True,
        },
        {
            "name": "🏟️  Venue",
            "value": f"[{event.venue_name}]({event.venue_url})" if event.venue_url else event.venue_name,
            "inline": True,
        },
        {
            "name": "💰  Price",
            "value": event.price_display,
            "inline": True,
        },
    ]

    if event.url:
        fields.append({
            "name": "🔗  Event Link",
            "value": f"[**Open on Ticketmaster**]({event.url})",
            "inline": False,
        })

    title = "🔔  STATUS CHANGE"
    if new_status == "onsale":
        title = "🟢  EVENT NOW ON SALE!"
    elif new_status == "offsale":
        title = "🔴  EVENT WENT OFF SALE"
    elif new_status == "cancelled":
        title = "❌  EVENT CANCELLED"

    embed = {
        "title": title,
        "description": f"**{event.name}**\n{attraction_config.get('name', '')}",
        "color": color,
        "fields": fields,
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if event.thumbnail_url:
        embed["thumbnail"] = {"url": event.thumbnail_url}

    return embed

def build_price_change_embed(
    event, old_min, old_max, new_min, new_max, attraction_config: dict
) -> dict:
    old_display = _price_str(old_min, old_max)
    new_display = _price_str(new_min, new_max)

    return {
        "title": "💰  PRICE CHANGE DETECTED",
        "description": f"**{event.name}**\n{attraction_config.get('name', '')}",
        "color": WARNING_COLOR,
        "fields": [
            {
                "name": "Old Price",
                "value": f"```\n{old_display}\n```",
                "inline": True,
            },
            {
                "name": "New Price",
                "value": f"```\n{new_display}\n```",
                "inline": True,
            },
            {
                "name": "📅  Date",
                "value": event.date_formatted,
                "inline": False,
            },
            {
                "name": "🔗  Event Link",
                "value": f"[**Open on Ticketmaster**]({event.url})" if event.url else "N/A",
                "inline": False,
            },
        ],
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

def _price_str(pmin, pmax) -> str:
    if pmin is not None and pmax is not None:
        if pmin == pmax:
            return f"${pmin:.2f}"
        return f"${pmin:.2f} – ${pmax:.2f}"
    elif pmin is not None:
        return f"From ${pmin:.2f}"
    elif pmax is not None:
        return f"Up to ${pmax:.2f}"
    return "Not listed"

def build_startup_embed(config: dict, stats: dict) -> dict:
    attractions = config.get("attractions", [])
    enabled = [a for a in attractions if a.get("enabled", True)]

    attraction_lines = []
    for a in enabled:
        name = a.get("name", "Unknown")
        url = a.get("artist_url", "")
        venue = a.get("venue_name", "")
        if url:
            attraction_lines.append(f"• [{name}]({url}) — {venue}")
        else:
            attraction_lines.append(f"• {name} — {venue}")

    polling = config.get("monitor", {}).get("polling_interval", 3.0)
    key_count = len(config.get("api", {}).get("keys", []))
    cooldown = config.get("api", {}).get("key_cooldown", 5.5)

    fields = [
        {
            "name": "🎯  Tracked Attractions",
            "value": "\n".join(attraction_lines) if attraction_lines else "None configured",
            "inline": False,
        },
        {
            "name": "⏱️  Polling Interval",
            "value": f"```\n{polling}s\n```",
            "inline": True,
        },
        {
            "name": "🔑  API Keys",
            "value": f"```\n{key_count} keys ({cooldown}s cooldown)\n```",
            "inline": True,
        },
        {
            "name": "📊  Throughput",
            "value": f"```\n~{key_count / cooldown:.1f} req/s max\n```",
            "inline": True,
        },
    ]

    if stats.get("tracked_events", 0) > 0:
        fields.append({
            "name": "📦  Resumed State",
            "value": (
                f"• {stats['tracked_events']} tracked events\n"
                f"• {stats.get('total_events_detected', 0)} total detections"
            ),
            "inline": False,
        })

    cookie_status = config.get("cookie_refresh", {}).get("enabled", False)
    fields.append({
        "name": "🍪  Cookie Auto-Refresh",
        "value": f"```\n{'✅ Enabled' if cookie_status else '❌ Disabled (Static Config)'}\n```",
        "inline": False,
    })

    return {
        "title": f"🚀  {BRAND_NAME} {VERSION} — ONLINE",
        "description": (
            "Monitor is now running and watching for new events.\n"
            "All detected changes will be reported to this channel."
        ),
        "color": SUCCESS_COLOR,
        "fields": fields,
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "thumbnail": {"url": BRAND_ICON},
    }

def build_shutdown_embed(reason: str, stats: dict, uptime: float) -> dict:
    return {
        "title": f"🛑  {BRAND_NAME} — OFFLINE",
        "description": f"Monitor has been shut down.\n**Reason:** {reason}",
        "color": ERROR_COLOR,
        "fields": [
            {
                "name": "⏱️  Uptime",
                "value": f"```\n{relative_time(uptime)}\n```",
                "inline": True,
            },
            {
                "name": "📊  Requests Made",
                "value": f"```\n{stats.get('total_requests', 0)}\n```",
                "inline": True,
            },
            {
                "name": "🎟️  Events Detected",
                "value": f"```\n{stats.get('total_events_detected', 0)}\n```",
                "inline": True,
            },
        ],
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

def build_heartbeat_embed(stats: dict, uptime: float, attractions_status: list[dict]) -> dict:
    attraction_lines = []
    for a in attractions_status:
        name = a.get("name", "Unknown")
        count = a.get("event_count", 0)
        attraction_lines.append(f"• **{name}** — {count} event(s) tracked")

    fields = [
        {
            "name": "⏱️  Uptime",
            "value": f"```\n{relative_time(uptime)}\n```",
            "inline": True,
        },
        {
            "name": "📊  API Requests",
            "value": f"```\n{stats.get('total_requests', 0)}\n```",
            "inline": True,
        },
        {
            "name": "❌  Errors",
            "value": f"```\n{stats.get('total_errors', 0)}\n```",
            "inline": True,
        },
    ]

    if attraction_lines:
        fields.append({
            "name": "🎯  Attraction Status",
            "value": "\n".join(attraction_lines),
            "inline": False,
        })

    key_stats = stats.get("key_stats", {})
    if key_stats:
        fields.append({
            "name": "🔑  Key Pool",
            "value": (
                f"```\n"
                f"{key_stats.get('available_keys', 0)}/{key_stats.get('total_keys', 0)} available  •  "
                f"{key_stats.get('total_requests', 0)} total uses\n"
                f"```"
            ),
            "inline": False,
        })

    return {
        "title": f"💓  {BRAND_NAME} — HEARTBEAT",
        "description": "Monitor is running normally.",
        "color": HEARTBEAT_COLOR,
        "fields": fields,
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

def build_error_embed(error_type: str, error_message: str,
                       details: str = "", module: str = "") -> dict:
    fields = [
        {
            "name": "🔍  Error Type",
            "value": f"```\n{error_type}\n```",
            "inline": True,
        },
        {
            "name": "📍  Module",
            "value": f"```\n{module or 'Unknown'}\n```",
            "inline": True,
        },
        {
            "name": "📝  Message",
            "value": f"```\n{error_message[:1000]}\n```",
            "inline": False,
        },
    ]

    if details:
        fields.append({
            "name": "📋  Details",
            "value": f"```\n{details[:800]}\n```",
            "inline": False,
        })

    return {
        "title": f"⚠️  {BRAND_NAME} — ERROR",
        "description": "An error occurred during monitoring.",
        "color": ERROR_COLOR,
        "fields": fields,
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

Research_COLOR = 0x00E676
Research_FAIL_COLOR = 0xFF5252

def build_research_success_embed(
    event, research_result, attraction_config: dict
) -> dict:
    pick = research_result.seat_pick
    seats_str = ", ".join(pick.seats) if pick else "N/A"
    qty = len(pick.seats) if pick else 0
    artist_name = attraction_config.get("name", "Unknown")

    venue_str = event.venue_name if hasattr(event, "venue_name") else ""
    desc_lines = [
        f"🎫 **{qty} seat(s) researchd** for **{artist_name}**!",
        "",
        f"📍 **{venue_str}**" if venue_str else "",
        f"📅 **{event.date_formatted}**" if hasattr(event, "date_formatted") else "",
        "",
        "⏳ **Seats held for ~8 minutes** — complete purchase immediately!",
    ]
    description = "\n".join(line for line in desc_lines if line is not None)

    fields = []

    if pick:

        from utils.seat_images import get_level_name
        level = get_level_name(pick.section)

        fields.extend([
            {
                "name": "💺  Section",
                "value": f"```fix\n{pick.section}\n```",
                "inline": True,
            },
            {
                "name": "📍  Row",
                "value": f"```fix\n{pick.row}\n```",
                "inline": True,
            },
            {
                "name": "🪑  Seats",
                "value": f"```fix\n{seats_str}\n```",
                "inline": True,
            },
        ])

        fields.append({
            "name": "🏟️  Level",
            "value": level,
            "inline": True,
        })

        mode_emoji = "⭐" if pick.is_preferred else "🎯"
        mode_label = "Preferred" if pick.is_preferred else "Auto-Pick"
        fields.append({
            "name": f"{mode_emoji}  Mode",
            "value": mode_label,
            "inline": True,
        })

        fields.append(_divider_field())

        svc = getattr(pick, "service_charges", 0.0)
        face = pick.list_price
        total_ea = pick.total_price
        total_all = total_ea * qty

        fields.extend([
            {
                "name": "💰  Face Value",
                "value": f"```\n${face:.2f}/ea\n```",
                "inline": True,
            },
            {
                "name": "📋  Service Fee",
                "value": f"```\n${svc:.2f}/ea\n```",
                "inline": True,
            },
            {
                "name": "💵  Total ({qty}x)",
                "value": f"```diff\n+ ${total_all:.2f} {pick.currency}\n```",
                "inline": True,
            },
        ])

    fields.append(_divider_field())

    fields.append({
        "name": "🛒  COMPLETE PURCHASE",
        "value": (
            f"### ⚡ [CLICK HERE TO CHECKOUT]({research_result.checkout_url})\n\n"
            f"⏰ **Timer is running!** Open in browser → log in → complete payment."
        ),
        "inline": False,
    })

    links = []
    if event.url:
        links.append(f"[🎟️ Event Page]({event.url})")
    artist_url = attraction_config.get("artist_url", "")
    if artist_url:
        links.append(f"[🎭 Artist]({artist_url})")
    if hasattr(event, "venue_url") and event.venue_url:
        links.append(f"[🏟️ Venue]({event.venue_url})")

    if links:
        fields.append({
            "name": "🔗  Quick Links",
            "value": "  ·  ".join(links),
            "inline": False,
        })

    fields.append({
        "name": "📋  Research ID",
        "value": f"```\n{research_result.request_id}\n```",
        "inline": False,
    })

    embed = {
        "title": "🎯  SEATS ResearchD — CHECKOUT NOW!",
        "description": description,
        "color": Research_COLOR,
        "fields": fields,
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if pick:

        image_url = get_section_image(pick.section, event.id if hasattr(event, "id") else "")
        if image_url:
            embed["image"] = {"url": image_url}

        event_id = event.id if hasattr(event, "id") else ""
        if event_id:
            map_url = get_section_map_image(pick.section, event_id, width=300)
            if map_url:
                embed["thumbnail"] = {"url": map_url}
    elif hasattr(event, "thumbnail_url") and event.thumbnail_url:
        embed["thumbnail"] = {"url": event.thumbnail_url}

    return embed

def build_research_failure_embed(
    event, research_result, attraction_config: dict
) -> dict:
    pick = research_result.seat_pick
    artist_name = attraction_config.get("name", "Unknown")

    desc_lines = [
        f"Could not auto-research seats for **{artist_name}**.",
        "",
        "**Next steps:**",
        "1. Try purchasing manually via the link below",
        "2. If `Research_FAILURE` — seats may be sold out or pricing changed",
        "3. If `WAF_BLOCKED` — tmpt cookie needs refresh",
    ]

    fields = [
        {
            "name": "📅  Event",
            "value": f"**{event.name}**",
            "inline": False,
        },
        {
            "name": "❌  Error",
            "value": f"```\n{research_result.error_message}\n```",
            "inline": True,
        },
        {
            "name": "📋  Code",
            "value": f"```\n{research_result.error_code}\n```",
            "inline": True,
        },
    ]

    if pick:
        fields.append(_divider_field())
        fields.extend([
            {
                "name": "💺  Attempted Section",
                "value": f"```\n{pick.section} / Row {pick.row}\n```",
                "inline": True,
            },
            {
                "name": "💰  Price Used",
                "value": f"```\n${pick.list_price:.2f} + ${getattr(pick, 'service_charges', 0):.2f} svc\n```",
                "inline": True,
            },
        ])

    if event.url:
        fields.append(_divider_field())
        fields.append({
            "name": "🚨  MANUAL PURCHASE",
            "value": f"### [CLICK HERE TO BUY MANUALLY]({event.url})",
            "inline": False,
        })

    return {
        "title": "⚠️  AUTO-Research FAILED",
        "description": "\n".join(desc_lines),
        "color": Research_FAIL_COLOR,
        "fields": fields,
        "footer": _footer(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
