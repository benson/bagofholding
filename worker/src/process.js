import { getItem, updateItem, allTags, enqueueJob } from './db.js';
import { getMediaBase64, putMediaFromUrl } from './media.js';
import { transcribe } from './transcribe.js';
import { classify } from './brain.js';
import { resolveLink } from './resolvers/link.js';
import { lookupTrack, lookupAlbum } from './resolvers/song.js';
import { resolveBook, resolveFont, resolvePlace, resolveStyle, resolveArtwork } from './resolvers/misc.js';

const attempt = async (label, fn, fallback) => {
  try { return await fn(); }
  catch (err) { console.warn(`${label}: ${err.message || err}`); return fallback; }
};

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
    const tags = (await allTags(env, true)).map(r => r.tag).slice(0, 150);
    const brain = await classify(env, {
      transcript: source.transcript, text: source.text, note: source.note, photo, location: source.location, existingTags: tags,
    });

    const media = item.media.filter(m => ['original', 'photo', 'audio', 'clip', 'cover'].includes(m.role) && !(m.role === 'cover' && item.kind !== 'song_moment'));
    let resolved = {};
    let candidates = [];
    let needsConfirm = !!brain.needs_confirm;

    switch (brain.kind) {
      case 'idea':
        resolved = { text: brain.idea?.text || source.text || source.transcript || '' };
        break;
      case 'quote':
        resolved = brain.quote || {};
        break;
      case 'link': {
        const url = brain.link?.url || (source.text || source.transcript || '').match(/https?:\/\/\S+/)?.[0];
        resolved = url ? await attempt('link', () => resolveLink(env, { url }), { url }) : {};
        if (resolved.image) {
          const m = await attempt('link image', () => putMediaFromUrl(env, id, 'image', resolved.image));
          if (m) media.push(m);
        }
        break;
      }
      case 'song_moment': {
        const s = brain.song || {};
        const hit = await attempt('itunes', () => lookupTrack(env, s));
        resolved = { ...s, ...(hit || {}), start_s: s.start_s, end_s: s.end_s, clip: 'pending' };
        if (hit?.artwork) {
          const m = await attempt('cover', () => putMediaFromUrl(env, id, 'cover', hit.artwork));
          if (m) media.push(m);
        }
        const hasClip = media.some(m => m.role === 'clip');
        const hasCover = media.some(m => m.role === 'cover');
        if (hasClip) resolved.clip = 'ready';
        if (!hasClip || !hasCover) {
          const pending = await env.DB.prepare(`SELECT 1 FROM jobs WHERE item_id = ? AND status IN ('queued','running')`).bind(id).first();
          if (!pending) await enqueueJob(env, id, 'song_clip', {
            artist: resolved.artist, track: resolved.track, album: resolved.album,
            start_s: resolved.start_s, end_s: resolved.end_s, have_clip: hasClip,
          });
        }
        break;
      }
      case 'album': {
        const hit = await attempt('itunes album', () => lookupAlbum(env, brain.album || {}));
        resolved = { ...(brain.album || {}), ...(hit || {}) };
        if (hit?.artwork) {
          const m = await attempt('cover', () => putMediaFromUrl(env, id, 'cover', hit.artwork));
          if (m) media.push(m);
        }
        break;
      }
      case 'book': {
        resolved = await attempt('book', () => resolveBook(env, brain.book || {}), brain.book || {});
        if (resolved.cover) {
          const m = await attempt('cover', () => putMediaFromUrl(env, id, 'cover', resolved.cover));
          if (m) media.push(m);
        }
        break;
      }
      case 'font': {
        const f = await attempt('font', () => resolveFont(env, brain.font || { candidates: [] }), brain.font || { candidates: [] });
        candidates = f.candidates || [];
        const top = candidates[0];
        resolved = top ? { name: top.name, url: top.url, google_fonts: top.google_fonts, confidence: top.confidence } : {};
        if (!top || top.confidence < 0.85) needsConfirm = true;
        break;
      }
      case 'style': {
        resolved = await attempt('style', () => resolveStyle(env, brain.style || { name: brain.title, search_query: brain.title }), brain.style || {});
        if (resolved.image) {
          const m = await attempt('style image', () => putMediaFromUrl(env, id, 'image', resolved.image));
          if (m) media.push(m);
        }
        break;
      }
      case 'artwork': {
        resolved = await attempt('artwork', () => resolveArtwork(env, brain.artwork || { search_query: brain.title }), brain.artwork || {});
        if (resolved.image) {
          const m = await attempt('artwork image', () => putMediaFromUrl(env, id, 'image', resolved.image));
          if (m) media.push(m);
        }
        break;
      }
      case 'thing':
        resolved = { ...(brain.thing || {}) };
        if (resolved.search_query) resolved.search_url = `https://www.google.com/search?q=${encodeURIComponent(resolved.search_query)}`;
        break;
      case 'film':
        resolved = { ...(brain.film || {}) };
        resolved.search_url = `https://www.google.com/search?q=${encodeURIComponent(`${resolved.title} ${resolved.year || ''} film`)}`;
        break;
      case 'place':
        resolved = await resolvePlace(env, brain.place || { name: brain.title, query: brain.title }, source.location);
        if (resolved.image && !source.photo_key) {
          const m = await attempt('place image', () => putMediaFromUrl(env, id, 'image', resolved.image));
          if (m) media.push(m);
        }
        break;
      default:
        resolved = {};
    }

    if (brain.observations?.length) resolved.observations = brain.observations.slice(0, 6);
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
