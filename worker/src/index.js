import { getItem, insertItem, updateItem, listItems, allTags, allKinds, claimJob, finishJob } from './db.js';
import { putMedia, putMediaFromUrl, deleteItemMedia } from './media.js';
import { processItem } from './process.js';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

function cors(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  const ok = allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'access-control-allow-origin': ok ? origin : allowed[0] || '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function authed(req, env) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : new URL(req.url).searchParams.get('key');
  return !!env.BAG_KEY && token === env.BAG_KEY;
}

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = url.origin;
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const auth = authed(req, env);
    const respond = (data, status) => json(data, status, headers);
    const deny = () => respond({ error: 'unauthorized' }, 401);

    try {
      if (path === '/' || path === '/health') return respond({ ok: true, service: 'bagofholding-api' });

      if (path === '/capture' && req.method === 'POST') {
        if (!auth) return deny();
        const form = await req.formData();
        const id = crypto.randomUUID();
        const source = { modality: 'text', client: form.get('client') || null };
        const media = [];
        const text = (form.get('text') || '').toString().trim();
        const note = (form.get('note') || '').toString().trim();
        if (text) source.text = text;
        if (note) source.note = note;
        const lat = num(form.get('lat')), lng = num(form.get('lng'));
        if (lat !== null && lng !== null) source.location = { lat, lng };
        const audio = form.get('audio');
        if (audio && typeof audio !== 'string' && audio.size) {
          const m = await putMedia(env, id, 'audio', audio.stream(), audio.type || 'audio/mp4');
          media.push(m);
          source.audio_key = m.key;
          source.modality = 'voice';
        }
        const photo = form.get('photo');
        if (photo && typeof photo !== 'string' && photo.size) {
          const m = await putMedia(env, id, 'photo', photo.stream(), photo.type || 'image/jpeg');
          media.push(m);
          source.photo_key = m.key;
          source.modality = source.modality === 'voice' ? 'voice+photo' : 'photo';
        }
        if (!text && !source.audio_key && !source.photo_key) return respond({ error: 'empty capture' }, 400);
        const title = text ? text.slice(0, 80) : source.photo_key ? 'photo' : 'voice note';
        await insertItem(env, { id, status: 'capturing', title, source, media, public: false });
        ctx.waitUntil(processItem(env, id, origin));
        return respond({ id, status: 'capturing' }, 202);
      }

      if (path === '/items' && req.method === 'GET') {
        const p = url.searchParams;
        const items = await listItems(env, origin, {
          all: auth && p.get('all') !== '0', kind: p.get('kind'), tag: p.get('tag'), q: p.get('q'), status: p.get('status'), limit: p.get('limit'),
        });
        return respond({ items, authed: auth });
      }

      if (path === '/tags' && req.method === 'GET') return respond({ tags: await allTags(env, auth), kinds: await allKinds(env, auth) });

      let m = path.match(/^\/items\/([0-9a-f-]{36})(?:\/(reprocess))?$/);
      if (m) {
        const id = m[1];
        const item = await getItem(env, id, origin);
        if (!item || (!item.public && !auth)) return respond({ error: 'not found' }, 404);
        if (req.method === 'GET' && !m[2]) return respond({ item });
        if (!auth) return deny();
        if (req.method === 'POST' && m[2] === 'reprocess') {
          await updateItem(env, id, { status: 'capturing' });
          ctx.waitUntil(processItem(env, id, origin));
          return respond({ id, status: 'capturing' }, 202);
        }
        if (req.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
          await env.DB.prepare('DELETE FROM jobs WHERE item_id = ?').bind(id).run();
          ctx.waitUntil(deleteItemMedia(env, id));
          return respond({ deleted: id });
        }
        if (req.method === 'PATCH') {
          const body = await req.json();
          const patch = {};
          for (const k of ['title', 'summary', 'kind', 'public', 'tags', 'resolved']) if (k in body) patch[k] = body[k];
          if (typeof body.confirm === 'number' && item.candidates[body.confirm]) {
            const c = item.candidates[body.confirm];
            patch.resolved = { ...item.resolved, name: c.name, confidence: 1 };
            if (c.url) { patch.resolved.url = c.url; patch.resolved.links = [{ label: c.google_fonts ? 'google fonts' : 'find it', url: c.url }, ...(item.resolved.links || []).filter(l => l.url !== c.url)]; }
            if (c.google_fonts !== undefined) patch.resolved.google_fonts = c.google_fonts;
            patch.title = body.title ?? c.name;
            patch.status = 'resolved';
          }
          if (body.status === 'resolved') patch.status = 'resolved';
          await updateItem(env, id, patch);
          return respond({ item: await getItem(env, id, origin) });
        }
      }

      if (path.startsWith('/media/') && req.method === 'GET') {
        const key = decodeURIComponent(path.slice('/media/'.length));
        const obj = await env.MEDIA.get(key);
        if (!obj) return respond({ error: 'not found' }, 404);
        const h = new Headers(headers);
        h.set('content-type', obj.httpMetadata?.contentType || 'application/octet-stream');
        h.set('cache-control', 'public, max-age=31536000, immutable');
        h.set('etag', obj.httpEtag);
        return new Response(obj.body, { headers: h });
      }

      if (path === '/jobs/next' && req.method === 'GET') {
        if (!auth) return deny();
        const job = await claimJob(env);
        return respond({ job });
      }

      m = path.match(/^\/jobs\/([0-9a-f-]{36})\/(complete|fail)$/);
      if (m && req.method === 'POST') {
        if (!auth) return deny();
        const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(m[1]).first();
        if (!job) return respond({ error: 'not found' }, 404);
        if (m[2] === 'fail') {
          const { error, meta } = await req.json().catch(() => ({}));
          await finishJob(env, job.id, job.attempts >= 3 ? 'failed' : 'queued', error);
          const item = await getItem(env, job.item_id, origin);
          if (item) {
            const extra = meta && typeof meta === 'object' ? meta : {};
            const patch = { resolved: { ...item.resolved, song: { ...(item.resolved.song || {}), ...extra } } };
            if (job.attempts >= 3) Object.assign(patch.resolved.song, { clip: 'failed', clip_error: error || null });
            if (extra.artwork && !item.media.some(x => x.role === 'cover')) {
              const m = await putMediaFromUrl(env, item.id, 'cover', extra.artwork).catch(() => null);
              if (m) patch.media = [...item.media, m];
            }
            await updateItem(env, job.item_id, patch);
          }
          return respond({ ok: true });
        }
        const form = await req.formData();
        const item = await getItem(env, job.item_id, origin);
        if (!item) return respond({ error: 'item gone' }, 410);
        let media = [...item.media];
        const clip = form.get('clip');
        if (clip && typeof clip !== 'string' && clip.size) {
          media = media.filter(m => m.role !== 'clip');
          media.push(await putMedia(env, item.id, 'clip', clip.stream(), clip.type || 'video/mp4'));
        }
        const cover = form.get('cover');
        if (cover && typeof cover !== 'string' && cover.size && !media.some(x => x.role === 'cover')) media.push(await putMedia(env, item.id, 'cover', cover.stream(), cover.type || 'image/jpeg'));
        let meta = {};
        try { meta = JSON.parse(form.get('meta') || '{}'); } catch {}
        const song = { ...(item.resolved.song || {}), ...meta, clip: 'ready' };
        const links = [...(item.resolved.links || [])];
        if (meta.itunes_url && !links.some(l => l.url === meta.itunes_url)) links.push({ label: 'apple music', url: meta.itunes_url });
        await updateItem(env, item.id, { media, resolved: { ...item.resolved, song, links } });
        await finishJob(env, job.id, 'done');
        return respond({ ok: true });
      }

      return respond({ error: 'not found' }, 404);
    } catch (err) {
      console.error(err.stack || err);
      return respond({ error: String(err.message || err) }, 500);
    }
  },
};
