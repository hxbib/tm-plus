from __future__ import annotations

from dataclasses import dataclass, field
from utils.helpers import safe_get

@dataclass
class Venue:

    id: str
    tm_us_id: str
    name: str
    url: str
    city: str = ""
    state: str = ""
    country: str = ""
    address: str = ""
    postal_code: str = ""
    location: str = ""
    latitude: float | None = None
    longitude: float | None = None

    raw: dict = field(default_factory=dict, repr=False)

    @classmethod
    def from_api_response(cls, data: dict) -> "Venue":
        city = safe_get(data, "city", "name", default="")
        state = safe_get(data, "state", "stateCode", default="")
        country = safe_get(data, "country", "countryCode", default="")
        location = ", ".join(filter(None, [city, state, country]))

        lat = safe_get(data, "location", "latitude")
        lng = safe_get(data, "location", "longitude")

        return cls(
            id=data.get("id", ""),
            tm_us_id=safe_get(data, "references", "ticketmaster-us", default=""),
            name=data.get("name", "Unknown Venue"),
            url=data.get("url", ""),
            city=city,
            state=state,
            country=country,
            address=safe_get(data, "address", "line1", default=""),
            postal_code=safe_get(data, "postalCode", default=""),
            location=location,
            latitude=float(lat) if lat else None,
            longitude=float(lng) if lng else None,
            raw=data,
        )
