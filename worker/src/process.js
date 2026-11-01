import { getItem, updateItem, allTags, allKinds, enqueueJob } from './db.js';
import { getMediaBase64, putMediaFromUrl } from './media.js';
import { transcribe } from './transcribe.js';
import { classify, webFind } from './brain.js';
import { resolveLink } from './resolvers/link.js';
import { lookupTrack, lookupAlbum } from './resolvers/song.js';
import { resolveBook, resolveFont, wikipedia } from './resolvers/misc.js';

const attempt = async (label, fn, fallback = null) => {
  try { return await fn(); }
  catch (err) { console.warn(`${label}: ${err.message || err}`); return fallback; }
};

// Each lookup returns {links: [{label, url}], image, fields: [{label, value}], extract, ...extra} or null.
async function runLookup(env, item, lookup, brain) {
  const { type, query, args } = lookup;
  switch (type) {
    case 'wikipedia': {
      const w = await wikipedia(query || item.title);
      return w ? { links: [{ label: 'wikipedia', url: w.url }], image: w.image, extract: w.extract, wikipedia_title: w.title } : null;
    }
    case 'unfurl': {
      const url = args.url || query.match(/https?:\/\/\S+/)?.[0];
      if (!url) return null;
      const l = await resolveLink(env, { url });
      return { links: [{ label: l.site || 'open', url: l.url }], image: l.image, extract: l.description, page_title: l.title, url: l.url, site: l.site };
    }
    case 'itunes_track': {
      const t = await lookupTrack(env, { artist: args.artist, track: args.track || query, album: args.album });
      return t ? { links: [{ label: 'apple music', url: t.itunes_url }, ...(t.preview_url ? [{ label: 'preview', url: t.preview_url }] : [])], image: t.artwork, fields: [{ label: 'artist', value: t.artist }, { label: 'album', value: t.album }], track: t } : null;
    }
    case 'itunes_album': {
      const a = await lookupAlbum(env, { artist: args.artist, title: args.album || args.title || query });
      return a ? { links: [{ label: 'apple music', url: a.itunes_url }], image: a.artwork, fields: [{ label: 'artist', value: a.artist }, { label: 'year', value: a.year }], album: a } : null;
    }
    case 'openlibrary': {
      const b = await resolveBook(env, { title: args.title || query, author: args.author });
      return b ? { links: b.url ? [{ label: 'open library', url: b.url }] : [], image: b.cover, fields: [{ label: 'author', value: b.author }, { label: 'first published', value: b.year ? String(b.year) : '' }], book: b } : null;
    }
    case 'google_font': {
      const names = brain.candidates.length ? brain.candidates : [{ name: query || item.title, confidence: brain.confidence, reason: '' }];
      const f = await resolveFont(env, { candidates: names });
      return { candidates: f.candidates, links: f.candidates[0] ? [{ label: f.candidates[0].google_fonts ? 'google fonts' : 'find it', url: f.candidates[0].url }] : [] };
    }
    case 'song_clip': {
      const start = Number(args.start_s) || 0;
      const end = Number(args.end_s) || start + 10;
      const t = await attempt('itunes', () => lookupTrack(env, { artist: args.artist, track: args.track || query, album: args.album }));
      const song = { artist: t?.artist || args.artist, track: t?.track || args.track || query, album: t?.album || args.album, start_s: start, end_s: end };
      const hasClip = item.media.some(m => m.role === 'clip');
      const hasCover = item.media.some(m => m.role === 'cover') || !!t?.artwork;
      if (!hasClip || !hasCover) {
        const pending = await env.DB.prepare(`SELECT 1 FROM jobs WHERE item_id = ? AND status IN ('queued','running')`).bind(item.id).first();
        if (!pending) await enqueueJob(env, item.id, 'song_clip', { ...song, have_clip: hasClip });
      }
      return {
        song: { ...song, clip: hasClip ? 'ready' : 'pending' },
        cover: t?.artwork || null,
        links: t?.itunes_url ? [{ label: 'apple music', url: t.itunes_url }, ...(t.preview_url ? [{ label: 'preview', url: t.preview_url }] : [])] : [],
        fields: [{ label: 'artist', value: song.artist }, { label: 'album', value: song.album || '' }],
      };
    }
    case 'web': {
      const w = await webFind(env, query);
      return w ? { links: [{ label: w.title || 'found it', url: w.url }], image: w.image || null, extract: w.summary, url: w.url } : null;
    }
    default:
      return null;
  }
}

export async function processItem(env, id, origin) {
  const item = await getItem(env, id, origin);
  if (!item) return;
  try {
    const source = { ...item.source };
    await updateItem(env, id, { status: 'processing', error: null });

    if (source.audio_key && !source.transcript) {
      const t = await transcribe(env, source.audio_key);
      source.transcript = t.text;
      source.language = t.language;
    }

    const photo = source.photo_key ? await getMediaBase64(env, source.photo_key) : null;
    const [tags, kinds] = await Promise.all([allTags(env, true), allKinds(env, true)]);
    const brain = await classify(env, {
      transcript: source.transcript, text: source.text, note: source.note, photo, location: source.location,
      existingTags: tags.map(r => r.tag).slice(0, 150), existingKinds: kinds.map(r => r.kind),
    });

    // Keep the capture's own media and anything a runner produced; lookups replace the rest.
    const media = item.media.filter(m => ['photo', 'audio', 'clip', 'cover'].includes(m.role));
    const resolved = {
      text: brain.text || null,
      attribution: brain.attribution || null,
      fields: brain.fields,
      observations: brain.observations,
      links: [],
      confidence: brain.confidence,
    };
    let candidates = brain.candidates;
    let needsConfirm = brain.needs_confirm;
    let image = null;

    for (const lookup of brain.lookups) {
      const r = await attempt(`lookup ${lookup.type}`, () => runLookup(env, item, lookup, brain));
      if (!r) continue;
      resolved.links.push(...(r.links || []).filter(l => l.url && !resolved.links.some(x => x.url === l.url)));
      for (const f of r.fields || []) if (f.value && !resolved.fields.some(x => x.label.toLowerCase() === f.label.toLowerCase())) resolved.fields.push(f);
      if (r.extract && !resolved.extract) resolved.extract = r.extract;
      if (r.image && !image) image = r.image;
      if (r.candidates) candidates = r.candidates;
      if (r.song) resolved.song = r.song;
      if (r.cover && !media.some(m => m.role === 'cover')) {
        const m = await attempt('cover', () => putMediaFromUrl(env, id, 'cover', r.cover));
        if (m) media.push(m);
      }
      for (const k of ['url', 'site', 'page_title', 'wikipedia_title', 'track', 'album', 'book']) if (r[k] !== undefined) resolved[k] = r[k];
    }

    if (candidates.length) {
      const top = candidates[0];
      resolved.name = top.name;
      if (top.url) resolved.url = top.url;
      if (top.google_fonts !== undefined) resolved.google_fonts = top.google_fonts;
      if (top.confidence < 0.85) needsConfirm = true;
    }
    if (image && !media.some(m => m.role === 'cover')) {
      const m = await attempt('image', () => putMediaFromUrl(env, id, 'image', image));
      if (m) media.push(m);
    }
    if (!resolved.links.length && !photo && !resolved.text) {
      const q = `${brain.title} ${brain.summary}`.trim();
      resolved.links.push({ label: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(q)}` });
    }

    await updateItem(env, id, {
      kind: brain.kind,
      title: brain.title || item.title,
      summary: brain.summary || null,
      tags: brain.tags,
      source,
      resolved,
      media,
      candidates,
      status: needsConfirm ? 'needs_confirm' : 'resolved',
    });
  } catch (err) {
    console.error(`process ${id}: ${err.stack || err}`);
    await updateItem(env, id, { status: 'failed', error: String(err.message || err) });
  }
}
