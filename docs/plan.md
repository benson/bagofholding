# Bag of Holding

Capture a fleeting reaction with as little friction as possible (hold a button, talk; or type; or snap a photo). A resolver turns it into the real object worth keeping (a song clip, a font, a product, a cleaned-up idea), tags it, files it. Browse everything at bensonperry.com/bagofholding.

Replaces Glimmer (one item, `site`, igochi studio). Glimmer gets redirected and its skill retired once this is live.

## Principles

- The raw capture is provenance, never the item. Store it, show it on the item's detail, but the card is the resolved thing.
- Never block the capture on the resolver. Capture returns in under a second; resolution happens after. Unresolved items are visible with their status, not lost.
- When the brain is unsure, it saves a best guess with candidates and asks for one tap later. It never asks at capture time.
- One brain, many resolvers. Classification decides the kind; each kind has a resolver that knows how to find the canonical object.

## Architecture

```
iPhone (Shortcut now, native app later)
  │  POST audio | text | photo  (+ optional typed note)
  ▼
Cloudflare Worker  bagofholding-api        ← the brain
  ├─ D1    items, tags, jobs
  ├─ R2    media (originals, clips, specimens, thumbnails)
  ├─ Workers AI Whisper        transcription (same CF account, no new vendor)
  ├─ Claude (claude-sonnet-5-5) classify → kind, title, tags, resolver args
  └─ resolvers
       in-worker: idea, link, font-guess, photo-identify, book/film/place
       job queue: song-clip (needs ffmpeg + yt-dlp, runs on the always-on PC)
  ▼
GitHub Pages  bensonperry.com/bagofholding   static, lowercase UI, reads the worker's JSON
```

Capture path: client uploads → worker stores the original in R2 and an `items` row with `status: capturing` → responds immediately → `waitUntil` runs transcription + classification → resolver runs or enqueues a job → row becomes `resolved`, `needs_confirm` or `failed`.

### Data

```
item {
  id, kind, status, created_at,
  title, summary, tags[],
  source   { modality: voice|text|photo, transcript, text, media_key, said_at },
  resolved { ...kind-specific, see below },
  media[]  { role: original|clip|specimen|thumb|cover, r2_key, mime },
  candidates[]   // when needs_confirm
  public: bool
}
```

Kinds and what "resolved" means for each:

| kind | input looks like | resolved object |
|---|---|---|
| idea | "idea: ..." / anything with no referent | cleaned text, title, tags |
| song_moment | "30s to 50s of X by Y" | track (itunes match), cover, range, 1080² clip in R2 |
| font | photo + "this font" / "what font is this" | family name, foundry, specimen image, where to get it, confidence + candidates |
| thing | photo of an object, product, poster, building | what it is, maker, link if purchasable, the photo as media |
| link | a URL, or "that site X" | title, description, screenshot, hostname |
| book / film / album | a title | canonical record with cover art |
| place | "this place" + location, or a name | name, map link, photo |
| quote | "quote: ..." / attribution words | text + who said it |

Kinds are an enum in one place; adding one is a resolver file plus a card template.

### The brain

One Claude call with the transcript (or text), the photo if any, and the kind list. It returns kind, title, tags, a one-line summary, and resolver arguments (song title + artist + range; URL; "identify the object"; etc.). A second cheap call is not needed; tags come out of the first.

Tagging rules live in the prompt: a small controlled vocabulary for themes (typography, music, product, architecture, writing, ...) plus free tags. Existing tags are passed in so the model reuses them instead of inventing synonyms.

### Resolvers

- idea: trivial, in the classify call itself.
- link: fetch, unfurl, screenshot via Cloudflare Browser Rendering.
- song_moment: existing `song-clip` script, unchanged. The worker writes a job; a runner polls, runs the script, uploads the mp4 and cover to R2, marks the item resolved. The runner is a ~50-line poll loop with no state of its own, so where it runs is swappable (see "Where the clip runner lives"). The item resolves in two steps: track, cover and range land immediately from the itunes match inside the worker; the clip arrives when the runner finishes. A dead runner means a card without a clip, not a lost item.
- font: vision call asking for the top 3 candidates with confidence. Specimen rendered from Google Fonts when available, else a link to the foundry. Anything under high confidence lands as `needs_confirm`; the web UI shows the three candidates over the original photo and one tap picks.
- thing: vision call to identify; web lookup for a purchase/maker link when it is a product.
- book / film / album: Open Library, TMDB, itunes lookups.
- place: reverse geocode the photo's location or the capture location (the Shortcut sends it).

### Web

Static page at bensonperry.com/bagofholding, same shape as the other GitHub Pages projects, lowercase UI. Fetches `GET /items` from the worker.

- Grid of cards, one card template per kind. Filter by kind and by tag. Search.
- A quiet "needs a tap" section at the top when anything is `needs_confirm` or `failed`.
- Item detail shows the resolved object, then the original capture (transcript, photo, timestamp) underneath.
- Writes (confirm a candidate, edit tags, delete) go through the worker with a bearer key stored in the browser. Reads are public for `public: true` items; private items appear only with the key.

### Capture client

A small SwiftUI app, no Shortcut stage (decided 2026-11-01: more fun, developer account already paid for).

- One screen: a big hold-to-talk button, a text field, a camera button. Hold to record, release to send; the upload runs as a background URLSession task so the app can be dismissed instantly.
- Action Button: an App Intent (`StartCapture`) exposed as an App Shortcut, so the Action Button opens the app already recording. Also works from the Lock Screen control.
- Sends location with every capture (for `place`, and as provenance).
- Later: a Share Sheet extension so a Spotify track, a Safari page or a photo goes to the bag from any app with the note typed or dictated. This is where song moments and links will mostly come from in practice.

### Where the clip runner lives

The runner needs ffmpeg and yt-dlp, which rule out the Worker itself. The real constraint is YouTube, not compute: yt-dlp from datacenter IPs (GitHub Actions, Fly, Hetzner, Cloudflare Containers) gets "sign in to confirm you're not a bot" challenges, and the workarounds (exported browser cookies, PO-token plugins) break every few months. A home IP is what makes yt-dlp reliable, which is why a home machine is the natural host.

Order of preference:

1. This Mac, as a `launchd` agent, while it is the always-on machine. Zero new infrastructure.
2. Any home box that is on anyway (the PC when it is back, a Mac mini or mini PC, a Raspberry Pi). Same runner, same launchd/systemd unit. This is the answer to "neither current machine": a cheap always-on device at home beats any cloud runner for this job.
3. Cloud only as a fallback: a Cloudflare Container or a small VPS running the same runner with a cookies file, accepting that it needs babysitting. Could also be the automatic fallback when no home runner has polled in an hour.

Because the item resolves without the clip, a runner outage degrades to "clip pending" and the backlog drains when a runner returns.

## Decisions

1. Decided (2026-11-01): private by default, with a per-item publish toggle. The browse page shows public items to everyone and everything to Benson with his key.
2. Clip runner: this Mac first, home device next, cloud fallback. See above.
3. Decided: straight to the native app, no Shortcut stage.

## Phases

0. Repo `benson/bagofholding`: worker with D1 + R2, Whisper transcription, classify + tag, `idea` and `link` resolvers, minimal web list. iOS app with hold-to-talk, text, photo, Action Button intent, background upload. Clip runner on this Mac.
1. Resolvers: `song_moment` end to end, `font` and `thing` via vision with the confirm flow, `book`/`film`/`album`/`place`.
2. Web: per-kind cards, tag browsing, item detail, needs-a-tap flow.
3. App: Share Sheet extension, Lock Screen control, polish.
4. Retire Glimmer: migrate its one item, redirect bensonperry.com/glimmer, replace the `glimmer` skill with a `bagofholding` skill so agents can add to the bag from chat too.
