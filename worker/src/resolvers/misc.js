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
  return out;
}
