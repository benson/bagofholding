export async function resolveBook(env, { title, author }) {
  const params = new URLSearchParams({ title, limit: '3' });
  if (author) params.set('author', author);
  const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: { 'user-agent': 'bagofholding/1.0 (benson.perry@gmail.com)' } });
  if (!res.ok) throw new Error(`openlibrary ${res.status}`);
  const { docs } = await res.json();
  const d = docs?.[0];
  if (!d) return { title, author };
  return {
    title: d.title,
    author: d.author_name?.[0] || author || null,
    year: d.first_publish_year || null,
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    url: d.key ? `https://openlibrary.org${d.key}` : null,
  };
}

// Google Fonts answers 200 for a family it serves and 400 otherwise.
export async function resolveFont(env, { candidates }) {
  const out = [];
  for (const c of candidates.slice(0, 3)) {
    const fam = c.name.trim();
    let google = false;
    try {
      const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, '+')}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
      google = res.ok;
    } catch {}
    out.push({
      ...c,
      google_fonts: google,
      url: google ? `https://fonts.google.com/specimen/${fam.replace(/ /g, '+')}` : `https://www.google.com/search?q=${encodeURIComponent(fam + ' font')}`,
    });
  }
  return { candidates: out };
}

export async function resolvePlace(env, { name, query }, location) {
  const out = { name, query };
  if (location) out.map_url = `https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${location.lat},${location.lng}`;
  else out.map_url = `https://maps.apple.com/?q=${encodeURIComponent(query || name)}`;
  const w = await wikipedia(name).catch(() => null);
  if (w && w.title.toLowerCase().split(/\W+/).some(t => t.length > 3 && name.toLowerCase().includes(t))) {
    Object.assign(out, { wikipedia_title: w.title, url: w.url, extract: w.extract, image: w.image });
  }
  return out;
}

// First Wikipedia hit for a query: title, url, intro and lead image.
export async function wikipedia(query) {
  const h = { 'user-agent': 'bagofholding/1.0 (benson.perry@gmail.com)' };
  const sr = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(query)}`, { headers: h });
  if (!sr.ok) throw new Error(`wikipedia ${sr.status}`);
  const title = (await sr.json()).query?.search?.[0]?.title;
  if (!title) return null;
  const pr = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&exsentences=3&piprop=original&format=json&titles=${encodeURIComponent(title)}`, { headers: h });
  const page = Object.values((await pr.json()).query?.pages || {})[0] || {};
  return {
    title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    extract: page.extract || null,
    image: page.original?.source || null,
  };
}

export async function resolveStyle(env, style) {
  const out = { ...style };
  const w = await wikipedia(`${style.name} ${/architect|building|house|tower/i.test(style.search_query || '') ? 'architecture' : 'design style'}`).catch(() => null)
    || await wikipedia(style.name).catch(() => null);
  if (w) Object.assign(out, { wikipedia_title: w.title, url: w.url, extract: w.extract, image: w.image });
  out.search_url = `https://www.google.com/search?q=${encodeURIComponent(style.search_query || style.name)}&tbm=isch`;
  return out;
}

export async function resolveArtwork(env, art) {
  const out = { ...art };
  const q = [art.title, art.artist].filter(Boolean).join(' ');
  const w = q ? await wikipedia(q).catch(() => null) : null;
  if (w) Object.assign(out, { wikipedia_title: w.title, url: w.url, extract: w.extract, image: w.image });
  out.search_url = `https://www.google.com/search?q=${encodeURIComponent(art.search_query || q)}`;
  return out;
}
