import {withMemoryContext} from './memory-context.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { streamClaudeReply } from './claude-backend.mjs';
import { streamCodexReply } from './codex-backend.mjs';

export function validateSettings(value) {
  if (!value || !['demo', 'local', 'claude', 'codex'].includes(value.provider)) throw new Error('Choose Claude, Codex, local AI, or the demo provider.');
  if (value.profileAvatarDataUrl !== undefined && value.profileAvatarDataUrl !== null && (typeof value.profileAvatarDataUrl !== 'string' || value.profileAvatarDataUrl.length > 2_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.profileAvatarDataUrl))) throw new Error('Profile photo must be a PNG image.');
  if (value.displayName !== undefined && (typeof value.displayName !== 'string' || value.displayName.length > 80)) throw new Error('Your name must be text under 80 characters.');
  if (typeof value.baseUrl !== 'string' || typeof value.model !== 'string') throw new Error('Backend URL and model must be text.');
  let url;
  try { url = new URL(value.baseUrl); } catch { throw new Error('Enter a valid local backend URL.'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('The AI backend must be an HTTP loopback address, without credentials, query, or fragment.');
  if (value.model.length > 200) throw new Error('Model name is too long.');
  if (value.provider === 'local' && !value.model.trim()) throw new Error('Enter a model already installed in your local AI server.');
  if (value.provider === 'claude' && !['sonnet', 'haiku', 'opus'].includes(value.model)) throw new Error('Choose a Claude model: Sonnet, Haiku, or Opus.');
  if(value.provider==='codex'&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value.model))throw new Error('Choose a Codex model from your account.');
  if (value.effort !== undefined && !['minimal','low', 'medium', 'high','xhigh','max','ultra','persistent'].includes(value.effort)) throw new Error('Choose low, medium, or high response effort.');
  if (value.voiceCleanup !== undefined && typeof value.voiceCleanup !== 'boolean') throw new Error('Choose whether to use Haiku transcript cleanup.');
  if (value.voiceLanguage !== undefined && !['en', 'auto'].includes(value.voiceLanguage)) throw new Error('Choose English or automatic language detection.');
  return { profileAvatarDataUrl: value.profileAvatarDataUrl ?? null, displayName: value.displayName?.trim() || '', provider: value.provider, baseUrl: url.href.replace(/\/+$/, ''), model: value.model.trim(), effort: value.effort || 'medium', voiceCleanup: value.voiceCleanup !== false, voiceLanguage: value.voiceLanguage || 'en' };
}

async function* demoReply({ bot, messages, signal }) {
  const latest = messages.filter(m => m.role === 'user'&&!m.internalContinuation).at(-1)?.content ?? '';
  const previous = messages.filter(m => m.role === 'user').length - 1;
  const response = `Local demo response from ${bot.name}.\n\nYou wrote: “${latest}”\n\n${previous ? `This conversation includes ${previous} earlier user ${previous === 1 ? 'message' : 'messages'}. ` : ''}Your bot instructions are saved and will be included with the full conversation when you connect a local AI model.\n\nThis is a scripted response for testing the desktop workflow, not model inference.`;
  for (const part of response.match(/\S+\s*/g) ?? []) { await delay(10, undefined, { signal }); yield part; }
}

function readDelta(payload) {
  if (payload.error) throw new Error(typeof payload.error.message === 'string' ? payload.error.message : 'Local backend returned an error.');
  if (!Array.isArray(payload.choices)) throw new Error('Local backend returned an invalid chat response.');
  const choice = payload.choices[0];
  if (!choice) return '';
  const content = choice.delta?.content ?? choice.message?.content;
  if (content !== undefined && content !== null && typeof content !== 'string') throw new Error('Local backend returned non-text content.');
  return content ?? '';
}

export async function* streamReply({ settings, bot, messages, signal, ...context }) {
  settings = validateSettings(settings);
  if (settings.provider === 'demo') { yield* demoReply({ bot, messages, signal }); return; }
  if (settings.provider === 'claude') { yield* streamClaudeReply({ settings, bot, messages, signal, ...context }); return; }
  if (settings.provider === 'codex') { yield* streamCodexReply({settings,bot,messages,signal,...context}); return; }
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  timer.unref?.();
  try {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
      body: JSON.stringify({ model: settings.model, stream: true, messages: [{ role: 'system', content: bot.instructions }, ...messages.map(({ role, content },i) => ({ role, content:i===messages.length-1?withMemoryContext(content,context.turnContext):content }))] })
    });
    if (!response.ok) throw new Error(`Local backend returned HTTP ${response.status}. Check its model name and server status.`);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const content = readDelta(await response.json());
      if (!content) throw new Error('Local backend returned an empty response.');
      yield content; return;
    }
    if (!contentType.includes('text/event-stream') || !response.body) throw new Error('Local backend must return a chat JSON response or an SSE stream.');
    let buffer = '', gotText = false, finished = false;
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    try {
      while (!finished) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        // SSE lines are accumulated before parsing, including frames split across transport chunks.
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          if (data.trim() === '[DONE]') { finished = true; break; }
          let payload;
          try { payload = JSON.parse(data); } catch { throw new Error('Local backend returned malformed streaming JSON.'); }
          const text = readDelta(payload);
          if (text) { gotText = true; yield text; }
        }
        if (done) {
          if (buffer.trim() && !finished) throw new Error('Local backend ended with an incomplete streaming frame.');
          break;
        }
      }
      if (!gotText) throw new Error('Local backend returned an empty response.');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } catch (error) {
    if (timedOut) throw new Error('Local backend timed out after 30 seconds.');
    if (signal.aborted) throw signal.reason ?? new DOMException('Stopped', 'AbortError');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
