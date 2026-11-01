const API = 'https://bagofholding-api.bensonperry.workers.dev';
const KINDS = ['idea', 'song_moment', 'font', 'style', 'artwork', 'thing', 'link', 'book', 'film', 'album', 'place', 'quote'];
const KIND_LABEL = { song_moment: 'song moment' };

const state = { items: [], tags: [], kind: null, tag: null, q: '', authed: false };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = k => KIND_LABEL[k] || k;
const key = () => { try { return localStorage.getItem('boh_key') || ''; } catch { return ''; } };
const headers = () => (key() ? { authorization: `Bearer ${key()}` } : {});
const media = (item, role) => item.media.find(m => m.role === role);
const thumb = item => media(item, 'cover') || media(item, 'clip') && media(item, 'cover') || media(item, 'image') || media(item, 'photo');

async function api(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function load() {
  const params = new URLSearchParams();
  if (state.kind) params.set('kind', state.kind);
  if (state.tag) params.set('tag', state.tag);
  if (state.q) params.set('q', state.q);
  const [{ items, authed }, { tags }] = await Promise.all([api(`/items?${params}`), api('/tags')]);
  state.items = items; state.authed = authed; state.tags = tags;
  render();
}

function render() {
  $('#auth-state').textContent = state.authed ? 'signed in' : '';
  const kinds = $('#kinds');
  kinds.innerHTML = [{ k: null, l: 'all' }, ...KINDS.map(k => ({ k, l: label(k) }))]
    .map(({ k, l }) => `<button class="chip ${state.kind === k ? 'on' : ''}" data-kind="${k ?? ''}">${l}</button>`).join('');
  const tags = $('#tags');
  tags.innerHTML = state.tags.map(t => `<button class="chip ${state.tag === t.tag ? 'on' : ''}" data-tag="${esc(t.tag)}">${esc(t.tag)}<span class="n">${t.n}</span></button>`).join('');

  const attention = state.items.filter(i => state.authed && ['needs_confirm', 'failed'].includes(i.status));
  const rest = state.items.filter(i => !attention.includes(i));
  $('#attention').classList.toggle('hidden', !attention.length);
  $('#attention-grid').innerHTML = attention.map(card).join('');
  $('#grid').innerHTML = rest.map(card).join('');
  $('#empty').classList.toggle('hidden', !!state.items.length);
}

function card(item) {
  const r = item.resolved || {};
  const t = thumb(item);
  let top = '';
  let body = '';
  switch (item.kind) {
    case 'font':
      top = `<div class="specimen" style="font-family:'${esc(r.name)}', serif">${esc(r.name || item.title || 'font')}</div>`;
      body = `<div class="title">${esc(r.name || item.title)}</div><div class="sub">${r.google_fonts ? 'google fonts' : 'font'}${r.confidence && r.confidence < 1 ? ` · ${Math.round(r.confidence * 100)}%` : ''}</div>`;
      if (r.google_fonts && r.name) ensureFont(r.name);
      break;
    case 'idea':
      body = `<div class="text">${esc(r.text || item.title)}</div>`;
      break;
    case 'quote':
      body = `<div class="text">“${esc(r.text || item.title)}”</div>${r.attribution ? `<div class="sub">${esc(r.attribution)}</div>` : ''}`;
      break;
    case 'song_moment':
      top = t ? `<img class="thumb" src="${t.url}" alt="" loading="lazy">` : '';
      body = `<div class="title">${esc(r.track || item.title)}</div><div class="sub">${esc(r.artist || '')}${r.start_s != null ? ` · ${fmt(r.start_s)}–${fmt(r.end_s)}` : ''}${r.clip === 'pending' ? ' · clip pending' : ''}</div>`;
      break;
    case 'link':
      top = t ? `<img class="thumb wide" src="${t.url}" alt="" loading="lazy">` : '';
      body = `<div class="title">${esc(r.title || item.title)}</div><div class="sub">${esc(r.site || '')}</div>`;
      break;
    case 'style':
      top = t ? `<img class="thumb wide" src="${t.url}" alt="" loading="lazy">` : '';
      body = `<div class="title">${esc(r.name || item.title)}</div><div class="sub">${esc([r.era, (r.traits || []).slice(0, 3).join(', ')].filter(Boolean).join(' · '))}</div>`;
      break;
    case 'artwork':
      top = t ? `<img class="thumb" src="${t.url}" alt="" loading="lazy">` : '';
      body = `<div class="title">${esc(r.title || item.title)}</div><div class="sub">${esc([r.artist, r.year].filter(Boolean).join(', '))}</div>`;
      break;
    default:
      top = t ? `<img class="thumb${item.kind === 'thing' || item.kind === 'place' ? ' wide' : ''}" src="${t.url}" alt="" loading="lazy">` : '';
      body = `<div class="title">${esc(item.title)}</div>${item.summary ? `<div class="sub">${esc(item.summary)}</div>` : ''}`;
  }
  const status = item.status !== 'resolved' ? `<span class="status ${item.status}">${item.status.replace('_', ' ')}</span>` : '';
  const lock = state.authed && !item.public ? '<span class="lock" title="private">·</span>' : '';
  return `<button class="card ${item.kind}" data-id="${item.id}">${top}<div class="body"><div class="kind"><span>${label(item.kind)}</span><span>${status}${lock}</span></div>${body}<div class="tagline">${item.tags.map(x => `<span>${esc(x)}</span>`).join('')}</div></div></button>`;
}

const fmt = s => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const loadedFonts = new Set();
function ensureFont(name) {
  if (loadedFonts.has(name)) return;
  loadedFonts.add(name);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}&display=swap`;
  document.head.appendChild(l);
}

function openDetail(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  const r = item.resolved || {};
  const s = item.source || {};
  const photo = media(item, 'photo'), cover = media(item, 'cover'), clip = media(item, 'clip'), image = media(item, 'image'), audio = media(item, 'audio');
  let h = `<h2>${esc(item.title)}</h2><div class="kind">${label(item.kind)}${item.summary ? ` · ${esc(item.summary)}` : ''}</div>`;
  if (clip) h += `<video controls playsinline poster="${cover ? cover.url : ''}" src="${clip.url}"></video>`;
  else if (cover || image) h += `<img class="hero" src="${(cover || image).url}" alt="">`;
  if (item.kind === 'font') {
    if (r.google_fonts && r.name) ensureFont(r.name);
    h += `<div class="text" style="font-family:'${esc(r.name)}', serif; font-size: 40px; line-height: 1.1">${esc(r.name || '')}<br><span style="font-size:18px">the quick brown fox jumps over the lazy dog 0123456789</span></div>`;
    if (r.url) h += `<div class="row"><a href="${r.url}" target="_blank" rel="noopener">${r.google_fonts ? 'google fonts' : 'find it'}</a></div>`;
    if (item.status === 'needs_confirm' && item.candidates.length && state.authed) {
      h += `<div class="row">which one is it?</div><div class="candidates">${item.candidates.map((c, i) => `<button data-confirm="${i}"><span>${esc(c.name)}</span><span class="conf">${Math.round(c.confidence * 100)}% · ${esc(c.reason)}</span></button>`).join('')}</div>`;
    } else if (item.candidates.length > 1) {
      h += `<div class="row">also considered: ${item.candidates.slice(1).map(c => esc(c.name)).join(', ')}</div>`;
    }
  }
  if (item.kind === 'idea') h += `<div class="text">${esc(r.text || '')}</div>`;
  if (item.kind === 'quote') h += `<div class="text">“${esc(r.text || '')}”${r.attribution ? `<br><span style="color:var(--muted)">${esc(r.attribution)}</span>` : ''}</div>`;
  if (item.kind === 'song_moment') {
    h += `<div class="row">${esc(r.artist || '')} · ${esc(r.album || '')}${r.start_s != null ? ` · ${fmt(r.start_s)}–${fmt(r.end_s)}` : ''}</div>`;
    if (r.clip === 'pending') h += `<div class="row">clip pending</div>`;
    if (r.clip === 'failed') h += `<div class="row">clip failed${r.clip_error ? `: ${esc(r.clip_error)}` : ''}</div>`;
    if (r.itunes_url) h += `<div class="row"><a href="${r.itunes_url}" target="_blank" rel="noopener">apple music</a>${r.preview_url ? ` · <a href="${r.preview_url}" target="_blank" rel="noopener">preview</a>` : ''}</div>`;
  }
  if (item.kind === 'link') h += `<div class="row"><a href="${r.url}" target="_blank" rel="noopener">${esc(r.url || '')}</a></div>${r.description ? `<div class="text" style="font-size:14px">${esc(r.description)}</div>` : ''}`;
  if (item.kind === 'thing') h += `<div class="text" style="font-size:14px">${esc(r.what || '')}${r.maker ? ` · ${esc(r.maker)}` : ''}</div>${r.search_url ? `<div class="row"><a href="${r.search_url}" target="_blank" rel="noopener">find it</a></div>` : ''}`;
  if (item.kind === 'book') h += `<div class="row">${esc(r.author || '')}${r.year ? ` · ${r.year}` : ''}${r.url ? ` · <a href="${r.url}" target="_blank" rel="noopener">open library</a>` : ''}</div>`;
  if (item.kind === 'film') h += `<div class="row">${r.year ? esc(r.year) : ''}${r.search_url ? ` · <a href="${r.search_url}" target="_blank" rel="noopener">find it</a>` : ''}</div>`;
  if (item.kind === 'album') h += `<div class="row">${esc(r.artist || '')}${r.year ? ` · ${r.year}` : ''}${r.itunes_url ? ` · <a href="${r.itunes_url}" target="_blank" rel="noopener">apple music</a>` : ''}</div>`;
  if (item.kind === 'place') h += `<div class="row">${r.map_url ? `<a href="${r.map_url}" target="_blank" rel="noopener">map</a>` : ''}</div>`;
  if (item.kind === 'style') {
    h += `<div class="row">${esc(r.era || '')}</div>`;
    if (r.traits?.length) h += `<div class="text" style="font-size:14px">${r.traits.map(esc).join(' · ')}</div>`;
    if (r.extract) h += `<div class="text" style="font-size:14px;color:var(--muted)">${esc(r.extract)}</div>`;
    h += `<div class="row">${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">wikipedia</a> · ` : ''}${r.search_url ? `<a href="${r.search_url}" target="_blank" rel="noopener">more like this</a>` : ''}</div>`;
    if (r.related?.length) h += `<div class="row">related: ${r.related.map(esc).join(', ')}</div>`;
  }
  if (item.kind === 'artwork') {
    h += `<div class="row">${esc([r.artist, r.year, r.medium, r.movement].filter(Boolean).join(' · '))}</div>`;
    if (r.extract) h += `<div class="text" style="font-size:14px;color:var(--muted)">${esc(r.extract)}</div>`;
    h += `<div class="row">${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">wikipedia</a> · ` : ''}${r.search_url ? `<a href="${r.search_url}" target="_blank" rel="noopener">find it</a>` : ''}</div>`;
  }
  if (r.observations?.length) h += `<div class="row obs">${r.observations.map(o => `<span><b>${esc(o.label)}</b> ${esc(o.value)}</span>`).join('')}</div>`;
  if (item.status === 'failed') h += `<div class="row status failed">failed: ${esc(item.error || '')}</div>`;
  h += `<div class="row">${item.tags.map(t => `<span>#${esc(t)}</span>`).join(' ')}</div>`;

  h += `<div class="provenance"><div class="label">captured ${new Date(item.created_at).toLocaleString()}${s.modality ? ` · ${esc(s.modality)}` : ''}</div>`;
  if (s.transcript) h += `<div>“${esc(s.transcript)}”</div>`;
  if (s.text) h += `<div>${esc(s.text)}</div>`;
  if (s.note) h += `<div>${esc(s.note)}</div>`;
  if (audio) h += `<audio controls preload="none" src="${audio.url}"></audio>`;
  if (photo) h += `<img class="hero" src="${photo.url}" alt="" style="margin-top:8px; max-height: 320px">`;
  h += `</div>`;

  if (state.authed) {
    h += `<input class="taginput" id="tagedit" value="${esc(item.tags.join(', '))}" placeholder="tags, comma separated">`;
    h += `<div class="actions">
      <button data-act="public">${item.public ? 'make private' : 'make public'}</button>
      <button data-act="tags">save tags</button>
      ${item.status === 'needs_confirm' ? '<button data-act="resolve">looks right</button>' : ''}
      <button data-act="reprocess">rethink</button>
      <button data-act="delete" class="danger">delete</button>
    </div>`;
  }
  $('#detail-body').innerHTML = h;
  $('#detail').classList.remove('hidden');
  $('#detail').dataset.id = id;
}

async function act(id, action, extra) {
  const item = state.items.find(i => i.id === id);
  try {
    if (action === 'public') await api(`/items/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ public: !item.public }) });
    if (action === 'tags') await api(`/items/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tags: $('#tagedit').value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) }) });
    if (action === 'resolve') await api(`/items/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }) });
    if (action === 'confirm') await api(`/items/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: extra }) });
    if (action === 'reprocess') await api(`/items/${id}/reprocess`, { method: 'POST' });
    if (action === 'delete') { if (!confirm('delete this?')) return; await api(`/items/${id}`, { method: 'DELETE' }); closeDetail(); }
    await load();
    if (action !== 'delete' && !$('#detail').classList.contains('hidden')) openDetail(id);
  } catch (err) { alert(err.message); }
}

function closeDetail() { $('#detail').classList.add('hidden'); }

document.addEventListener('click', e => {
  const chipK = e.target.closest('[data-kind]');
  if (chipK) { state.kind = chipK.dataset.kind || null; load(); return; }
  const chipT = e.target.closest('[data-tag]');
  if (chipT) { state.tag = state.tag === chipT.dataset.tag ? null : chipT.dataset.tag; load(); return; }
  const c = e.target.closest('.card');
  if (c) { openDetail(c.dataset.id); return; }
  if (e.target.id === 'detail' || e.target.id === 'detail-close') { closeDetail(); return; }
  const confirmBtn = e.target.closest('[data-confirm]');
  if (confirmBtn) { act($('#detail').dataset.id, 'confirm', Number(confirmBtn.dataset.confirm)); return; }
  const a = e.target.closest('[data-act]');
  if (a) { act($('#detail').dataset.id, a.dataset.act); return; }
  if (e.target.id === 'key-btn') {
    const k = prompt('key', key());
    if (k !== null) { try { k ? localStorage.setItem('boh_key', k.trim()) : localStorage.removeItem('boh_key'); } catch {} load(); }
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
let searchTimer;
$('#search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 200); });
$('#tags').addEventListener('dblclick', () => $('#tags').classList.toggle('open'));

load().catch(err => { $('#empty').textContent = `couldn't load: ${err.message}`; $('#empty').classList.remove('hidden'); });
setInterval(() => { if ($('#detail').classList.contains('hidden') && state.items.some(i => ['capturing', 'processing'].includes(i.status))) load(); }, 4000);
