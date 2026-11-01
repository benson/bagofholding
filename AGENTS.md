# Bag of Holding

Capture a fleeting reaction (hold to talk, type, or photo) and let the brain turn it into the real thing worth keeping. `docs/plan.md` is the design and the phase list; keep it current when decisions change.

## Layout

- `worker/` — Cloudflare Worker `bagofholding-api` (D1 `bagofholding`, R2 `bagofholding-media`, Workers AI Whisper, Claude). `src/index.js` routes, `src/process.js` pipeline, `src/brain.js` the classify prompt and schema, `src/resolvers/` per kind.
- `index.html`, `app.js`, `style.css` — the browse page, GitHub Pages from `main` at bensonperry.com/bagofholding. Lowercase UI. Bump `?v=N` when CSS/JS change.
- `ios/` — SwiftUI capture app. `xcodegen generate` in `ios/` makes the project (`.xcodeproj` is ignored). Bundle id `com.bensonperry.bagofholding`.
- `runner/` — stateless clip runner (needs ffmpeg + yt-dlp). Polls `/jobs/next`, runs the `song-clip` skill, uploads the mp4. Installed on the Mac as a launch agent from the plist in this folder; log at `~/Library/Logs/bagofholding-runner.log`.

## Secrets and config

- Worker secrets: `BAG_KEY` (the one bearer key for app, web and runner), `ANTHROPIC_API_KEY`. Set with `wrangler secret put` from `worker/`.
- Local runner config: `~/.config/bagofholding/env` (`BAG_API`, `BAG_KEY`), not in the repo.
- The web page stores the key in `localStorage` after the "key" link in the footer.

## Rules

- The raw capture is provenance. The item is the resolved thing. Don't turn the brain into a note-taker.
- Capture never blocks on resolution. Anything slow goes through `jobs`.
- Items are private by default. `public` is a per-item flag.
- Deploy: `npm run deploy` in `worker/`; push `main` for the web page. Schema changes go in `worker/schema.sql` (idempotent) and are applied with `npm run migrate`.
