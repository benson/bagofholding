const norm = s => (s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function score(hit, { artist, track, album }) {
  let s = 0;
  const a = norm(hit.artistName), t = norm(hit.trackName), c = norm(hit.collectionName);
  if (a === norm(artist)) s += 3; else if (a.includes(norm(artist)) || norm(artist).includes(a)) s += 1.5;
  if (t === norm(track)) s += 3; else if (t.includes(norm(track)) || norm(track).includes(t)) s += 1.5;
  if (album && (c === norm(album) || c.includes(norm(album)))) s += 2;
  if (/live|karaoke|tribute|cover|remix|instrumental/i.test(`${hit.trackName} ${hit.collectionName}`) && !/live|remix/i.test(`${track} ${album || ''}`)) s -= 2;
  return s;
}

export async function lookupTrack(env, { artist, track, album }) {
  const term = encodeURIComponent(`${artist} ${track}`);
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10`, { headers: { 'user-agent': 'bagofholding/1.0' } });
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  const { results } = await res.json();
  if (!results?.length) return null;
  const best = results.map(h => ({ h, s: score(h, { artist, track, album }) })).sort((x, y) => y.s - x.s)[0].h;
  return {
    artist: best.artistName,
    track: best.trackName,
    album: best.collectionName,
    artwork: (best.artworkUrl100 || '').replace('100x100bb', '1200x1200bb'),
    itunes_url: best.trackViewUrl,
    preview_url: best.previewUrl,
    duration_s: Math.round((best.trackTimeMillis || 0) / 1000),
    release_date: best.releaseDate,
  };
}

export async function lookupAlbum(env, { artist, title }) {
  const term = encodeURIComponent(`${artist} ${title}`);
  const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=album&limit=5`, { headers: { 'user-agent': 'bagofholding/1.0' } });
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  const { results } = await res.json();
  const best = results?.[0];
  if (!best) return null;
  return {
    artist: best.artistName,
    title: best.collectionName,
    artwork: (best.artworkUrl100 || '').replace('100x100bb', '1200x1200bb'),
    itunes_url: best.collectionViewUrl,
    year: (best.releaseDate || '').slice(0, 4),
  };
}
