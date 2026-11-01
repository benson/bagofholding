#!/usr/bin/env node
// Clip runner: polls the worker for song_clip jobs, runs the song-clip skill, uploads the mp4.
// Stateless; run it anywhere with ffmpeg + yt-dlp. Config from ~/.config/bagofholding/env.
import { readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(homedir(), '.config', 'bagofholding', 'env');
const env = Object.fromEntries((await readFile(envFile, 'utf8')).split('\n').filter(l => l.includes('=')).map(l => l.split('=').map(s => s.trim())));
const API = env.BAG_API, KEY = env.BAG_KEY;
const SONG_CLIP = env.SONG_CLIP || join(homedir(), 'Projects', 'agents', 'skills', 'song-clip', 'scripts', 'song-clip.mjs');
const POLL_MS = Number(env.POLL_MS || 20_000);
const once = process.argv.includes('--once');
const headers = { authorization: `Bearer ${KEY}` };
const log = (...a) => console.log(new Date().toISOString(), ...a);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`))));
  });
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function handle(job) {
  const { artist, track, album, start_s, end_s } = job.args;
  const tmp = join(here, 'tmp', job.id);
  await mkdir(tmp, { recursive: true });
  try {
    const range = `${fmt(start_s ?? 0)}-${fmt(end_s ?? (start_s ?? 0) + 10)}`;
    const args = [SONG_CLIP, `${artist} ${track}`, range, '--out', tmp];
    if (album) args.push('--album', album);
    log('clip', artist, '—', track, range);
    const out = await run('node', args);
    const mp4 = (await readdir(tmp)).find(f => f.endsWith('.mp4'));
    if (!mp4) throw new Error(`no mp4 produced\n${out}`);
    const source = (out.match(/^source:\s*(.*)$/m) || [])[1] || null;
    const form = new FormData();
    form.set('clip', new Blob([await readFile(join(tmp, mp4))], { type: 'video/mp4' }), mp4);
    form.set('meta', JSON.stringify({ clip_source: source }));
    const res = await fetch(`${API}/jobs/${job.id}/complete`, { method: 'POST', headers, body: form });
    if (!res.ok) throw new Error(`complete ${res.status}: ${await res.text()}`);
    log('done', job.id);
  } catch (err) {
    log('fail', job.id, err.message);
    await fetch(`${API}/jobs/${job.id}/fail`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ error: String(err.message).slice(0, 500) }) }).catch(() => {});
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function tick() {
  const res = await fetch(`${API}/jobs/next`, { headers });
  if (!res.ok) throw new Error(`jobs/next ${res.status}`);
  const { job } = await res.json();
  if (job) { await handle(job); return true; }
  return false;
}

log('runner up', API);
for (;;) {
  let worked = false;
  try { worked = await tick(); } catch (err) { log('tick error', err.message); }
  if (once && !worked) break;
  if (!worked) await new Promise(r => setTimeout(r, POLL_MS));
}
