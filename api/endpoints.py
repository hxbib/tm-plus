from __future__ import annotations

BASE_URL = "https://app.ticketmaster.com/discovery/v2"

EVENTS_SEARCH   = f"{BASE_URL}/events.json"
EVENT_DETAIL    = f"{BASE_URL}/events/{{event_id}}.json"
EVENT_IMAGES    = f"{BASE_URL}/events/{{event_id}}/images.json"

ATTRACTIONS_SEARCH = f"{BASE_URL}/attractions.json"
ATTRACTION_DETAIL  = f"{BASE_URL}/attractions/{{attraction_id}}.json"

VENUES_SEARCH = f"{BASE_URL}/venues.json"
VENUE_DETAIL  = f"{BASE_URL}/venues/{{venue_id}}.json"

SUGGEST = f"{BASE_URL}/suggest.json"

TM_EVENT_URL   = "https://www.ticketmaster.com/event/{tm_us_id}"
TM_ARTIST_URL  = "https://www.ticketmaster.com/artist/{tm_us_id}"
TM_VENUE_URL   = "https://www.ticketmaster.com/venue/{tm_us_id}"

def event_search_url() -> str:
    return EVENTS_SEARCH

def event_detail_url(event_id: str) -> str:
    return EVENT_DETAIL.format(event_id=event_id)

def event_images_url(event_id: str) -> str:
    return EVENT_IMAGES.format(event_id=event_id)

def attraction_detail_url(attraction_id: str) -> str:
    return ATTRACTION_DETAIL.format(attraction_id=attraction_id)

def venue_detail_url(venue_id: str) -> str:
    return VENUE_DETAIL.format(venue_id=venue_id)

def web_event_url(tm_us_id: str) -> str:
    return TM_EVENT_URL.format(tm_us_id=tm_us_id)

def web_artist_url(tm_us_id: str) -> str:
    return TM_ARTIST_URL.format(tm_us_id=tm_us_id)

def web_venue_url(tm_us_id: str) -> str:
    return TM_VENUE_URL.format(tm_us_id=tm_us_id)
