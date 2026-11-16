# Wardrobe Builder

A private wardrobe app for one person. It runs as a web app that is saved to the iPhone Home Screen. So far it has the profile, the wardrobe catalog, the color photo test, backup, and outfits for today and the week.

## What works today

- **Profile.** Build and coloring, sizes, the week, stores, rules grouped by kind (hard rules, defaults, soft preferences, open tests) and a starting color palette. Every section except the palette can be edited.
- **Wardrobe.** Add, edit and delete pieces. Each piece has photos, the slot it fills in an outfit, color, texture, neckline, fit, hem, dress level, cloth, hardware color, warmth, and free tags. Pieces you own are kept apart from pieces you are thinking about.
- **Adding a piece.** Start from a pasted cut-out, a photo, a store page link, or something sent from the iPhone share menu. Whatever comes in waits in a list on the phone until it is saved, so nothing is lost if the app reloads. A photo that still has its background can be cropped. With an AI key on the server, a model suggests the tags and every field it filled is marked until you change it. With no key, the same screens work and you fill in the tags by hand. See "Adding a piece" below.
- **Rule checks.** A piece is checked against the hard rules in the profile while you fill in the form: leather clothing, gold or brass hardware, boxy or long shapes.
- **Color photo test.** Photograph each color under your chin with an on-screen guide, pick the better of two photos again and again, and get your own ranking of colors near the face. You set the verdict for each color and save it to the palette, and you can undo that. See "The color photo test" below.
- **Today.** One outfit for the occasion and the weather, two alternates, and the reasons. "Wore it", "Swap a piece", "Not today" with an optional reason, and "Build around a piece". From 6 pm it opens on tomorrow when tomorrow has something planned.
- **Week.** The next seven days: the office on office days plus any occasion you add, with no main top repeated where the wardrobe allows it. A coverage grid counts the outfits you can make for each occasion on a dry day and on a wet one, and says what kind of piece would fill an empty cell.
- **Weather.** The hourly forecast from the US National Weather Service for the hours of each occasion. With no forecast you set the temperature and rain by hand.
- **Backup.** Export everything to one file, restore it, or erase the phone's copy.
- **Automatic backup.** About once a day the app encrypts a copy on the phone and uploads it to the small server, which cannot read it. A new phone restores it with the app key and the recovery code.
- **Evening reminder.** On the evening before an office day the small server sends one alert with the next morning's forecast.
- **Looks.** Save an outfit you like from a post. Paste the link and the post plays in Instagram's own player. Add your own screenshots, and the pieces are listed by slot, by hand or read from the screenshots by an AI model. Once you have checked them, the app shows your version of the look after your rules, what you already own for it and what is missing. See "Saved looks" below.
- **Offline.** After the first visit the app opens with no connection. The server is only needed for backup and reminders.

Not built yet: the buy-next list and the "what I've learned" page.

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
    outfits/  how outfits are picked: build, filter, score, pick, explain
  data/       the database and everything that reads or writes it
  screens/    one file per screen (the color test's screens are in screens/colorTest)
  ui/         shared controls and the camera helper
  test/       test setup and made-up sample data
server/       the small server that Cloudflare runs under /api
public/       icons, security headers, and the alert handler (push-sw.js)
examples/     a made-up setup file
```

Screens never touch the database directly. They call the modules in `src/data`, so a server can be added behind the same calls later.

## How an outfit is picked

Rules pick the outfit on the phone. No AI model picks an outfit or writes a reason. The method is in `src/domain/outfits` and follows the design brief, section 7.

| Step | File | What it does |
| --- | --- | --- |
| Build | `build.ts` | Every combination of main top, under-layer, trousers and shoes, with an overshirt where it fits. Pieces that break a hard rule never get in |
| Filter | `filters.ts` | Removes a combination when its pieces are more than one dress level apart, when its average level is outside the occasion's range, when it has more than three colors or more than one strong one, when it clashes, or when it does not suit the forecast |
| Score | `score.ts` | Points for matching a saved look, colors near the face (from the palette), one rough texture, a short top over fuller trousers, fit to the occasion, rotation and history. The weights are in one table, `WEIGHTS` |
| Pick | `engine.ts` | The best outfit from the saved looks and the rules is the main pick. Two alternates differ by more than the shoes. A look from beyond the saved looks is only ever an alternate, labeled "Stretch" |
| Explain | `engine.ts` | Each reason line is the sentence of a filter or score part that fired, with its evidence label |

Things to know before changing it:

- **Occasion ranges, temperature lines and weights are working values.** They come from the Phase 1 reports, not from a source, and every reason built on them carries the "Working rule" label. Office is an average dress level of 1.6 to 2.7, casual 1.7 or less, going out 1.6 to 2.7 and never a bare tee, a date 2.3 or more. A coat is wanted under 50°F, short sleeves and bare tees need 60°F, and hours count as wet from a 40% chance of rain or snow.
- **Saved looks are data.** A look is a `Formula` in the profile (`profile.formulas`), loaded from the setup file like the rest of the profile. A formula carries its source, and names a creator's post only when `postSeen` is true and it has a link. Otherwise the app says "in the style of".
- **When the weather rules out everything**, the closest outfit is shown with what it gives up, and the count in the coverage grid stays at zero.
- **A coat and a belt sit on top of an outfit.** They do not change the counts. With no coat on a cold day the app says so.
- **Shoes pass a wet day only when "Fine in rain or snow" is ticked on the piece.**
- **Swapping changes the top, trousers or shoes.** The under-layer follows the top.
- **Not built yet:** learning from the "not today" reasons, the in-season bonus (it waits on the trend list) and fragrance pairing. The answers are stored, so the learning page can use them later.

### Weather

`src/data/weatherRepo.ts` calls `api.weather.gov` twice: the map point gives the address of its hourly forecast, then the forecast. The only thing sent is the point in `profile.home.point`, rounded to two decimals. The last forecast is kept in the `meta` table, so the app has one offline, and it is asked for again after two hours. This has not been tried on a real iPhone yet. If the weather service does not answer a web page directly, add the app's own server as a second source in `fetchHours`.

## Saved looks

The Looks tab (`#/inspiration`) keeps outfits worth copying. The rules are in `src/domain/looks.ts` and `src/domain/links.ts`, the storage in `src/data/looksRepo.ts`, and the screens in `src/screens/looks`.

- **A look is tied to a creator's post only when its link is saved.** With a link it is credited "post saved". With a creator's name and no link it is "in the style of". An account name read off a screenshot only fills in the creator. It never ties the look to a post.
- **The post plays in Instagram's own player**, in a sandboxed frame that Instagram fills. The app takes nothing out of it and makes no call to Instagram itself. The frame loads by itself only while the look has no screenshot yet. After that it loads on a tap, because opening it tells Instagram the post was viewed.
- **Screenshots are the owner's own**, up to four a look, stored as photos of class `inspiration`. They are shown only on the look's screens.
- **Reading a screenshot** sends the first two to the small server's `look` request (see "The small server"). The answer is a proposal: values outside the app's own lists are dropped, pieces the owner wrote or edited are kept, and nothing is matched until the owner taps "These are right". Without an AI key the button is left out, the screen says reading is switched off, and the pieces are added by hand.
- **Your version** applies the profile's rules to each piece: a hard rule changes it (gold becomes silver, leather clothing becomes cloth, a long hem is shortened), and a "no tie" rule (`check: "no-tie"`, or a rule that says "no tie") leaves a tie out. The owner can keep any piece as it is, or leave any piece out.
- **The match** compares each piece of the version with what is owned, by slot, color group and kind of garment. A piece is owned, close (with what differs, and a "Mine is close enough" button) or missing. Tops, trousers, shoes and layers count as pieces away. Belts, watches and the like are finishing touches. A watch is matched on its metal.
- **A confirmed look is an outfit recipe.** Today and Week credit an outfit that matches it, the same way as the recipes in the profile (`formulasWithLooks`). Nothing is written into the profile.
- **Sharing in.** A link or a screenshot in the inbox opens `#/inspiration/new?inbox=<id>` or `#/inspiration/attach?inbox=<id>` and leaves the inbox once it is part of a look.
- **The buy list plugs in.** `src/data/lookWishes.ts` sends missing pieces to a buy list given to `connectBuyList`. Until the buy list is built, those buttons are left out.

## Data

Everything lives in nine tables in the browser's IndexedDB.

| Table | Holds |
| --- | --- |
| `profile` | One document: body, coloring, sizes, week, stores, rules, palette |
| `pieces` | One row per piece, with its tags |
| `photos` | Photo bytes and a thumbnail, linked to a piece, each with a privacy class |
| `meta` | Saved settings as key and value: the last forecast, the app key, the recovery code, backup and reminder state. Never exported, never uploaded |
| `colorTests` | One row: the colors chosen, which photo belongs to which color, every pick, and what was saved to the palette |
| `dayPlans` | One row per day you changed: its occasions, and the weather if you set it by hand |
| `outfitLog` | One row per answer to a suggested outfit: worn (with a rating) or passed over (with a reason) |
| `inbox` | Things waiting to be added: a photo, a store page, a link or a screenshot, with the tags an AI model proposed. Never in a backup |
| `looks` | One row per saved look: its link, creator, the pieces by slot, the owner's choices, and when the pieces were checked. Its screenshots are in `photos` under `look:<id>` |

The types are in `src/domain/types.ts`.

**Photo privacy class.** Each photo is `clothing`, `inspiration` or `of-me`. Photos of the owner (`of-me`) are left out of a backup unless asked for, and restoring a backup does not delete them.

**Rules drive the checks.** A rule in the profile can carry a `check` (for example `no-leather-clothing`). The app runs a check only while a rule asks for it, so deleting the rule in the profile turns the check off.

### File format

Export and setup files share one JSON format (`src/data/backup.ts`).

| `kind` | Made by | Loading it |
| --- | --- | --- |
| `backup` | Settings, "Make a backup file" | Replaces everything on the phone, except photos of the owner, which stay |
| `setup` | Written outside the app | Replaces the profile and adds pieces that are not there yet. Photos, existing pieces, day plans and the outfit log are kept, and saved color test results are written back onto the new palette |

The format is at version 2, which added `colorTest`. Version 1 files still load. `dayPlans` and `outfitLog` are optional lists, so files made before the Today and Week screens load too.

## The color photo test

The test follows the design in the coloring report: no measuring of skin from a photo, only the owner's own picks.

1. **Photos.** The capture screen runs the camera inside the app, with an oval for the face, a line for where the color goes, a timer, and a faint copy of the first photo to line every later one up with. Photos are cut to a 3:4 portrait and a selfie is saved the way the preview showed it. If the camera will not open inside the app, the screen falls back to the phone's own camera or the photo library.
2. **Compare.** Two photos side by side, tap the better one. "About the same" counts as half a win each. Pairs are chosen like rounds of a chess tournament: colors with the fewest comparisons first, and among those the two closest in the standings. Twelve colors need about 30 picks, not all 66 pairs.
3. **Ranking.** Picks become strengths with the Bradley-Terry method (`rankColors` in `src/domain/colorTest.ts`). Each color also gets one imaginary tie against an average color, so one lucky win cannot top the list.
4. **Palette.** The app proposes a verdict per color (best, fine, not near the face) and the owner can change each one. Saving writes every tested color into the profile's palette as its own entry, with `family`, `evidence: 'your-test'` and a `test` record, and removes those colors from the stylists' grouped entries. Untested colors stay. The palette from before is kept so the save can be undone, and a later setup file does not wipe the results.

Code that scores outfits should look up a palette entry by `family` and read `test.verdict` when it is there. The free-text `nearFace` is for display and for entries that were never tested.

**Privacy.** Color-test photos are stored as `of-me` photos, with `pieceId` set to `color-test:<color>`. They are never written to a backup file, even one that includes other photos of the owner. The picks, the ranking and the saved results are. The owner can delete the photos and keep the results.

**Limits to know.** The phone picks its own exposure and white balance for each shot, and a web page cannot lock them on an iPhone. A large block of strong color can shift the whole photo a little. The capture tips (same spot, daylight, one sitting) reduce this but do not remove it. The camera screen has been run in desktop Chromium with a fake camera at iPhone sizes, not yet on a real iPhone.

## Hosting

Cloudflare builds the app from this repository on each push and runs it as one Worker (`wrangler.jsonc`). Static files are served directly. Requests under `/api` go to the small server in `server/`.

| Setting in Cloudflare | Value |
| --- | --- |
| Worker name | `wardrobe-builder` (must match `name` in `wrangler.jsonc`) |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 22, from `.nvmrc` |
| Secret `APP_KEY` | The app key, 20 characters or more. Set it in the dashboard: the Worker, then Settings, then Variables and Secrets. Never put it in this repository |
| Secret `ANTHROPIC_API_KEY` | The AI provider's key, set the same way. Without it everything works except AI requests |

The database has no id in `wrangler.jsonc`, so the first deploy creates one named `wardrobe-builder`. The server creates its own tables on first use. If a deploy ever fails on the database, create a D1 database by hand in the dashboard and add its id as `database_id`.

Cloudflare also builds a preview of every other branch with `npx wrangler preview`, and reports it on the pull request as the check "Workers Builds: wardrobe-builder". That command needs the `previews` block in `wrangler.jsonc`. The block is empty on purpose: a preview gets the app's files but no database and no app key, so its server refuses everything and never touches the real backups. A preview address is public, like the main one, and shows the same empty app.

`public/_headers` sets the security headers the host sends with every file. The content security policy lets the app load code, images and data only from its own address. The one outside address it may call is `https://api.weather.gov`, for the forecast, and the one outside page it may show in a frame is `https://www.instagram.com`, for the player of a saved post. The small server is at the app's own address, so it needs no entry. The permissions policy lets only the app's own address ask for the phone's location, which the Weather card in Settings uses, and turns the microphone and payments off. Any other feature that calls an outside service has to add that address there, or the browser will block it.

To run everything locally the way Cloudflare does:

```sh
npm run build
npx wrangler dev --var APP_KEY:any-local-key-of-20-chars
```

Then open the address it prints. `npm run dev` also reaches the server while `wrangler dev` is running.

Browser storage belongs to one web address. Install the app to the Home Screen from the main address, not from a preview address, or its data will not follow.

## Adding a piece

"Add a piece" on the Wardrobe screen opens `src/screens/addPiece/AddPieceScreen.tsx`. Everything that comes in becomes an item in the local `inbox` table first (`src/data/inboxRepo.ts`), whichever way it arrived:

- **A pasted cut-out.** In Photos, press and hold a piece until it lifts off its background, copy it, and paste it in the app. The app reads the clipboard only on a tap. A picture counts as a cut-out when at least 3% of its pixels are see-through (`src/data/images.ts`).
- **A photo taken or chosen in the app.** It still has its background, so the form says so and offers a crop box (`src/ui/CropBox.tsx`) and "Paste a cut-out instead".
- **A store page link.** The app never opens the store's site. Details can be pasted from the page, or a screenshot added, for a model to read.
- **The share menu.** A Shortcut sends a photo, a page's text or a link to the small server, and the app collects it when it next opens or comes to the front. `src/screens/ShortcutGuideScreen.tsx` has the steps for building the Shortcut, the address, and the script it runs on a store's page.

An item becomes a piece on the piece form (`/wardrobe/new?inbox=<id>`), with a source card on top (`src/screens/addPiece/SourceCard.tsx`). A link from Instagram or a shared screenshot is a look, not a piece, and goes to the looks screens.

**AI tags.** "Suggest tags with AI" sends the one photo (at most 1024 pixels on its long edge) or the one page to `POST /api/ai/piece-photo` or `piece-page`, and says what will be sent before it sends anything. The answer is cleaned against the app's own lists (`cleanProposal` in `src/domain/tagging.ts`), so a made-up value never reaches a piece. `applyProposal` in `src/screens/pieceFormState.ts` fills only fields that are empty or that the owner has not typed in, marks each one "AI" or "AI, not sure", and unticks "I have checked these details". Changing a field removes its mark. The proposal is kept on the saved piece as `tagging`, so the model's reading can be compared with what was saved. A price read from a page is saved as `listPrice` with the day it was read, never as the price paid.

With no AI key on the server, the source card says AI tagging is off and the form is filled in by hand. Settings has a card with the steps to add the key, today's count, and a test that sends a blank grey square.

Not tried on a real iPhone yet: pasting a cut-out from Photos (whether Safari keeps its clear background), the Shortcut, and the crop box under a finger.

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
| `POST /api/inbox` | Takes a link, a store page's text or a picture from the share-menu Shortcut. Answers in plain words, which the Shortcut shows |
| `GET /api/inbox` | Lists what is waiting. `GET /api/inbox/:id/file` gives one picture, `DELETE /api/inbox/:id` removes an item |
| `GET /api/ai` | Whether the AI key is set, the kinds of request, and today's count |
| `POST /api/ai/:kind` | Passes one fixed kind of request to the AI provider and returns its answer |
| `DELETE /api/data` | Erases everything the server holds, except the day's AI counts |

**Backup.** A backup is a *snapshot* (the export file without photo bytes, plus a list of photos) and the photos it names. Each photo is uploaded once and shared between snapshots. The phone encrypts each item with AES-256-GCM before upload (`src/data/vault.ts`). The key comes from a 256-bit *recovery code* that is made on the phone and never sent. The server keeps the 7 newest snapshots and deletes photos no snapshot names. Photos with the class `of-me` are never uploaded.

**Reminder.** The phone gets an alert address from its push service (Apple's, on an iPhone) and gives it to the server with the office days, the hour and the time zone. A job runs each hour, and sends the alert when the phone's own clock reaches the chosen hour on the evening before an office day. The message is encrypted for the phone (RFC 8291) and signed (RFC 8292) with keys the server makes on first use (`server/push.ts`). It uses the declarative form, so iOS 18.4 and later show it without waking the app. `public/push-sw.js` shows it on older systems.

**Inbox.** A web app cannot appear in the iPhone share menu, so a Shortcut posts what is shared to `POST /api/inbox` (`server/inbox.ts`): a form with `kind` (`photo`, `page` or `look`), and `url`, `title`, `text` or a `file`. The key goes in the `Authorization` header, or in a form field `key` if the Shortcut cannot send a header. The server holds at most 40 items and 8 MB a picture. The app collects them when it opens (`src/data/inboxRepo.ts`), keeps them in its own `inbox` table and deletes them from the server. Inbox items are not encrypted, unlike the backup: they are clothing photos, store pages and links, and they rest on the server only until the app next opens.

**AI requests.** The AI provider's key is a second Cloudflare secret, `ANTHROPIC_API_KEY`. It never reaches the app. The app names a *kind* and sends that kind's data to `POST /api/ai/:kind`. The prompt, the model, the answer's shape and the limits are all written on the server (`server/ai`), so a leaked app key can only run these few small jobs:

| Kind | Sent | Answer |
| --- | --- | --- |
| `piece-photo` | One photo of a piece, and optionally one of its label | Proposed tags for the piece |
| `piece-page` | A store page's text as copied by the phone, a screenshot of it, or both | Proposed tags, with brand, cloth and price |
| `look` | One or two of the owner's screenshots of an outfit he saved | The pieces of the outfit by slot, and the account name if the screenshot shows one |

Each call is counted before it is made, per kind and per day (UTC), in the `ai_usage` table. Over the limit, the server refuses without calling the provider. The defaults are 60 a day for each piece kind, 40 for `look`, and 120 a day in all. A Cloudflare variable `AI_DAILY_LIMIT` changes the total. `AI_MODELS` (for example `piece-photo=claude-sonnet-5-5`) answers a kind with another model, to compare models without a code change. Nothing that passes through is stored or logged: no photo, no page text, no answer.

To add a kind, write a file in `server/ai` that exports an `AiKind` (see `types.ts`) and add it to the list in `kinds.ts`. A kind's `schema` makes the model answer in exactly that JSON shape. The server never loads a store's page: page text is collected by the owner's own phone.

**What the server holds.** Encrypted backups, each device's alert address with its reminder settings (office days, hour, time zone, forecast point), its own signing keys, inbox items until the app collects them, and the day's AI counts. No profile, no wardrobe, no readable backup.

**Tests.** `server/*.test.ts` run the server code against a local copy of the Cloudflare database. `src/data/serverBackup.test.ts` runs the app's backup and restore against that same server code, so the two cannot drift apart.

## iPhone notes

- The manifest uses `display: standalone`. Keep it. An app on the Home Screen is spared Safari's seven-day clearing of site data.
- The app asks the browser to protect its storage (`navigator.storage.persist()`), and Settings shows the answer.
- An app on the Home Screen has its own storage, separate from Safari. Data saved in a Safari tab does not move over, so load the setup file after installing.
- Inputs use 16-pixel text so Safari does not zoom in on focus.
- Alerts work only in the app opened from the Home Screen, on iOS 16.4 or later. The request for permission must come from a tap.
- A web app cannot run in the background, so the automatic backup happens when the app is opened.
- The camera needs a secure address (https, or localhost while developing) and the `playsinline` attribute on the video, or iPhone opens it full screen. iPhone may ask for camera permission again each time the app is opened.
