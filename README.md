# F1 Rain Radar

Live rain radar, session forecasts and wet-race history for every Formula 1 Grand Prix.
A static site on GitHub Pages, kept up to date automatically by a scheduled GitHub Action.

## How it works

```
                 hourly GitHub Action (.github/workflows/site.yml)
 Jolpica F1 ─┐
 RainViewer ─┼─► scripts/sync.ts ──► JSON on the `data` branch ──► Astro build ──► GitHub Pages
 Open-Meteo ─┤                                                          ▲
 f1-circuits ┘                                                          │
                                           browser fetches live radar ──┘ (RainViewer)
```

- **`main` branch:** code only.
- **`data` branch:** generated JSON, committed by the Action. Locally it lives in the gitignored `./data` folder.
- The sync script decides what to do on each run:
  - **Daily:** checks the schedule for every season from 2023 to next year, so a new season appears as soon as it's published. Adds new circuits with their time zone, track outline and radar coverage.
  - **Every run:** works out which race the home page should feature (`meta.json → siteState`). When that changes, for example when a race weekend starts or ends, the site is rebuilt.
- The site is only rebuilt when the data actually changes, or when you push to `main`.

## Data sources

| Source | Used for | Terms |
|---|---|---|
| [Jolpica F1](https://github.com/jolpica/jolpica-f1) | Schedule, circuits | Free, no key |
| [RainViewer](https://www.rainviewer.com/api.html) | Live radar (past 2 h), coverage mask | Personal/educational use, attribution required |
| [Open-Meteo](https://open-meteo.com/) | Circuit time zones (forecasts coming next) | CC BY 4.0, non-commercial |
| [OpenF1](https://openf1.org/) | Measured track weather, tyre stints (coming next) | CC BY-NC-SA 4.0 |
| [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) | Track outlines | MIT |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Base map | ODbL, attribution required |

## Local development

Requires Node.js 22 or newer.

```sh
npm install
npm run sync      # fetch data into ./data (first run takes about a minute)
npm run dev       # http://localhost:4321/F1RainRadar/
```

Add `?radar` to any race page URL to force the live radar on outside a race weekend.

Other commands:

```sh
npm test            # unit tests
npm run typecheck   # Astro + TypeScript checks
npm run build       # static build into ./dist
npm run sync:force  # refresh all data, ignoring cache ages
```

## Publishing on GitHub Pages

1. Create a GitHub repository (for example `F1RainRadar`) and push `main`.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Go to **Actions → "Sync data & deploy" → Run workflow**. The first run creates the `data` branch and deploys the site to `https://<user>.github.io/<repo>/`.

After that, everything runs by itself. If the scheduled sync fails 3 times in a row, the workflow opens an issue labelled `sync-failure`, and closes it again once a run succeeds.

## Project layout

```
scripts/sync.ts           hourly sync entry point
scripts/lib/              API clients (Jolpica, Open-Meteo, outlines, radar coverage), storage
src/lib/schemas.ts        zod schemas shared by the sync script and the site
src/lib/weekend.ts        race weekend windows, home page state
src/pages/                home, /[season]/, /[season]/[race]/
src/components/           hero, calendar, radar, sessions, world map
src/scripts/              browser code (radar animation, time zones, countdowns)
tests/                    Vitest unit tests with saved API responses
```

## Roadmap

- [x] Milestone 1: skeleton, Pages deploy, `data` branch, schedule sync, calendar
- [x] Milestone 2: next-race hero, countdown, live radar loop, circuit outline, automatic coverage detection
- [ ] Milestone 3: Open-Meteo session forecasts and forecast snapshot archive
- [ ] Milestone 4: OpenF1 measured weather timeline, tyre strategy chart, forecast vs actual
- [ ] Milestone 5: wet-race history per circuit since 2000
- [ ] Milestone 6: standings, off-season champions, polish

Unofficial fan project, not associated with Formula 1. F1 and FORMULA 1 are trademarks of Formula One Licensing B.V.
