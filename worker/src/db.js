const JSON_COLS = ['tags', 'source', 'resolved', 'media', 'candidates'];

export function rowToItem(row, origin) {
  if (!row) return null;
  const item = { ...row };
  for (const c of JSON_COLS) {
    try { item[c] = JSON.parse(row[c] || (c === 'source' || c === 'resolved' ? '{}' : '[]')); }
    catch { item[c] = c === 'source' || c === 'resolved' ? {} : []; }
  }
  item.public = !!row.public;
  item.media = item.media.map(m => ({ ...m, url: `${origin}/media/${m.key}` }));
  return item;
}

export async function getItem(env, id, origin) {
  const row = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return rowToItem(row, origin);
}

export async function insertItem(env, item) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO items (id, kind, status, title, summary, tags, source, resolved, media, candidates, public, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    item.id, item.kind || 'unknown', item.status || 'capturing', item.title || null, item.summary || null,
    JSON.stringify(item.tags || []), JSON.stringify(item.source || {}), JSON.stringify(item.resolved || {}),
    JSON.stringify(item.media || []), JSON.stringify(item.candidates || []), item.public ? 1 : 0, now, now
  ).run();
}

export async function updateItem(env, id, patch) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    if (JSON_COLS.includes(k)) vals.push(JSON.stringify(v));
    else if (k === 'public') vals.push(v ? 1 : 0);
    else vals.push(v);
  }
  sets.push('updated_at = ?');
  vals.push(new Date().toISOString(), id);
  await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
}

export async function listItems(env, origin, { all, kind, tag, q, limit = 200, status } = {}) {
  const where = [];
  const vals = [];
  if (!all) where.push('public = 1');
  if (kind) { where.push('kind = ?'); vals.push(kind); }
  if (status) { where.push('status = ?'); vals.push(status); }
  if (tag) { where.push(`EXISTS (SELECT 1 FROM json_each(items.tags) WHERE json_each.value = ?)`); vals.push(tag); }
  if (q) { where.push('(title LIKE ? OR summary LIKE ? OR source LIKE ? OR resolved LIKE ?)'); const l = `%${q}%`; vals.push(l, l, l, l); }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  vals.push(Math.min(Number(limit) || 200, 500));
  const { results } = await env.DB.prepare(sql).bind(...vals).all();
  return results.map(r => rowToItem(r, origin));
}

export async function allTags(env, all) {
  const { results } = await env.DB.prepare(
    `SELECT value AS tag, COUNT(*) AS n FROM items, json_each(items.tags) ${all ? '' : 'WHERE public = 1'} GROUP BY value ORDER BY n DESC, value`
  ).all();
  return results;
}

export async function enqueueJob(env, itemId, type, args) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO jobs (id, item_id, type, args, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)`
  ).bind(id, itemId, type, JSON.stringify(args), now, now).run();
  return id;
}

export async function claimJob(env) {
  // Requeue jobs that have been running for over 30 minutes (dead runner).
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await env.DB.prepare(`UPDATE jobs SET status = 'queued' WHERE status = 'running' AND updated_at < ?`).bind(stale).run();
  const job = await env.DB.prepare(`SELECT * FROM jobs WHERE status = 'queued' AND attempts < 3 ORDER BY created_at LIMIT 1`).first();
  if (!job) return null;
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'`
  ).bind(now, job.id).run();
  if (!res.meta.changes) return null;
  return { ...job, args: JSON.parse(job.args || '{}'), attempts: job.attempts + 1 };
}

export async function finishJob(env, id, status, error) {
  await env.DB.prepare(`UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?`)
    .bind(status, error || null, new Date().toISOString(), id).run();
}
