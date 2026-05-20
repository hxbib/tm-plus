# Ticketmaster+

A real-time artist/event monitoring system that tracks Ticketmaster attractions for specific "artists", detects new events and status changes as they happen, and alerts via Discord Webhook

![Python](https://img.shields.io/badge/Python-3.13+-blue)
![JavaScript](https://img.shields.io/badge/JavaScript-29.0%25-yellow)
![Rust](https://img.shields.io/badge/Rust-15.3%25-orange)
![HTML](https://img.shields.io/badge/HTML-13.2%25-red)
![CSS](https://img.shields.io/badge/CSS-4.0%25-blue)

---

## **Overview**

Ticketmaster+ continuously polls the Ticketmaster Discovery API across multiple tracked attractions. When something changes — a new event appears, ticket status shifts from `offsale` to `onsale`, prices update, or sale dates move — it sends detailed Discord webhook notifications with venue imagery (for MSG specific events - a section POV image), pricing breakdowns, and direct links.

The system is designed to run 24/7. State persists across restarts, failed notifications retry automatically from a durable queue, and API keys rotate with per-key cooldowns to stay within rate limits.

---

## Why I Built This

The New York Knicks are in the Eastern Conference Finals, again. They'll make the Finals this year - I can feel it. I suffered with the Knicks my entire life, and really want the best seats in the house for their watch parties at MSG when the Knicks are on the road.

Game 1 of the Eastern Conference Finals is going overtime as I'm writing this.........

---

## Tech Stack


| Layer         | Technology                                                           |
| ------------- | -------------------------------------------------------------------- |
| Runtime       | Python 3.13, `asyncio`                                               |
| HTTP          | `curl_cffi`                                                          |
| API           | Ticketmaster Discovery API v2 (REST)                                 |
| Notifications | Discord webhooks with rate-limit tracking and persistent retry queue |
| Deployment    | Docker, healthcheck, volume-backed state                             |


---

## Architecture

```
main.py
└── MonitorOrchestrator
    ├── EventMonitor (per attraction)   ← polls Discovery API on configurable interval
    ├── StatusMonitor                   ← re-checks all tracked events for changes
    ├── DiscordNotifier
    │   └── WebhookQueue               ← durable on-disk queue for failed deliveries
    ├── APIKeyRotator                   ← round-robin key pool with per-key cooldowns
    ├── TicketmasterClient              ← TLS-impersonating HTTP client
    └── StateManager                    ← JSON persistence with atomic writes
```

---

## Deployment

### Prerequisites

- Python 3.13+
- A Ticketmaster Discovery API key ([developer.ticketmaster.com](https://developer.ticketmaster.com/))
- A Discord webhook URL

### Local

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Create config.json — add your API key(s), webhook URL, and attractions
python main.py
```

### Docker

```bash
docker build -t ticketmaster-plus .
docker run -d \
  --name tm-plus \
  --restart unless-stopped \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v $(pwd)/state:/app/state \
  ticketmaster-plus
```

---

## Configuration

```jsonc
{
  "monitor": {
    "polling_interval": 123.0,       // seconds between Discovery API polls
    "status_check_interval": 230.0,  // seconds between status re-checks
    "heartbeat_interval": 8800       // seconds between heartbeat webhooks
  },
  "attractions": [
    {
      "name": "NY Knicks",
      "attraction_id": "K8vZ917_-V7",
      "enabled": true
    }
  ],
  "api": {
    "keys": ["your-discovery-api-key"],
    "key_cooldown": 5.5,             // per-key cooldown in seconds
    "max_retries": 5
  },
  "discord": {
    "webhook_url": "https://discord.com/api/webhooks/...",
    "error_webhook_url": "https://discord.com/api/webhooks/...",
    "max_retries": 19
  },
  "notifications": {
    "new_event": true,
    "status_change": true,
    "price_change": true,
    "sale_date_change": true,
    "event_removed": true
  },
  "logging": {
    "level": "INFO",
    "file_logging": true,
    "console_colors": true
  }
}
```

---

## Google Chrome Extensions

Google Chrome extension to harvest tmpt cookies (tmpt cookie issued via Ticketmaster after ReCaptcha v3 Enterprise challenge is solved on browser with high trust score). There are 5 extensions, that all do the same exact thing. The only differences between them is the UI. I used Claude Design, v0 by Vercel, Replit, and Lovable. It was nice seeing all of their takes on the UI.
