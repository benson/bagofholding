const EXT = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4',
};

export function extFor(type, fallback = 'bin') {
  return EXT[(type || '').split(';')[0].trim()] || fallback;
}

export async function putMedia(env, itemId, role, body, contentType) {
  const key = `${itemId}/${role}-${crypto.randomUUID().slice(0, 8)}.${extFor(contentType)}`;
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: contentType || 'application/octet-stream' } });
  return { key, role, type: contentType || 'application/octet-stream' };
}

export async function putMediaFromUrl(env, itemId, role, url) {
  const res = await fetch(url, { headers: { 'user-agent': 'bagofholding/1.0' } });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const type = res.headers.get('content-type') || 'application/octet-stream';
  return putMedia(env, itemId, role, await res.arrayBuffer(), type);
}

export async function getMediaBase64(env, key) {
  const obj = await env.MEDIA.get(key);
  if (!obj) return null;
  const buf = new Uint8Array(await obj.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
  return { base64: btoa(bin), type: obj.httpMetadata?.contentType || 'application/octet-stream' };
}

export async function deleteItemMedia(env, itemId) {
  const list = await env.MEDIA.list({ prefix: `${itemId}/` });
  if (list.objects.length) await env.MEDIA.delete(list.objects.map(o => o.key));
}
