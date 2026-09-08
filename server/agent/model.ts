import { createChat, MODEL, modelQuotaExhausted, throttle } from './client.js';

/**
 * Best-effort parse of an LLM "JSON" response. Handles the usual mangling:
 * ```json fences, prose around it, trailing commas, and truncated output
 * (unterminated string / unclosed brackets). Returns null if unrecoverable.
 */
function parseLooseJSON(raw: string): unknown {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const start = s.search(/[{[]/);
  if (start === -1) return null;
  s = s.slice(start);

  const tryParse = (t: string): unknown | undefined => {
    try { return JSON.parse(t); } catch { return undefined; }
  };

  // 1. as-is / clipped to the outermost close / trailing-comma-stripped
  const lastClose = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  for (const cand of [s, lastClose > 0 ? s.slice(0, lastClose + 1) : s]) {
    const a = tryParse(cand); if (a !== undefined) return a;
    const b = tryParse(cand.replace(/,(\s*[}\]])/g, '$1')); if (b !== undefined) return b;
  }

  // 2. truncation recovery — walk the text tracking string state + bracket
  //    stack. `lastSafe` = last spot the JSON was at a clean STRUCTURAL boundary
  //    at any depth (just after a comma or a closing bracket), so we can chop a
  //    half-written key/value and close whatever is still open.
  let inStr = false, esc = false;
  const stack: string[] = [];
  let lastSafe = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') { stack.pop(); if (stack.length) lastSafe = i + 1; }
    else if (ch === ',' && stack.length) lastSafe = i + 1;
  }

  const closeUp = (text: string): unknown | undefined => {
    // string state + bracket stack for THIS text (independent of the outer walk)
    let is = false, es = false; const st: string[] = [];
    for (const ch of text) {
      if (is) { if (es) es = false; else if (ch === '\\') es = true; else if (ch === '"') is = false; continue; }
      if (ch === '"') is = true;
      else if (ch === '{' || ch === '[') st.push(ch === '{' ? '}' : ']');
      else if (ch === '}' || ch === ']') st.pop();
    }
    let t = text;
    if (is) t += '"';                       // close an unterminated string
    t = t.replace(/,\s*$/, '').replace(/:\s*$/, ': null').replace(/"\s*:\s*$/, '": null');
    t += st.reverse().join('');             // close open { and [
    return tryParse(t) ?? tryParse(t.replace(/,(\s*[}\]])/g, '$1'));
  };

  return closeUp(s) ?? (lastSafe > 0 ? closeUp(s.slice(0, lastSafe)) : undefined) ?? null;
}

/**
 * Ask the model for a strict-JSON answer. `images` are data URLs (screenshots)
 * attached to the user turn. Returns the parsed object merged onto `fallback`,
 * or `fallback` if the call/parse fails or the quota is spent — the engine must
 * never crash on a flaky or unavailable model. `onFail` fires with a one-line
 * reason when the fallback is used for a recoverable reason (call error /
 * unparseable), so callers can surface it instead of silently losing data.
 */
export async function judgeJSON<T>(
  opts: { system: string; user: string; images?: string[]; fallback: T; model?: string; maxTokens?: number; onFail?: (reason: string) => void },
): Promise<T> {
  if (modelQuotaExhausted) { opts.onFail?.('AI model unavailable (quota/rate limit)'); return opts.fallback; }
  await throttle();
  try {
    const content: OpenAIUserContent = [{ type: 'text', text: opts.user }];
    for (const url of opts.images ?? []) content.push({ type: 'image_url', image_url: { url } });
    const res = await createChat({
      model: opts.model ?? MODEL,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: opts.system + ' Output ONLY the JSON object — no markdown fences, no commentary, no trailing commas. Escape any double-quote inside a string as \\". Keep it concise so the JSON is complete.' },
        { role: 'user', content: content as never },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = parseLooseJSON(raw);
    if (parsed && typeof parsed === 'object') return { ...opts.fallback, ...(parsed as object) };
    console.warn('[agent] judgeJSON: unrecoverable model JSON, using fallback. First 300 chars:', raw.slice(0, 300));
    opts.onFail?.(`the AI returned malformed JSON (${res.choices[0]?.finish_reason === 'length' ? 'response was cut off' : 'parse error'})`);
    return opts.fallback;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[agent] judgeJSON failed:', msg);
    opts.onFail?.(`AI analysis call failed: ${msg.slice(0, 120)}`);
    return opts.fallback;
  }
}

type OpenAIUserContent = (
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
)[];
