# SkyBlock HUD

A personal [DeskThing](https://github.com/itsriprod/deskthing-apps) app that shows my own Hypixel SkyBlock stats on a Spotify Car Thing display.

Single user, personal use. It does not expose or proxy the Hypixel API to anyone else.

## Features

- **Home**: purse, bank, total coins, SkyBlock level, skill average, session coin gain and coins/hour, active pet, mayor, essence
- **Skills**: level, progress bar, XP to next level, and session XP gain per skill
- **Combat**: slayer levels, Catacombs level, dungeon class levels
- **Collect**: top collections
- **Market**: Bazaar prices and Lowest BIN for a watchlist, with trend sparklines
- **Auctions**: active listings and items ready to claim
- Turn the dial to switch between tabs

## API usage

Light by design: with the default 2-minute refresh the app makes 2 authenticated Hypixel requests per refresh (profile and auctions). Bazaar and resource data are public endpoints and are refreshed every 5 minutes or less often. Failed requests back off automatically.

## Setup

1. Get an API key from the [Hypixel Developer Dashboard](https://developer.hypixel.net).
2. Install the app in DeskThing, open its settings and enter:
   - Hypixel API Key
   - Minecraft UUID (no dashes)
   - Optional: profile name, refresh interval, Bazaar and Lowest BIN watchlists (comma-separated item IDs)

The API key is only stored in DeskThing's settings. It is never part of this repository.

## Build

```bash
npm install
npm run build
```

Install the generated zip in DeskThing.

## Notes

- Bank balance needs the Banking API enabled in-game for co-op profiles.
- Lowest BIN data comes from third-party community APIs and may occasionally be unavailable.
