import { getMediaBase64 } from './media.js';

export async function transcribe(env, audioKey) {
  const audio = await getMediaBase64(env, audioKey);
  if (!audio) throw new Error('audio missing');
  const out = await env.AI.run(env.WHISPER_MODEL, { audio: audio.base64 });
  const text = (out?.text || '').trim();
  return { text, language: out?.language, words: out?.words };
}
