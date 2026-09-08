import OpenAI from 'openai';

type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionCreateParamsNonStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/**
 * The agentic engine talks to ONE OpenAI-wire-compatible endpoint — provider is
 * whatever AI_BASE_URL points at (Gemini's OpenAI-compat layer by default here;
 * Bay of Assets, real OpenAI, or anything else works by changing these three
 * env vars, no code change). This file is the only place that knows the
 * provider; every asset just calls createChat().
 */
if (!process.env.AI_API_KEY) {
  console.warn('[agent] AI_API_KEY is not set — the agentic engine will fail. See .env.example');
}

export const ai = new OpenAI({
  apiKey: process.env.AI_API_KEY ?? 'missing-key',
  // Gemini's OpenAI-compatibility endpoint by default.
  baseURL: process.env.AI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
  timeout: 60_000, // a call slower than this is almost always a hung reasoning model — fail and move on
  maxRetries: 0,   // we do our own retry + model fallback below
});

// Gemini 3.x (Sep 2026). The full flash models REASON (3-40s/call — too slow for
// the multi-call agents); the *-lite models don't (~1-2s). gemini-2.5-flash /
// gemini-flash-latest are capped at 20 requests/DAY on the free tier.
export const MODEL = process.env.AI_MODEL ?? 'gemini-flash-lite-latest';

/** On repeated failure for the primary model, fall through to these (same provider/key). */
const FALLBACK_MODELS = (process.env.AI_FALLBACK_MODELS ?? 'gemini-3.5-flash-lite,gemini-3.6-flash')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** 401/403 — bad, missing, or deactivated key. Same key on every fallback model, so no retry helps. */
export const isAuthError = (err: unknown): boolean => {
  const s = (err as { status?: number })?.status;
  return s === 401 || s === 403 || /deactivat|invalid api key|missing.*api key|unauthor|permission denied/i.test(String((err as Error)?.message));
};

/** 429 worded like billing/plan exhaustion rather than a simple per-minute rate limit. Informational only — used for the log line, not to skip retries (a free-tier RPM limit uses the same wording). */
export const isQuotaError = (err: unknown): boolean =>
  (err as { status?: number })?.status === 429
  && /quota|exhaust|top up|billing|insufficient|credit|resource_exhausted/i.test(String((err as Error)?.message));

/** 404 / "no longer available" / "not found" — a stale model id. Drop it from rotation, don't count it as an outage. */
export const isBadModel = (err: unknown): boolean =>
  (err as { status?: number })?.status === 404
  || /no longer available|not found|not supported|decommission|unknown model|is not a valid model/i.test(String((err as Error)?.message));

const isRetryable = (err: unknown): boolean => {
  const status = (err as { status?: number })?.status;
  return status === 408 || status === 409 || status === 429 || (typeof status === 'number' && status >= 500)
    || /gateway|please retry|timeout|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(String((err as Error)?.message));
};

/** Gemini/OpenAI put a hint in the body ("Please retry in 42.2s") or a Retry-After header. Returns ms, or 0. */
function retryAfterMs(err: unknown): number {
  const hdr = Number((err as { headers?: Record<string, string> })?.headers?.['retry-after']);
  if (hdr > 0) return hdr * 1000;
  const m = String((err as Error)?.message).match(/retry in ([\d.]+)\s*s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Once the model has failed every attempt on every configured model, further
 * calls would just fail the same way. The engine flips this and stops calling
 * the model for the rest of the run — the audit finishes on the deterministic
 * assets only, instead of stalling on retries per asset.
 */
export let modelQuotaExhausted = false;
export let modelDownReason = '';
export function markModelDown(reason: string) {
  modelQuotaExhausted = true;
  modelDownReason = reason;
}

function describe(err: unknown): string {
  if (isAuthError(err)) return 'API key invalid, missing, or deactivated';
  if (isQuotaError(err)) return 'rate limit / daily quota exhausted — wait for the quota to reset or add billing to the key';
  return (err as Error)?.message?.slice(0, 120) ?? String(err);
}

/**
 * Retry the primary model with growing backoff (some gateways are slow and
 * transiently 500/429); if it keeps failing, try each fallback model once.
 * Marks the model "down" for the rest of the run only once every option is
 * exhausted, so one flaky call doesn't kill the whole audit.
 */
export async function createChat(
  body: ChatCompletionCreateParamsNonStreaming,
  opts: { attempts?: number } = {},
): Promise<ChatCompletion> {
  if (modelQuotaExhausted) throw new Error(`model unavailable this run (${modelDownReason})`);

  const attempts = opts.attempts ?? 4;
  const backoff = [1500, 3500, 6000, 9000];
  const models = [body.model, ...FALLBACK_MODELS.filter((m) => m !== body.model)];
  let lastErr: unknown;
  let realFailure = false; // a genuine outage on a model that actually exists

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const tries = mi === 0 ? attempts : 2; // primary gets full budget, fallbacks get 2
    for (let i = 0; i < tries; i++) {
      try {
        return await ai.chat.completions.create({ ...body, model, stream: false });
      } catch (err) {
        lastErr = err;
        if (isAuthError(err)) { markModelDown(describe(err)); throw err; } // same key everywhere — pointless to keep trying
        if (isBadModel(err)) { console.warn(`[agent] model "${model}" is not available (${(err as { status?: number })?.status ?? '?'}) — dropping it`); break; }
        realFailure = true;
        if (!isRetryable(err)) break; // non-retryable but not auth/bad-model — try the next model
        // 429: honor the server's "retry in Ns" if it's short (a per-minute
        // window clearing), otherwise stop for the run — the fallback shares
        // the same key + quota so hopping is pointless.
        if (isQuotaError(err)) {
          const wait = retryAfterMs(err);
          if (i === 0 && wait > 0 && wait <= 45_000) {
            console.warn(`[agent] rate-limited — waiting ${Math.round(wait / 1000)}s for the window to clear`);
            await sleep(wait + 500);
            continue;
          }
          break;
        }
        if (i > 0 || mi > 0) console.warn(`[agent] ${model} attempt ${i + 1} failed (${describe(err)}) — retrying`);
        if (i < tries - 1) await sleep(backoff[Math.min(i, backoff.length - 1)]);
      }
    }
    if (isQuotaError(lastErr)) break; // shared key/quota — the next model won't help
    if (mi < models.length - 1) console.warn(`[agent] falling back from ${model} to ${models[mi + 1]}`);
  }

  // Only declare the model "down for this run" on a genuine outage. If every
  // configured model id was simply invalid, that's a config error — surface it
  // but still stop calling (nothing would work this run anyway).
  markModelDown(realFailure ? describe(lastErr) : 'no configured model id is valid — check AI_MODEL / AI_FALLBACK_MODELS');
  throw lastErr;
}

/**
 * Sliding-window RPM throttle shared by every model call. Gemini free tier is
 * ~20 requests/minute; AI_RPM defaults to 12 to leave headroom for the odd retry.
 */
const RPM = Math.max(1, Number(process.env.AI_RPM ?? 12));
const callTimes: number[] = [];

export async function throttle(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (callTimes.length && now - callTimes[0] >= 60_000) callTimes.shift();
    if (callTimes.length < RPM) { callTimes.push(now); return; }
    await sleep(60_000 - (now - callTimes[0]) + 250);
  }
}
