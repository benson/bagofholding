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
  source   { modality: voice|text|photo, transcript, text, note, photo_key, audio_key, location },
  resolved { text, attribution, fields[{label, value}], links[{label, url}], extract,
             observations[{label, value}], name, song{artist, track, album, start_s, end_s, clip}, ... },
  media[]  { role: photo|audio|clip|cover|image, key, type },
  candidates[{name, confidence, reason, url?}]   // when needs_confirm
  public: bool
}
```

Kinds are open-ended (decided 2026-11-01): the brain names the kind itself, reusing kinds already in the bag when one fits and inventing one when nothing does (video, recipe, word, person, game, podcast, ...). There is no enum. What makes an item "real" is the lookups the brain requests, not the kind:

| lookup | what it fetches |
|---|---|
| wikipedia | canonical page, 3-sentence summary, lead image |
| unfurl | a URL's title, description, og:image |
| itunes_track / itunes_album | track or album record, artwork, Apple Music link |
| openlibrary | book record, cover, Open Library link |
| google_font | whether each candidate family is on Google Fonts, specimen link |
| song_clip | queues the runner job: track lookup, cover, clip |
| web | a second Claude call with web search that returns the one canonical page for something only described ("that video where X reviews Y") |

The page has special cards for font (specimen), idea, quote and song moment (clip); everything else gets the generic card: image, title, summary or first facts, tags, then fields, links, Wikipedia summary and observations on the detail. Filter chips come from the kinds present in the data.

### The brain

One Claude call (Opus 5.5, high effort, structured output) with the transcript or text, the photo if any, the existing kinds and tags. It returns kind, title, summary, tags, free-form fields, observations (anything else sussed from a photo: typeface, era, palette, maker, the specific building when the item is a style), candidates when unsure, and the lookups to run. The structured-output schema must avoid nullable unions (API cap of 16), so unused values are empty strings.

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

## Status

2026-11-01: phase 0 live and verified end to end, including photos. Text, voice (Whisper), link, song moment (clip via the Mac runner), font (candidates + one-tap confirm), style (Brutalism from a photo of Boston City Hall plus "love this style of building"), artwork (The Great Wave) and thing (Eames lounge chair) all resolve. Every photo also yields observations (typeface, era, maker, material, palette, location) shown on the item. Environment facts: itunes rate-limits Cloudflare's egress (the runner does that lookup); youtube refuses anonymous yt-dlp, so `~/.config/yt-dlp/config` carries Chrome cookies and a node JS runtime (see the song-clip skill); the structured-output schema must avoid nullable unions (API cap of 16). Not yet exercised: book, film, album, place with a real photo, and the app on a phone.

## Phases

0. Repo `benson/bagofholding`: worker with D1 + R2, Whisper transcription, classify + tag, `idea` and `link` resolvers, minimal web list. iOS app with hold-to-talk, text, photo, Action Button intent, background upload. Clip runner on this Mac.
1. Resolvers: `song_moment` end to end, `font` and `thing` via vision with the confirm flow, `book`/`film`/`album`/`place`.
2. Web: per-kind cards, tag browsing, item detail, needs-a-tap flow.
3. App: Share Sheet extension, Lock Screen control, polish.
4. Retire Glimmer: migrate its one item, redirect bensonperry.com/glimmer, replace the `glimmer` skill with a `bagofholding` skill so agents can add to the bag from chat too.
