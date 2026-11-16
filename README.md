# Wardrobe Builder

A private wardrobe app for one person. It runs as a web app that is saved to the iPhone Home Screen. This is the foundation: the profile, the wardrobe catalog, and backup.

## What works today

- **Profile.** Build and coloring, sizes, the week, stores, rules grouped by kind (hard rules, defaults, soft preferences, open tests) and a starting color palette. Every section except the palette can be edited.
- **Wardrobe.** Add, edit and delete pieces. Each piece has photos, the slot it fills in an outfit, color, texture, neckline, fit, hem, dress level, cloth, hardware color, warmth, and free tags. Pieces you own are kept apart from pieces you are thinking about.
- **Rule checks.** A piece is checked against the hard rules in the profile while you fill in the form: leather clothing, gold or brass hardware, boxy or long shapes.
- **Backup.** Export everything to one file, restore it, or erase the phone's copy.
- **Automatic backup.** About once a day the app encrypts a copy on the phone and uploads it to the small server, which cannot read it. A new phone restores it with the app key and the recovery code.
- **Evening reminder.** On the evening before an office day the small server sends one alert with the next morning's forecast.
- **Offline.** After the first visit the app opens with no connection. The server is only needed for backup and reminders.

Not built yet: the color photo test, outfits for today and the week, the buy-next list, saved inspiration, photo cut-outs, AI tagging, and the rest of the server (share-menu inbox, AI proxy).

## No personal data in this repository

The code and the built app hold no profile and no wardrobe. On first run the app shows a welcome screen with two choices: load a **setup file**, or start empty. The owner's setup file is kept outside this repository. `examples/sample-setup.json` is a made-up one for trying the app.

Keep it that way. Tests use the made-up data in `src/test/fixtures.ts`.

## Run it

Needs Node 22 or later.

```sh
npm install
npm run dev        # local server with reload
npm test           # unit and screen tests
npm run lint
npm run typecheck
npm run build      # production build in dist/
npm run preview    # serve the production build
```

To try it, open the local address, choose "Load a setup file or backup" and pick `examples/sample-setup.json`.

## How it is built

| Part | Choice | Why |
| --- | --- | --- |
| Framework | React and TypeScript, built with Vite | Small, well known, fast to test |
| Storage | IndexedDB on the phone, through Dexie | Works offline and needs no account |
| Photos | Shrunk on the phone to 1600 pixels plus a thumbnail, stored as bytes | Browser storage is limited, and a camera photo is several megabytes |
| Install and offline | Web app manifest and a service worker (vite-plugin-pwa) | Opens from the Home Screen like an app |
| Routing | Hash routes and relative asset paths | The build runs from any static host and any sub-path |
| Hosting | Cloudflare: static files plus a small server under `/api` | Free, and one account covers both |
| Server storage | Cloudflare D1 (a small SQL database) | Needs no payment card, unlike Cloudflare's file storage |
| Tests | Vitest, Testing Library, fake-indexeddb | Screens are tested against a real (in-memory) database |

```
src/
  domain/     types, the lists of choices, and the rule checks (no storage, no UI)
  data/       the database and everything that reads or writes it
  screens/    one file per screen
  ui/         shared controls
  test/       test setup and made-up sample data
server/       the small server that Cloudflare runs under /api
public/       icons, security headers, and the alert handler (push-sw.js)
examples/     a made-up setup file
```

Screens never touch the database directly. They call the modules in `src/data`, so a server can be added behind the same calls later.

## Data

Everything lives in four tables in the browser's IndexedDB.

| Table | Holds |
| --- | --- |
| `profile` | One document: body, coloring, sizes, week, stores, rules, palette |
| `pieces` | One row per piece, with its tags |
| `photos` | Photo bytes and a thumbnail, linked to a piece, each with a privacy class |
| `meta` | Saved settings as key and value: the app key, the recovery code, backup and reminder state. Never exported, never uploaded |

The types are in `src/domain/types.ts`.

**Photo privacy class.** Each photo is `clothing`, `inspiration` or `of-me`. Photos of the owner (`of-me`) are left out of a backup unless asked for, and restoring a backup does not delete them.

**Rules drive the checks.** A rule in the profile can carry a `check` (for example `no-leather-clothing`). The app runs a check only while a rule asks for it, so deleting the rule in the profile turns the check off.

### File format

Export and setup files share one JSON format (`src/data/backup.ts`).

| `kind` | Made by | Loading it |
| --- | --- | --- |
| `backup` | Settings, "Make a backup file" | Replaces everything on the phone |
| `setup` | Written outside the app | Replaces the profile and adds pieces that are not there yet. Photos and existing pieces are kept |

## Hosting

Cloudflare builds the app from this repository on each push and runs it as one Worker (`wrangler.jsonc`). Static files are served directly. Requests under `/api` go to the small server in `server/`.

| Setting in Cloudflare | Value |
| --- | --- |
| Worker name | `wardrobe-builder` (must match `name` in `wrangler.jsonc`) |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 22, from `.nvmrc` |
| Secret `APP_KEY` | The app key, 20 characters or more. Set it in the dashboard: the Worker, then Settings, then Variables and Secrets. Never put it in this repository |

The database has no id in `wrangler.jsonc`, so the first deploy creates one named `wardrobe-builder`. The server creates its own tables on first use. If a deploy ever fails on the database, create a D1 database by hand in the dashboard and add its id as `database_id`.

`public/_headers` sets the security headers the host sends with every file. The content security policy lets the app load code, images and data only from its own address. The small server is at the same address, so it needs no entry. A feature that calls an outside service (weather, an Instagram iframe) has to add that address there, or the browser will block it.

To run everything locally the way Cloudflare does:

```sh
npm run build
npx wrangler dev --var APP_KEY:any-local-key-of-20-chars
```

Then open the address it prints. `npm run dev` also reaches the server while `wrangler dev` is running.

Browser storage belongs to one web address. Install the app to the Home Screen from the main address, not from a preview address, or its data will not follow.

## The small server

The server does the few things a web app on an iPhone cannot do alone. It never picks an outfit, never reads a backup and never visits a store. If it is down the app still works.

Every route except `/api/health` needs the header `Authorization: Bearer <app key>`. Until `APP_KEY` is set, the server refuses everything.

| Route | What it does |
| --- | --- |
| `GET /api/health` | Says a server is here and whether it has its key. Nothing else |
| `GET /api/status` | Backup count, reminder count, and the public key for alerts |
| `GET /api/backup` | Lists stored snapshots and photo ids |
| `PUT` and `GET /api/backup/photos/:id` | One encrypted photo |
| `POST /api/backup/snapshots` | Stores a snapshot. Refused if it names a photo the server lacks |
| `GET /api/backup/snapshots/:id` | One snapshot. `latest` gives the newest |
| `PUT` and `DELETE /api/reminders` | Turns the evening reminder on or off for one device |
| `POST /api/reminders/test` | Sends one alert now |
| `GET /api/forecast?lat=&lon=` | Hourly forecast from the US National Weather Service, for a point rounded to two decimals |
| `DELETE /api/data` | Erases everything the server holds |

**Backup.** A backup is a *snapshot* (the export file without photo bytes, plus a list of photos) and the photos it names. Each photo is uploaded once and shared between snapshots. The phone encrypts each item with AES-256-GCM before upload (`src/data/vault.ts`). The key comes from a 256-bit *recovery code* that is made on the phone and never sent. The server keeps the 7 newest snapshots and deletes photos no snapshot names. Photos with the class `of-me` are never uploaded.

**Reminder.** The phone gets an alert address from its push service (Apple's, on an iPhone) and gives it to the server with the office days, the hour and the time zone. A job runs each hour, and sends the alert when the phone's own clock reaches the chosen hour on the evening before an office day. The message is encrypted for the phone (RFC 8291) and signed (RFC 8292) with keys the server makes on first use (`server/push.ts`). It uses the declarative form, so iOS 18.4 and later show it without waking the app. `public/push-sw.js` shows it on older systems.

**What the server holds.** Encrypted backups, each device's alert address with its reminder settings (office days, hour, time zone, forecast point), and its own signing keys. No profile, no wardrobe, no readable photo.

**Tests.** `server/*.test.ts` run the server code against a local copy of the Cloudflare database. `src/data/serverBackup.test.ts` runs the app's backup and restore against that same server code, so the two cannot drift apart.

## iPhone notes

- The manifest uses `display: standalone`. Keep it. An app on the Home Screen is spared Safari's seven-day clearing of site data.
- The app asks the browser to protect its storage (`navigator.storage.persist()`), and Settings shows the answer.
- An app on the Home Screen has its own storage, separate from Safari. Data saved in a Safari tab does not move over, so load the setup file after installing.
- Inputs use 16-pixel text so Safari does not zoom in on focus.
- Alerts work only in the app opened from the Home Screen, on iOS 16.4 or later. The request for permission must come from a tap.
- A web app cannot run in the background, so the automatic backup happens when the app is opened.
