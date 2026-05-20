from __future__ import annotations

from dataclasses import dataclass, field
from utils.helpers import safe_get, select_best_image, select_thumbnail

@dataclass
class Attraction:

    id: str
    tm_us_id: str
    name: str
    url: str
    active: bool = True

    image_url: str | None = None
    thumbnail_url: str | None = None

    upcoming_events_count: int = 0
    upcoming_events_by_country: dict = field(default_factory=dict)

    segment: str = ""
    genre: str = ""
    sub_genre: str = ""

    raw: dict = field(default_factory=dict, repr=False)

    @classmethod
    def from_api_response(cls, data: dict) -> "Attraction":
        images = data.get("images", [])

        upcoming = data.get("upcomingEvents", {})
        total_upcoming = upcoming.get("ticketmaster", 0)
        if not total_upcoming:
            total_upcoming = upcoming.get("_total", 0)

        classifications = data.get("classifications", [])
        segment = genre = sub_genre = ""
        if classifications:
            c = classifications[0]
            segment = safe_get(c, "segment", "name", default="")
            genre = safe_get(c, "genre", "name", default="")
            sub_genre = safe_get(c, "subGenre", "name", default="")

        return cls(
            id=data.get("id", ""),
            tm_us_id=safe_get(data, "references", "ticketmaster-us", default=""),
            name=data.get("name", "Unknown"),
            url=data.get("url", ""),
            active=data.get("active", True),
            image_url=select_best_image(images),
            thumbnail_url=select_thumbnail(images),
            upcoming_events_count=total_upcoming,
            upcoming_events_by_country=upcoming,
            segment=segment,
            genre=genre,
            sub_genre=sub_genre,
            raw=data,
        )
