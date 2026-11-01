import Anthropic from '@anthropic-ai/sdk';

export const LOOKUPS = ['wikipedia', 'unfurl', 'itunes_track', 'itunes_album', 'openlibrary', 'google_font', 'song_clip', 'web'];

// Kinds the page has a special card for. Any other kind is fine; it gets the generic card.
export const KNOWN_KINDS = ['idea', 'quote', 'song moment', 'font', 'style', 'artwork', 'thing', 'link', 'book', 'film', 'album', 'place', 'video', 'recipe', 'person', 'word'];

const SYSTEM = `You are the brain of Bag of Holding, a personal collection for Benson. He captures a fleeting reaction with as little effort as possible: a mumbled sentence, a quick photo, a typed fragment. Work out what he actually wants to keep and describe the real object, not the capture. The raw capture is provenance; the item is the resolved thing.

First decide what he is reacting to. His words decide, not the photo's subject: "style", "look", "vibe", "aesthetic", "era", "kind of", "this type of" mean he is reacting to HOW it looks, so the kind is style and the specific building, product or place goes into observations. Without such words he is reacting to WHAT it is.

kind: a short lowercase noun for what the item is. Reuse one of the existing kinds when it fits; invent a new one when nothing fits (video, recipe, person, word, game, podcast, tweet, color, plant, restaurant, tool, ...). Never force something into a kind that does not fit. Common kinds and what they resolve to:
- idea: his thought, cleaned up into clear prose in his voice (text), fixing transcription errors, kept short, not expanded.
- quote: the words (text) and who said them (attribution).
- song moment: "30s to 50s of Song X by Y" is a track plus a time range. A single timestamp means a 10 second clip from there; "around" or "-ish" still means a clip from there. Always request the song_clip lookup, even when the artist is unknown or the title is uncertain: the lookup searches by title and finds the artist. Put your best guess at the artist in args when you know the song.
- font: name the typeface. candidates: up to 3 families with confidence 0 to 1 and a reason. needs_confirm unless the top one is above 0.85. Request google_font.
- style: the named style or movement (brutalism, memphis, frutiger aero, swiss style, wabi-sabi, y2k, ...), most specific correct name. fields: era, traits seen, related styles. Request wikipedia.
- artwork: title, artist, year, medium, movement in fields. Request wikipedia.
- thing: what it is, maker, category in fields. Request web with a query that would find it to buy or read about.
- link: request unfurl with the URL.
- book, film, album, person, place: name it; request openlibrary / wikipedia / itunes_album / wikipedia / wikipedia.
- video: name it as precisely as you can (creator, title, platform). If a URL is given request unfurl; otherwise request web with a query that would find the exact video.
- recipe, word, game, podcast, anything else: name it, put the useful facts in fields, request web or wikipedia so the canonical page gets attached.

title: a short natural-language name for the thing itself. summary: one line, may be empty for ideas and quotes. tags: 2 to 6 lowercase tags; reuse the existing tags passed to you whenever one fits, invent only when nothing fits; prefer theme tags (typography, music, product, architecture, writing, design, food, humor) plus specific ones (an artist, a genre, a material).
fields: short labeled facts about the thing itself (artist, year, maker, era, ingredients, platform, ...). Only what you are confident of.
observations: when there is a photo, anything else you can suss out that he might care about later: typeface, style or era, color palette, material, maker, location, the specific building or product when the item is a style. 0 to 6, confident ones only, skip the obvious.
lookups: what the worker should fetch to make the item real. Ask for what helps; several are fine. Each has a type, a query, and args (strings, empty when unused): url, artist, track, album, start_s, end_s, author, title.
needs_confirm is only for a real choice between named candidates (fonts, species, similar products). Missing details or a rough timestamp are not a reason; go with the best guess, request the lookups anyway, and set confidence accordingly.
Dictation is noisy: "tracks" might be "track", "fawn" might be "font". Infer generously from context. Unknown values are empty strings.`;

function schema() {
  const str = { type: 'string' };
  const num = { type: 'number' };
  const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
  const list = (items) => ({ type: 'array', items });
  return {
    type: 'json_schema',
    schema: obj({
      kind: str,
      title: str,
      summary: str,
      text: str,
      attribution: str,
      tags: list(str),
      confidence: num,
      needs_confirm: { type: 'boolean' },
      fields: list(obj({ label: str, value: str })),
      observations: list(obj({ label: str, value: str })),
      candidates: list(obj({ name: str, confidence: num, reason: str })),
      lookups: list(obj({
        type: { type: 'string', enum: LOOKUPS },
        query: str,
        args: obj({ url: str, artist: str, track: str, album: str, start_s: str, end_s: str, author: str, title: str }),
      })),
    }),
  };
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('brain returned no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

const clean = s => (typeof s === 'string' ? s.trim() : '');

export async function classify(env, { transcript, text, note, photo, location, existingTags, existingKinds }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const content = [];
  if (photo) content.push({ type: 'image', source: { type: 'base64', media_type: photo.type, data: photo.base64 } });
  const lines = [];
  if (transcript) lines.push(`Spoken (transcribed): ${transcript}`);
  if (text) lines.push(`Typed: ${text}`);
  if (note) lines.push(`Note: ${note}`);
  if (photo && !transcript && !text && !note) lines.push('A photo with no words.');
  if (location) lines.push(`Captured near lat ${location.lat}, lng ${location.lng}.`);
  const kinds = Array.from(new Set([...KNOWN_KINDS, ...(existingKinds || [])]));
  lines.push(`Existing kinds: ${kinds.join(', ')}`);
  lines.push(`Existing tags: ${existingTags?.length ? existingTags.join(', ') : '(none yet)'}`);
  lines.push(`Captured at ${new Date().toISOString()}.`);
  content.push({ type: 'text', text: lines.join('\n') });

  const base = {
    model: env.CLAUDE_MODEL || 'claude-opus-5-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'high' },
  };

  let response;
  try {
    response = await client.messages.create({ ...base, output_config: { ...base.output_config, format: schema() } });
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    console.warn(`brain: structured output rejected, falling back: ${err.message}`);
    response = await client.messages.create({
      ...base,
      system: `${SYSTEM}\n\nReply with one JSON object and nothing else, matching this JSON schema exactly:\n${JSON.stringify(schema().schema)}`,
    });
  }
  if (response.stop_reason === 'refusal') throw new Error(`brain refused: ${response.stop_details?.explanation || ''}`);
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('brain returned no text');
  const raw = extractJson(textBlock.text);

  return {
    kind: clean(raw.kind).toLowerCase().replace(/[_-]+/g, ' ') || 'idea',
    title: clean(raw.title),
    summary: clean(raw.summary),
    text: clean(raw.text),
    attribution: clean(raw.attribution),
    tags: Array.from(new Set((raw.tags || []).map(t => clean(t).toLowerCase()).filter(Boolean))).slice(0, 8),
    confidence: Number(raw.confidence) || 0,
    needs_confirm: !!raw.needs_confirm,
    fields: (raw.fields || []).map(f => ({ label: clean(f.label), value: clean(f.value) })).filter(f => f.label && f.value).slice(0, 12),
    observations: (raw.observations || []).map(f => ({ label: clean(f.label), value: clean(f.value) })).filter(f => f.label && f.value).slice(0, 6),
    candidates: (raw.candidates || []).map(c => ({ name: clean(c.name || c.family), confidence: Number(c.confidence) || 0, reason: clean(c.reason) })).filter(c => c.name).slice(0, 5),
    lookups: (raw.lookups || []).filter(l => LOOKUPS.includes(l.type)).map(l => {
      const args = {};
      for (const [k, v] of Object.entries(l.args || {})) if (clean(v)) args[k] = clean(v);
      return { type: l.type, query: clean(l.query), args };
    }).slice(0, 6),
  };
}

// A second, tool-using call: find the canonical page for something the brain could only describe.
export async function webFind(env, query) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: env.CLAUDE_MODEL || 'claude-opus-5-5',
    max_tokens: 2000,
    output_config: { effort: 'low' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    system: 'Find the single best canonical web page for what the user describes (the official page, the original video, the product page, the primary source). Then reply with only a JSON object: {"title": "...", "url": "...", "summary": "one line", "image": "direct image url or empty"}. If nothing fits well, use empty strings.',
    messages: [{ role: 'user', content: query }],
  });
  if (response.stop_reason === 'refusal') return null;
  const txt = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  try {
    const o = extractJson(txt);
    return o.url ? { title: clean(o.title), url: clean(o.url), summary: clean(o.summary), image: clean(o.image) } : null;
  } catch { return null; }
}
