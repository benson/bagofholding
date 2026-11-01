import Anthropic from '@anthropic-ai/sdk';

export const KINDS = ['idea', 'song_moment', 'font', 'thing', 'link', 'book', 'film', 'album', 'place', 'quote'];

const SYSTEM = `You are the brain of Bag of Holding, a personal collection for Benson. He captures a fleeting reaction with as little effort as possible: a mumbled sentence, a quick photo, a typed fragment. Your job is to work out what he actually wants to keep and describe the real object, not the capture.

The raw capture is provenance. The item is the resolved thing:
- "I love 30 seconds to 50 seconds of Song X by Y" is a song_moment: the track and the time range. A single timestamp means a 10 second clip starting there. Convert all times to seconds.
- A photo plus "I like this font" is a font: identify the typeface in the photo. Give up to 3 candidate families with confidence 0 to 1 and a short reason each. Set needs_confirm unless the top candidate is above 0.85.
- A photo of an object, product, poster, building, room or garment with no other instruction is a thing: say what it is, who makes it if you can tell, and a web search query that would find it. If the words name a specific aspect ("the chair", "those tiles"), resolve that aspect, not the whole scene.
- A URL or "that site X" is a link.
- A book, film or album title is book, film or album.
- "This place" or a named venue is a place.
- "Quote:" or clearly quoted words with an attribution is a quote.
- Anything else, including half-formed thoughts, is an idea: clean it up into clear prose in his voice, fix transcription errors, keep it short, do not expand it.

Title: a short natural-language name for the thing itself (track name, font family, product, the idea's gist). Summary: one line, may be empty for ideas. Tags: 2 to 6 lowercase tags. Reuse the existing tags passed to you whenever one fits; invent new ones only when nothing fits. Prefer theme tags (typography, music, product, architecture, writing, design, food, humor) and specific tags (an artist, a genre, a material).

Fill only the field for the chosen kind; set the others to null. Dictation is noisy: "tracks" might be "track", "fawn" might be "font". Infer generously from context.`;

function schema() {
  const str = { type: 'string' };
  const num = { type: 'number' };
  const nullable = (obj) => ({ anyOf: [obj, { type: 'null' }] });
  const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
  return {
    type: 'json_schema',
    schema: obj({
      kind: { type: 'string', enum: KINDS },
      title: str,
      summary: str,
      tags: { type: 'array', items: str },
      confidence: num,
      needs_confirm: { type: 'boolean' },
      idea: nullable(obj({ text: str })),
      song: nullable(obj({ artist: str, track: str, album: nullable(str), start_s: num, end_s: num })),
      link: nullable(obj({ url: str })),
      font: nullable(obj({ candidates: { type: 'array', items: obj({ name: str, confidence: num, reason: str }) } })),
      thing: nullable(obj({ what: str, maker: nullable(str), category: str, search_query: str })),
      book: nullable(obj({ title: str, author: nullable(str) })),
      film: nullable(obj({ title: str, year: nullable(str) })),
      album: nullable(obj({ artist: str, title: str })),
      place: nullable(obj({ name: str, query: str })),
      quote: nullable(obj({ text: str, attribution: nullable(str) })),
    }),
  };
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('brain returned no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

export async function classify(env, { transcript, text, note, photo, location, existingTags }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const content = [];
  if (photo) content.push({ type: 'image', source: { type: 'base64', media_type: photo.type, data: photo.base64 } });
  const lines = [];
  if (transcript) lines.push(`Spoken (transcribed): ${transcript}`);
  if (text) lines.push(`Typed: ${text}`);
  if (note) lines.push(`Note: ${note}`);
  if (photo && !transcript && !text && !note) lines.push('A photo with no words.');
  if (location) lines.push(`Captured near lat ${location.lat}, lng ${location.lng}.`);
  lines.push(`Existing tags: ${existingTags?.length ? existingTags.join(', ') : '(none yet)'}`);
  lines.push(`Captured at ${new Date().toISOString()}.`);
  content.push({ type: 'text', text: lines.join('\n') });

  const base = {
    model: env.CLAUDE_MODEL || 'claude-opus-5-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'medium' },
  };

  let response;
  try {
    response = await client.messages.create({ ...base, output_config: { ...base.output_config, format: schema() } });
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    response = await client.messages.create(base);
  }
  if (response.stop_reason === 'refusal') throw new Error(`brain refused: ${response.stop_details?.explanation || ''}`);
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('brain returned no text');
  const out = extractJson(textBlock.text);
  if (!KINDS.includes(out.kind)) out.kind = 'idea';
  out.tags = Array.from(new Set((out.tags || []).map(t => String(t).toLowerCase().trim()).filter(Boolean))).slice(0, 8);
  return out;
}
