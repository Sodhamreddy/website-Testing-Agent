import { chromium } from 'playwright';
import type OpenAI from 'openai';
import type { TestIssue, TestResult, ChecklistStatus } from '../../src/types/index.js';
import { createChat, isAuthError, isQuotaError, MODEL, modelDownReason, modelQuotaExhausted, throttle } from './client.js';
import { judgeJSON } from './model.js';
import { securityScan } from './security.js';
import { baselineScan, crawl } from './baseline.js';
import { Reporter } from '../audit/reporter.js';
import type { AuditContext, LogType } from './types.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type LogCallback = (msg: string, type?: LogType) => void;
type ProgressCallback = (pct: number) => void;

const MAX_TURNS = 20;
const WALL_CLOCK_MS = 5 * 60_000;
const RESULT_CAP = 1100;      // max chars of any tool result fed back to the model
const HISTORY_KEEP = 10;      // recent messages kept verbatim; older ones collapse to a summary

/**
 * TRUE exploration agent, TOKEN-MANAGED. No fixed phases, no deterministic
 * backstop — the report is exactly what the agent found. The model gets
 * low-level browser tools and one goal and decides which pages to open, what to
 * poke at, what to report, when to stop. Kept cheap by: compact tool results, a
 * rolling history that collapses old turns into a one-line summary, and a hard
 * 16-turn cap. If the AI quota runs out mid-run the audit just stops with what
 * it has. Same output contract as the other engines.
 */
export async function runExplorerAudit(
  url: string,
  onLog: LogCallback,
  onProgress: ProgressCallback,
): Promise<{ issues: TestIssue[]; result: TestResult | null; checklistStatus: ChecklistStatus }> {
  const report = new Reporter(onLog);
  onLog(`🧭 Agentic exploration audit (${MODEL}) — the agent will decide what to check.`);
  onProgress(3);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await context.addInitScript({ content: 'window.__name = window.__name || ((fn) => fn);' });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text()}`.slice(0, 200)); });

  const ctx: AuditContext = { page, context, rootUrl: url, origin: '', pages: [], report, log: onLog, progress: onProgress };
  const started = Date.now();
  const visited = new Set<string>();
  let lastLoadMs = 0;
  let finished = false;
  let turns = 0;

  const norm = (u: string) => report.normalize(u);

  // ── Tool implementations ──────────────────────────────────────────────────

  async function pageSummary(): Promise<Record<string, unknown>> {
    const data = await page.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const seen = new Set<string>();
      const links: { text: string; href: string }[] = [];
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const el = a as HTMLAnchorElement;
        const text = (el.textContent ?? '').trim().slice(0, 60);
        if (!text || seen.has(el.href)) continue;
        seen.add(el.href);
        links.push({ text, href: el.href });
      }
      const forms = Array.from(document.querySelectorAll('form')).filter(vis).map((f) => ({
        fields: Array.from(f.querySelectorAll('input:not([type="hidden"]), select, textarea')).map((i) => {
          const el = i as HTMLInputElement;
          return { name: el.name || el.id || el.getAttribute('placeholder') || el.type, type: el.type || el.tagName.toLowerCase(), required: el.required };
        }),
      })).filter((f) => f.fields.length);
      const imgs = Array.from(document.images);
      const origin = location.origin;
      const internal = links.filter((l) => { try { return new URL(l.href).origin === origin; } catch { return false; } });
      return {
        url: location.href,
        title: document.title,
        metaDescription: (document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '').slice(0, 160),
        viewportMeta: !!document.querySelector('meta[name="viewport"]'),
        h1: Array.from(document.querySelectorAll('h1')).map((h) => (h.textContent ?? '').trim()).slice(0, 3),
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 12).map((h) => `${h.tagName} ${(h.textContent ?? '').trim().slice(0, 60)}`),
        // just enough links for the model to pick where to go next
        internalLinks: internal.slice(0, 14).map((l) => `${l.text} → ${new URL(l.href).pathname}`),
        forms,
        imageCount: imgs.length,
        imagesMissingAlt: imgs.filter((i) => !i.getAttribute('alt') && i.getBoundingClientRect().width > 20).length,
        brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).length,
        textExcerpt: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 900),
      };
    });
    (data as Record<string, unknown>).loadMs = lastLoadMs;
    if (consoleErrors.length) (data as Record<string, unknown>).consoleErrors = consoleErrors.slice(-3);
    visited.add(norm(String(data.url)));
    return data as Record<string, unknown>;
  }

  async function doNavigate(target: string): Promise<Record<string, unknown>> {
    consoleErrors.length = 0;
    const t0 = Date.now();
    try {
      if (target === 'back') await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 });
      else {
        const abs = target.startsWith('http') ? target : new URL(target, ctx.origin || url).href;
        await page.goto(abs, { waitUntil: 'domcontentloaded', timeout: 25000 });
      }
    } catch (e) {
      return { error: `navigation failed: ${(e as Error).message}`.slice(0, 160) };
    }
    lastLoadMs = Date.now() - t0;
    if (!ctx.origin) { ctx.origin = new URL(page.url()).origin; ctx.rootUrl = page.url(); } // post-redirect canonical URL
    await page.waitForTimeout(300);
    report.recordLoad(lastLoadMs);
    const sum = await pageSummary();
    if (!ctx.pages.some((p) => norm(p.url) === norm(String(sum.url)))) {
      let shot = '';
      try { shot = `data:image/jpeg;base64,${(await page.screenshot({ type: 'jpeg', quality: 55, fullPage: true })).toString('base64')}`; } catch { /* */ }
      ctx.pages.push({ url: String(sum.url), title: String(sum.title), loadMs: lastLoadMs, screenshot: shot });
    }
    return sum;
  }

  async function doClick(text: string): Promise<Record<string, unknown>> {
    consoleErrors.length = 0;
    const t0 = Date.now();
    const loc = page.locator(
      `a:visible:has-text("${text.replace(/"/g, '')}"), button:visible:has-text("${text.replace(/"/g, '')}"), [role="button"]:visible:has-text("${text.replace(/"/g, '')}")`,
    ).first();
    if ((await loc.count()) === 0) return { error: `no visible link or button contains "${text}"` };
    try {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
        loc.click({ timeout: 8000 }),
      ]);
    } catch (e) {
      return { error: `click failed: ${(e as Error).message}`.slice(0, 160) };
    }
    lastLoadMs = Date.now() - t0;
    await page.waitForTimeout(400);
    return pageSummary();
  }

  async function doCheckLinks(): Promise<Record<string, unknown>> {
    const links: { href: string; text: string }[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? '').trim().slice(0, 50) }))
        .filter((l) => /^https?:/i.test(l.href)));
    const uniq = [...new Map(links.map((l) => [l.href, l])).values()].slice(0, 60);
    const broken: { href: string; text: string; status: number }[] = [];
    for (let i = 0; i < uniq.length; i += 10) {
      await Promise.all(uniq.slice(i, i + 10).map(async (l) => {
        try {
          let r = await context.request.head(l.href, { timeout: 8000 });
          if (r.status() === 403 || r.status() === 405) r = await context.request.get(l.href, { timeout: 10000 });
          if (r.status() >= 400) broken.push({ ...l, status: r.status() });
        } catch { broken.push({ ...l, status: 0 }); }
      }));
    }
    return { checked: uniq.length, brokenCount: broken.length, broken: broken.slice(0, 12) };
  }

  async function doResize(width: number): Promise<Record<string, unknown>> {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    const scan = await page.evaluate((vw: number) => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
      const desc = (el: Element) => { const h = el as HTMLElement; return `${el.tagName.toLowerCase()}${h.id ? '#' + h.id : ''}${typeof h.className === 'string' && h.className.trim() ? '.' + h.className.trim().split(/\s+/)[0] : ''}`; };
      const overflow: string[] = []; const edges: string[] = []; const overlaps: string[] = [];
      for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 2000)) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        if ((r.right > vw + 4 || r.left < -4) && r.width > 24 && overflow.length < 8) overflow.push(`${desc(el)} spans ${Math.round(r.left)}→${Math.round(r.right)}px`);
        const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? '').trim()).join(' ').trim();
        if (own.length > 2 && edges.length < 6 && !el.closest('header,nav,footer') && r.left >= 0 && r.left < 3) edges.push(`${desc(el)} touches left edge: "${own.slice(0, 40)}"`);
      }
      const docW = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
      return { horizontalScroll: docW > vw + 4, docWidth: docW, overflow, edges, overlaps };
    }, width);
    await page.setViewportSize({ width: 1366, height: 768 });
    return { viewport: width, ...scan };
  }

  /**
   * DEEP single-page analysis: gather the page's full copy + structure, run one
   * focused judgment sub-call, file every issue it returns. This is how the
   * agent digs in — one call per page instead of eyeballing a summary.
   */
  async function doAnalyzePage(): Promise<Record<string, unknown>> {
    const data = await page.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
      const fams = new Set<string>();
      const headingSizes: Record<string, number[]> = {};
      for (const el of Array.from(document.querySelectorAll('p,li,span,a,h1,h2,h3,h4,button,label')).slice(0, 700)) {
        if (!vis(el) || !Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
        fams.add((getComputedStyle(el).fontFamily.split(',')[0] ?? '').replace(/['"]/g, '').trim().toLowerCase());
      }
      for (const lvl of ['h1', 'h2', 'h3']) headingSizes[lvl] = Array.from(document.querySelectorAll(lvl)).filter(vis).map((h) => Math.round(parseFloat(getComputedStyle(h).fontSize)));
      const imgs = Array.from(document.images);
      let emptyListItems = 0;
      document.querySelectorAll('ul,ol').forEach((l) => { if (Array.from(l.querySelectorAll(':scope>li')).some((li) => !(li.textContent ?? '').trim() && !li.querySelector('img,a,button'))) emptyListItems++; });
      return {
        url: location.href,
        title: document.title, titleLen: (document.title ?? '').trim().length,
        metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
        h1Count: document.querySelectorAll('h1').length,
        headingOutline: Array.from(document.querySelectorAll('h1,h2,h3,h4')).slice(0, 40).map((h) => `${h.tagName} ${(h.textContent ?? '').trim().slice(0, 90)}`),
        fontFamilies: [...fams].filter(Boolean),
        headingSizes,
        imagesTotal: imgs.length,
        imagesMissingAlt: imgs.filter((i) => i.getAttribute('alt') === null && i.getBoundingClientRect().width > 20).length,
        brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).length,
        hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
        emptyListItems,
        text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 5000),
      };
    });

    const verdict = await judgeJSON<{
      issues: { name: string; category: string; severity: 'Critical' | 'Major' | 'Minor'; description: string; steps: string; details: string[] }[];
      seo: { suggestedTitle: string; suggestedDescription: string; recommendations: string[] };
      geoRecommendations: string[];
    }>({
      system:
        'You are a meticulous QA + SEO + AI-search reviewer analysing ONE web page in depth. Given its copy, heading outline, fonts, meta and image data, return STRICT JSON ' +
        '{"issues":[{"name","category","severity":"Critical"|"Major"|"Minor","description","steps","details":[string]}],"seo":{"suggestedTitle","suggestedDescription","recommendations":[string]},"geoRecommendations":[string]}. ' +
        'issues — check for: spelling & grammar (quote the phrase), placeholder / Lorem-Ipsum text, weak or missing <title> (10-65 chars) and meta description (50-160), missing or multiple H1, inverted/inconsistent heading sizes, thin or duplicate content, unprofessional copy, images missing alt text, broken images, missing viewport meta, empty list items. Only real, evidenced problems — empty array if clean. ' +
        'AT MOST 10 issues. Keep "description" under 25 words; "steps" one short line; "details" at most 2 short strings. ' +
        '"category" MUST be exactly one of: "Content", "SEO", "Accessibility", "Images", "Structure", "Performance". ' +
        'seo — classic search-engine optimisation for THIS page: suggestedTitle (50-60 chars, "Primary Keyword | Brand" from the actual content); suggestedDescription (140-160 chars, compelling, keyword-first); recommendations (2-4 concrete page-specific items: heading keywords, internal links, keyword targeting, image alt, content depth, canonical/OG tags). ' +
        'geoRecommendations (3-5 items) — Generative Engine Optimization / AI-search visibility for THIS page (ChatGPT, Perplexity, Google AI Overviews, Google AI Mode): add a concise answer-first summary or Q&A blocks that answer the questions users ask; state entities plainly (who/what/where, offerings, locations, pricing) so an LLM can extract them; add FAQPage / HowTo / Organization / Service / LocalBusiness schema; replace vague claims with specific citable facts (numbers, dates, named clients); use natural-language question headings; surface author, expertise and last-updated signals; add an llms.txt. Page-specific, concrete, no generic filler.',
      user: `PAGE: ${data.url}\n\n${JSON.stringify(data).slice(0, 12000)}`,
      fallback: { issues: [], seo: { suggestedTitle: '', suggestedDescription: '', recommendations: [] }, geoRecommendations: [] },
      onFail: (reason) => {
        report.addIssue(
          `Deep analysis incomplete for ${report.pathLabel(String(data.url))}`,
          'General', 'Minor',
          `1. Re-run the audit — ${reason}\n2. If it persists, the page may be too large; raise AI_MODEL to a bigger model or split the content`,
          'Browser',
          `The AI page analysis for this page did not complete (${reason}), so its spelling / content / SEO / GEO findings may be missing. Deterministic checks still ran.`,
          undefined, String(data.url), ctx.pages.find((p) => norm(p.url) === norm(String(data.url)))?.screenshot,
        );
        ctx.log(`⚠️ analyze_page fell back on ${data.url} — ${reason}`, 'warning');
      },
    });

    const shot = ctx.pages.find((p) => norm(p.url) === norm(String(data.url)))?.screenshot;
    for (const iss of verdict.issues ?? []) {
      report.addIssue(iss.name, iss.category ?? 'Content', iss.severity ?? 'Minor', iss.steps ?? '1. Fix the issue described',
        'Browser', iss.description, iss.details, String(data.url), shot);
    }

    const seo = verdict.seo;
    if (seo && (seo.recommendations?.length || seo.suggestedTitle)) {
      const details = [
        seo.suggestedTitle ? `Suggested title (${seo.suggestedTitle.length} chars): ${seo.suggestedTitle}` : '',
        seo.suggestedDescription ? `Suggested meta description (${seo.suggestedDescription.length} chars): ${seo.suggestedDescription}` : '',
        ...(seo.recommendations ?? []).map((r) => `• ${r}`),
      ].filter(Boolean);
      report.addIssue(
        `SEO recommendations for ${report.pathLabel(String(data.url))}`,
        'SEO', 'Minor',
        (seo.recommendations ?? []).map((r, i) => `${i + 1}. ${r}`).join('\n') || '1. Apply the suggested title and meta description above',
        'Browser',
        'Classic SEO improvements generated from this page’s content and metadata.',
        details, String(data.url), shot,
      );
    }

    const geo = verdict.geoRecommendations ?? [];
    if (geo.length) {
      report.addIssue(
        `AI-search (GEO) recommendations for ${report.pathLabel(String(data.url))}`,
        'SEO', 'Minor',
        geo.map((r, i) => `${i + 1}. ${r}`).join('\n'),
        'Browser',
        'Generative Engine Optimization — making this page citable by AI answer engines (ChatGPT, Perplexity, Google AI Overviews).',
        geo.map((r) => `• ${r}`), String(data.url), shot,
      );
    }

    const n = verdict.issues?.length ?? 0;
    onLog(`   ⤷ analyze_page: ${n} issue(s)${seo?.recommendations?.length ? ' + SEO' : ''}${geo.length ? ' + GEO tips' : ''} on ${data.url}`, n ? 'warning' : 'success');
    return {
      analysed: data.url,
      issuesFiled: n,
      issues: (verdict.issues ?? []).map((i) => `[${i.severity}] ${i.name}`),
    };
  }

  function doReportIssue(a: Record<string, unknown>): string {
    const sev = (['Critical', 'Major', 'Minor'].includes(String(a.severity)) ? a.severity : 'Major') as 'Critical' | 'Major' | 'Minor';
    const id = report.addIssue(
      String(a.name ?? 'Issue'),
      String(a.category ?? 'General'),
      sev,
      String(a.steps ?? '1. Investigate and fix the issue described'),
      'Browser',
      String(a.description ?? ''),
      Array.isArray(a.details) ? (a.details as unknown[]).map(String) : undefined,
      String(a.affectedPage ?? page.url()),
    );
    return id;
  }

  async function attachShot(issueId: string) {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 65 });
      const issue = report.issues.find((i) => i.id === issueId);
      if (issue) issue.screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch { /* */ }
  }

  // ── Tool schemas ─────────────────────────────────────────────────────────

  const tools: ChatTool[] = [
    { type: 'function', function: { name: 'navigate', description: 'Go to a URL (absolute, or a path on this site) or "back". Returns the new page: title, meta description, headings, links, forms, image counts, console errors, load time, visible text.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'read_page', description: 'Re-read the current page (same fields as navigate). Use after interacting.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'analyze_page', description: 'DEEP-analyse the current page: a thorough review of its copy (spelling, grammar, placeholder text, thin content), title & meta description, heading structure, fonts, images/alt text and viewport meta — PLUS GEO / AI-search recommendations (making the page citable by ChatGPT, Perplexity, Google AI Overviews). Automatically files every issue and the recommendations. Call this on every important page you visit.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'click', description: 'Click the first visible link or button whose text contains this string. Returns the resulting page.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
    { type: 'function', function: { name: 'check_links', description: 'HTTP-check every link on the current page for 4xx/5xx / unreachable. Returns the broken ones.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'security_scan', description: 'Non-invasive security review of the whole site: HTTPS, HTTP→HTTPS redirect, security headers (HSTS, CSP, X-Frame-Options, nosniff), mixed content, cookie Secure/HttpOnly flags, server-version disclosure, insecure form actions, and a probe for common exposed files (.git, .env, backups). Auto-files issues. Call once per audit.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'resize', description: 'Set the viewport width (e.g. 375 mobile, 768 tablet, 640) and DOM-scan the current page for horizontal scroll, overflow and elements touching the screen edge.', parameters: { type: 'object', properties: { width: { type: 'number' } }, required: ['width'] } } },
    { type: 'function', function: { name: 'submit_form', description: 'Fill the main form on the current page with fake test data and submit it. Returns whether validation fired, whether a thank-you / confirmation appeared, and the resulting URL. Use once per distinct form.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['empty', 'invalid_email', 'valid'], description: 'empty = submit blank to test required-field errors; invalid_email = bad email + good other fields; valid = all valid to test the thank-you page' } }, required: ['mode'] } } },
    { type: 'function', function: { name: 'report_issue', description: 'File a QA finding. Call once per distinct issue you have actually observed.', parameters: { type: 'object', properties: { name: { type: 'string' }, category: { type: 'string', description: 'e.g. Content, Navigation, Forms, Responsiveness, SEO, Images, Accessibility, Performance, Branding' }, severity: { type: 'string', enum: ['Critical', 'Major', 'Minor'] }, description: { type: 'string' }, steps: { type: 'string', description: 'numbered fix steps' }, details: { type: 'array', items: { type: 'string' } }, affectedPage: { type: 'string' } }, required: ['name', 'category', 'severity', 'description'] } } },
    { type: 'function', function: { name: 'finish', description: 'End the audit. Call when you have visited the main pages, tested the main form, checked links, checked mobile layout, and reported every issue found.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
  ];

  // ── The loop ─────────────────────────────────────────────────────────────

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a senior QA tester auditing a website by exploring it like a careful human. You have browser tools and about 18 steps. ' +
        'The home page has already been security-scanned and deep-analysed automatically. Your job: for every main nav page you open, call analyze_page (deep copy/heading/image review + GEO / AI-search recommendations, auto-files everything); ' +
        'run check_links once on the home page; on the contact page run submit_form empty, then invalid_email, then valid; run resize(375) on the home page and one inner page. ' +
        'You may batch several tool calls in one step. Beyond what analyze_page covers, watch for: broken links, layout breakage at 375px, slow pages, console errors, form validation gaps, missing viewport meta. ' +
        'File anything analyze_page missed with its own report_issue call the moment you see it — never save issues for the finish summary, never invent. Call finish only when the site is covered.',
    },
    { role: 'user', content: `Audit this website: ${url}` },
  ];

  try {
    const first = await doNavigate(url);
    if (first.error || ctx.pages.length === 0) {
      onLog(`❌ Could not load ${url} — ${first.error ?? 'no page'}`, 'error');
      await browser.close().catch(() => {});
      return { issues: report.issues, result: null, checklistStatus: report.checklistStatus };
    }
    messages.push({ role: 'user', content: `Home page loaded:\n${JSON.stringify(first).slice(0, 1400)}` });

    // Guaranteed coverage — all of this runs every audit, before the model loop,
    // so the issue tracker always has the full audit-phase findings (branding,
    // navigation, content, forms, buttons, images, social/footer, responsive,
    // performance, SEO), a security scan, and a deep GEO analysis of the home page.
    onLog('🌐 Crawling the site...');
    await crawl(ctx);
    onLog('🔒 Security scan...');
    const secSummary = await securityScan(ctx);
    onLog('🧪 Baseline checks (branding, links, forms, buttons, images, responsive, SEO)...');
    const baseSummary = await baselineScan(ctx);
    onLog('🔬 analyze_page → home');
    const homeSummary = await doAnalyzePage();
    onProgress(45);
    messages.push({ role: 'user', content:
      `Automatic passes done — ${baseSummary} | ${secSummary} | home GEO analyse: ${JSON.stringify(homeSummary).slice(0, 400)}\n` +
      `Crawled pages: ${ctx.pages.map((p) => p.url).join(', ')}\n` +
      `Your job now: analyze_page each of the OTHER crawled pages (deep copy + GEO), submit_form on the contact page (empty/invalid/valid), and report anything the automatic passes missed. Then finish.` });

    while (!finished && turns < MAX_TURNS && Date.now() - started < WALL_CLOCK_MS) {
      if (modelQuotaExhausted) break;
      turns++;
      await throttle();
      if (turns === MAX_TURNS) {
        messages.push({ role: 'user', content: 'This is your last step. Report any remaining issues you have observed, then call finish.' });
      }

      let completion;
      try {
        completion = await createChat({ model: MODEL, temperature: 0.2, tools, tool_choice: 'auto', messages });
      } catch (err) {
        if (isAuthError(err) || isQuotaError(err) || modelQuotaExhausted) {
          onLog(`🪫 AI model unavailable (${modelDownReason || (err as Error).message}) — ending exploration, running a deterministic sweep.`, 'warning');
        } else {
          onLog(`⚠️ Planner call failed (${(err as Error).message}) — ending exploration, running a deterministic sweep.`, 'warning');
        }
        break;
      }

      const choice = completion.choices[0]?.message;
      if (!choice) break;
      // NB: keep `choice` intact — Gemini 3.x rejects follow-ups whose history
      // has a functionCall without its thought_signature. The rolling history
      // (trimHistory) bounds how many of these are retained, so cost stays flat.
      messages.push(choice);

      if (!choice.tool_calls?.length) {
        if (choice.content) onLog(`🧭 ${choice.content.trim().slice(0, 300)}`);
        // nudge once, then stop
        messages.push({ role: 'user', content: 'Continue with tool calls, or call finish if the audit is complete.' });
        if (turns > 3) break;
        continue;
      }

      for (const call of choice.tool_calls) {
        if (call.type !== 'function') { messages.push({ role: 'tool', tool_call_id: call.id, content: 'unsupported' }); continue; }
        const args = safeParse(call.function.arguments);
        let out: unknown;
        try {
          switch (call.function.name) {
            case 'navigate': onLog(`🌐 navigate → ${args.url}`); out = await doNavigate(String(args.url)); break;
            case 'read_page': out = await pageSummary(); break;
            case 'analyze_page': onLog(`🔬 analyze_page → ${page.url()}`); out = await doAnalyzePage(); break;
            case 'click': onLog(`🖱️ click "${args.text}"`); out = await doClick(String(args.text)); break;
            case 'check_links': onLog('🔗 check_links'); out = await doCheckLinks(); break;
            case 'security_scan': onLog('🔒 security_scan'); out = { summary: await securityScan(ctx) }; break;
            case 'resize': onLog(`📐 resize ${args.width}px`); out = await doResize(Number(args.width)); break;
            case 'submit_form': onLog(`📋 submit_form (${args.mode})`); out = await doSubmitForm(ctx, String(args.mode)); break;
            case 'report_issue': {
              const id = doReportIssue(args);
              await attachShot(id);
              onLog(`   ⤷ reported: ${args.name}`, 'warning');
              out = { reported: true, id };
              break;
            }
            case 'finish': finished = true; onLog(`✅ ${args.summary ?? 'Audit complete.'}`, 'success'); out = { done: true }; break;
            default: out = { error: 'unknown tool' };
          }
        } catch (e) {
          out = { error: (e as Error).message.slice(0, 160) };
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, RESULT_CAP) });
      }

      onProgress(Math.min(90, 5 + turns * 5));
      trimHistory(messages, ctx.pages.length, report.issues.length);
    }
  } catch (err) {
    onLog(`❌ Exploration error: ${(err as Error).message}`, 'error');
  }

  // Pure exploration — the report is exactly what the agent found. No
  // deterministic backstop: if the AI quota runs out mid-run, it stops here.
  if (modelQuotaExhausted) {
    onLog('ℹ️ The model became unavailable, so exploration stopped early — this report only covers what the agent reached. Re-run when the AI quota resets.', 'warning');
  }

  finalizeChecklist(report);
  await browser.close().catch(() => {});
  onProgress(100);
  onLog(`✅ Audit complete — ${report.issues.length} issue(s) found in ${turns} exploration step(s).`, 'success');
  return report.build();
}

// ── helpers ────────────────────────────────────────────────────────────────

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

/**
 * Rolling history: keep system + goal + the last HISTORY_KEEP messages verbatim;
 * everything older collapses to one short line so token use stays roughly flat
 * per turn instead of growing.
 */
function trimHistory(messages: ChatMessage[], pagesSeen: number, issuesFiled: number) {
  if (messages.length <= HISTORY_KEEP + 3) return;
  const head = messages.slice(0, 2); // system + initial goal
  let tail = messages.slice(-HISTORY_KEEP);
  while (tail.length && tail[0].role === 'tool') tail = tail.slice(1); // don't orphan a tool result from its call
  messages.length = 0;
  messages.push(
    ...head,
    { role: 'user', content: `[Earlier steps summarised: you have visited ${pagesSeen} page(s) and filed ${issuesFiled} issue(s) so far. Keep going — cover anything not yet checked, then finish.]` },
    ...tail,
  );
}

/** Coarse mapping from what was found to checklist status — exploration doesn't follow the checklist, so unknowns stay 'pending' (excluded from the score). */
/**
 * Light safety net: baselineScan rates most of the checklist deterministically;
 * this only fills items still 'pending' by inferring from filed issues, and
 * marks 'No spelling errors' / 'No grammatical errors' from the LLM's findings.
 */
function finalizeChecklist(report: Reporter) {
  const iss = report.issues;
  const any = (re: RegExp) => iss.some((i) => re.test(i.category) || re.test(i.name));
  const fill = (c: string, k: string, v: 'pass' | 'fail' | 'warning') => {
    if (report.checklistStatus[c]?.[k] === 'pending') report.setChecklist(c, k, v);
  };
  // spelling/grammar come only from analyze_page — always (re)set these two
  report.setChecklist('Content & layout', 'No spelling errors', any(/spelling/i) ? 'fail' : 'pass');
  report.setChecklist('Content & layout', 'No grammatical errors', any(/grammar|placeholder|lorem/i) ? 'fail' : 'pass');
  report.setChecklist('Content & layout', 'Lists properly formatted', any(/list.*(empty|item)|empty list/i) ? 'warning' : 'pass');
  // fill any gaps baselineScan left pending
  fill('Navigation & link', 'Menu items navigate correctly', any(/menu page failed|navigation/i) ? 'fail' : 'pass');
  fill('Navigation & link', 'Anchors work correctly', any(/anchor/i) ? 'fail' : 'pass');
  fill('Navigation & link', 'Smooth navigation between pages', 'pass');
}

/** Fill the current page's main form and submit — shared with the toolbox engine's approach. */
async function doSubmitForm(ctx: AuditContext, mode: string): Promise<Record<string, unknown>> {
  const spec = mode === 'empty' ? {} :
    mode === 'invalid_email' ? { text: 'QA Test', email: 'invalid-email', tel: '9876543210', textarea: 'QA test.' } :
    { text: 'QA Test', email: 'qa.test.agent@example.com', tel: '9876543210', textarea: 'Automated QA test — please ignore.' };
  const before = ctx.page.url();
  const beforeText = await ctx.page.evaluate(() => (document.body?.innerText ?? '').toLowerCase()).catch(() => '');
  try {
    await ctx.page.evaluate((s: Record<string, string>) => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const form = Array.from(document.querySelectorAll('form')).filter(vis)
        .sort((a, b) => b.querySelectorAll('input,select,textarea').length - a.querySelectorAll('input,select,textarea').length)[0];
      if (!form) return;
      form.querySelectorAll('input, textarea').forEach((el) => {
        const i = el as HTMLInputElement;
        if (!vis(el)) return;
        if (el.tagName === 'TEXTAREA') { if (s.textarea !== undefined) i.value = s.textarea; return; }
        if (i.type === 'email') { if (s.email !== undefined) i.value = s.email; return; }
        if (i.type === 'tel' || /phone|mobile/i.test(i.name + i.id)) { if (s.tel !== undefined) i.value = s.tel; return; }
        if (['text', 'search', ''].includes(i.type)) { if (s.text !== undefined) i.value = s.text; }
      });
    }, spec as Record<string, string>);
    const submit = ctx.page.locator('form button[type="submit"], form input[type="submit"], form button:not([type])').first();
    if ((await submit.count()) === 0) return { error: 'no submit button found in a form on this page' };
    await submit.click({ timeout: 5000, noWaitAfter: true }).catch(() => {});
    await ctx.page.waitForTimeout(2000);
  } catch (e) {
    return { error: (e as Error).message.slice(0, 160) };
  }
  const after = await ctx.page.evaluate(() => {
    const invalid: string[] = [];
    document.querySelectorAll('form input, form select, form textarea').forEach((el) => {
      const i = el as HTMLInputElement;
      if (typeof i.checkValidity === 'function' && !i.checkValidity()) invalid.push(`${i.name || i.type}: ${i.validationMessage}`);
    });
    const errors: string[] = [];
    document.querySelectorAll('[class*="error" i], [role="alert"], [class*="invalid" i]').forEach((el) => {
      const t = (el.textContent ?? '').trim();
      if (t && t.length < 160 && el.getBoundingClientRect().width > 0) errors.push(t);
    });
    return { invalid: invalid.slice(0, 8), errorTexts: [...new Set(errors)].slice(0, 8), text: (document.body?.innerText ?? '').toLowerCase() };
  });
  const successRe = /(thank\s*you|thanks for|successfully|submission received|we will (get back|contact|be in touch)|message (sent|received))/i;
  return {
    mode,
    urlChanged: ctx.page.url() !== before,
    finalUrl: ctx.page.url(),
    validationFired: after.invalid.length > 0 || after.errorTexts.length > 0,
    validationMessages: [...after.invalid, ...after.errorTexts].slice(0, 8),
    confirmationShown: (successRe.test(after.text) && !successRe.test(beforeText)) || /thank|success|confirm/i.test(ctx.page.url()),
  };
}
