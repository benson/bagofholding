function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m = html.match(re);
  return m ? decode(m[1] ?? m[2]) : null;
}

function decode(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

export async function resolveLink(env, { url }) {
  const u = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
  const out = { url: u.toString(), site: u.hostname.replace(/^www\./, '') };
  try {
    const res = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; bagofholding/1.0)', accept: 'text/html' }, redirect: 'follow' });
    out.url = res.url || out.url;
    const html = (await res.text()).slice(0, 300_000);
    out.title = meta(html, 'og:title') || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]) || null;
    out.description = meta(html, 'og:description') || meta(html, 'description') || null;
    const img = meta(html, 'og:image') || meta(html, 'twitter:image');
    out.image = img ? new URL(img, out.url).toString() : null;
    out.site_name = meta(html, 'og:site_name') || out.site;
  } catch (err) {
    out.error = String(err.message || err);
  }
  return out;
}
