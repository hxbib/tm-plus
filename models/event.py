from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from utils.helpers import (
    build_event_url,
    extract_price_range,
    extract_sale_dates,
    extract_status,
    extract_ticket_limit,
    extract_venue_info,
    format_event_date,
    format_event_date_short,
    safe_get,
    select_best_image,
    select_thumbnail,
)

@dataclass
class Event:

    id: str
    tm_us_id: str
    name: str
    url: str
    status: str

    date_info: dict = field(default_factory=dict)
    date_formatted: str = ""
    date_short: str = ""
    timezone: str = ""

    venue_name: str = ""
    venue_url: str = ""
    venue_city: str = ""
    venue_state: str = ""
    venue_location: str = ""
    venue_id: str = ""

    price_min: float | None = None
    price_max: float | None = None
    ticket_limit: int | None = None

    sale_start: str | None = None
    sale_end: str | None = None
    sale_tbd: bool = False
    presales: list[dict] = field(default_factory=list)

    image_url: str | None = None
    thumbnail_url: str | None = None

    attraction_names: list[str] = field(default_factory=list)

    raw: dict = field(default_factory=dict, repr=False)

    @classmethod
    def from_api_response(cls, data: dict) -> "Event":
        event_id = data.get("id", "")
        tm_us_id = safe_get(data, "references", "ticketmaster-us", default="")
        if not tm_us_id:
            tm_us_id = safe_get(data, "source", "id", default="")

        venue = extract_venue_info(data)

        price_min, price_max = extract_price_range(data)

        sales = extract_sale_dates(data)

        images = data.get("images", [])

        attractions = safe_get(data, "_embedded", "attractions", default=[])
        attraction_names = [a.get("name", "") for a in attractions if a.get("name")]

        date_info = safe_get(data, "dates", "start", default={})

        return cls(
            id=event_id,
            tm_us_id=tm_us_id,
            name=data.get("name", "Unknown Event"),
            url=build_event_url(data),
            status=extract_status(data),
            date_info=date_info,
            date_formatted=format_event_date(date_info),
            date_short=format_event_date_short(date_info),
            timezone=safe_get(data, "dates", "timezone", default=""),
            venue_name=venue["name"],
            venue_url=venue["url"],
            venue_city=venue["city"],
            venue_state=venue["state"],
            venue_location=venue["location"],
            venue_id=venue["id"],
            price_min=price_min,
            price_max=price_max,
            ticket_limit=extract_ticket_limit(data),
            sale_start=sales["public_start"],
            sale_end=sales["public_end"],
            sale_tbd=sales["public_tbd"],
            presales=sales["presales"],
            image_url=select_best_image(images),
            thumbnail_url=select_thumbnail(images),
            attraction_names=attraction_names,
            raw=data,
        )

    @property
    def price_display(self) -> str:
        if self.price_min is not None and self.price_max is not None:
            if self.price_min == self.price_max:
                return f"${self.price_min:.2f}"
            return f"${self.price_min:.2f} – ${self.price_max:.2f}"
        elif self.price_min is not None:
            return f"From ${self.price_min:.2f}"
        elif self.price_max is not None:
            return f"Up to ${self.price_max:.2f}"
        return "Not listed"

    @property
    def ticket_limit_display(self) -> str:
        if self.ticket_limit:
            return f"{self.ticket_limit} per order"
        return "Not specified"

    def to_state_dict(self) -> dict:
        return {
            "name": self.name,
            "status": self.status,
            "url": self.url,
            "date": self.date_short,
            "venue_name": self.venue_name,
            "price_min": self.price_min,
            "price_max": self.price_max,
            "ticket_limit": self.ticket_limit,
            "sale_start": self.sale_start,
            "sale_end": self.sale_end,
        }
