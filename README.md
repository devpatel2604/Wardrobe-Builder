# Wardrobe Builder

A private wardrobe app for one person. It runs as a web app that is saved to the iPhone Home Screen. So far it has the profile, the wardrobe catalog, the color photo test and backup.

## What works today

- **Profile.** Build and coloring, sizes, the week, stores, rules grouped by kind (hard rules, defaults, soft preferences, open tests) and a starting color palette. Every section except the palette can be edited.
- **Wardrobe.** Add, edit and delete pieces. Each piece has photos, the slot it fills in an outfit, color, texture, neckline, fit, hem, dress level, cloth, hardware color, warmth, and free tags. Pieces you own are kept apart from pieces you are thinking about.
- **Rule checks.** A piece is checked against the hard rules in the profile while you fill in the form: leather clothing, gold or brass hardware, boxy or long shapes.
- **Color photo test.** Photograph each color under your chin with an on-screen guide, pick the better of two photos again and again, and get your own ranking of colors near the face. You set the verdict for each color and save it to the palette, and you can undo that. See "The color photo test" below.
- **Backup.** Export everything to one file, restore it, or erase the phone's copy.
- **Offline.** After the first visit the app opens with no connection.

Not built yet: outfits for today and the week, the buy-next list, saved inspiration, photo cut-outs, AI tagging, and the server (share-menu inbox, AI proxy, reminders, automatic backup).

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
| Tests | Vitest, Testing Library, fake-indexeddb | Screens are tested against a real (in-memory) database |

```
src/
  domain/     types, the lists of choices, and the rule checks (no storage, no UI)
  data/       the database and everything that reads or writes it
  screens/    one file per screen (the color test's screens are in screens/colorTest)
  ui/         shared controls and the camera helper
  test/       test setup and made-up sample data
examples/     a made-up setup file
```

Screens never touch the database directly. They call the modules in `src/data`, so a server can be added behind the same calls later.

## Data

Everything lives in five tables in the browser's IndexedDB.

| Table | Holds |
| --- | --- |
| `profile` | One document: body, coloring, sizes, week, stores, rules, palette |
| `pieces` | One row per piece, with its tags |
| `photos` | Photo bytes and a thumbnail, linked to a piece, each with a privacy class |
| `meta` | Saved settings as key and value. Never exported |
| `colorTests` | One row: the colors chosen, which photo belongs to which color, every pick, and what was saved to the palette |

The types are in `src/domain/types.ts`.

**Photo privacy class.** Each photo is `clothing`, `inspiration` or `of-me`. Photos of the owner (`of-me`) are left out of a backup unless asked for, and restoring a backup does not delete them.

**Rules drive the checks.** A rule in the profile can carry a `check` (for example `no-leather-clothing`). The app runs a check only while a rule asks for it, so deleting the rule in the profile turns the check off.

### File format

Export and setup files share one JSON format (`src/data/backup.ts`).

| `kind` | Made by | Loading it |
| --- | --- | --- |
| `backup` | Settings, "Make a backup file" | Replaces everything on the phone, except photos of the owner, which stay |
| `setup` | Written outside the app | Replaces the profile and adds pieces that are not there yet. Photos and existing pieces are kept, and saved color test results are written back onto the new palette |

The format is at version 2, which added `colorTest`. Version 1 files still load.

## The color photo test

The test follows the design in the coloring report: no measuring of skin from a photo, only the owner's own picks.

1. **Photos.** The capture screen runs the camera inside the app, with an oval for the face, a line for where the color goes, a timer, and a faint copy of the first photo to line every later one up with. Photos are cut to a 3:4 portrait and a selfie is saved the way the preview showed it. If the camera will not open inside the app, the screen falls back to the phone's own camera or the photo library.
2. **Compare.** Two photos side by side, tap the better one. "About the same" counts as half a win each. Pairs are chosen like rounds of a chess tournament: colors with the fewest comparisons first, and among those the two closest in the standings. Twelve colors need about 30 picks, not all 66 pairs.
3. **Ranking.** Picks become strengths with the Bradley-Terry method (`rankColors` in `src/domain/colorTest.ts`). Each color also gets one imaginary tie against an average color, so one lucky win cannot top the list.
4. **Palette.** The app proposes a verdict per color (best, fine, not near the face) and the owner can change each one. Saving writes every tested color into the profile's palette as its own entry, with `family`, `evidence: 'your-test'` and a `test` record, and removes those colors from the stylists' grouped entries. Untested colors stay. The palette from before is kept so the save can be undone, and a later setup file does not wipe the results.

Code that scores outfits should look up a palette entry by `family` and read `test.verdict` when it is there. The free-text `nearFace` is for display and for entries that were never tested.

**Privacy.** Color-test photos are stored as `of-me` photos, with `pieceId` set to `color-test:<color>`. They are never written to a backup file, even one that includes other photos of the owner. The picks, the ranking and the saved results are. The owner can delete the photos and keep the results.

**Limits to know.** The phone picks its own exposure and white balance for each shot, and a web page cannot lock them on an iPhone. A large block of strong color can shift the whole photo a little. The capture tips (same spot, daylight, one sitting) reduce this but do not remove it. The camera screen has been run in desktop Chromium with a fake camera at iPhone sizes, not yet on a real iPhone.

## iPhone notes

- The manifest uses `display: standalone`. Keep it. An app on the Home Screen is spared Safari's seven-day clearing of site data.
- The app asks the browser to protect its storage (`navigator.storage.persist()`), and Settings shows the answer.
- An app on the Home Screen has its own storage, separate from Safari. Data saved in a Safari tab does not move over, so load the setup file after installing.
- Inputs use 16-pixel text so Safari does not zoom in on focus.
- The camera needs a secure address (https, or localhost while developing) and the `playsinline` attribute on the video, or iPhone opens it full screen. iPhone may ask for camera permission again each time the app is opened.
