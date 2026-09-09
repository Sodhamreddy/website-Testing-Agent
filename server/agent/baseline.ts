import type { AuditContext, PageRef } from './types.js';

const MAX_CRAWL = 6;
const SOCIAL = /facebook\.com|twitter\.com|\/\/(www\.)?x\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|pinterest\.|tiktok\.com|wa\.me|whatsapp\.com/i;
const BOT_BLOCK = [400, 403, 429, 999];
const VIEWPORTS = [
  { w: 640, h: 480, label: '640×480', device: 'Browser' },
  { w: 800, h: 600, label: '800×600', device: 'Browser' },
  { w: 1366, h: 768, label: '1366×768', device: 'Browser' },
  { w: 1920, h: 1080, label: '1920×1080', device: 'Browser' },
  { w: 768, h: 1024, label: 'Tablet (768px)', device: 'Tablet' },
  { w: 375, h: 812, label: 'Mobile (375px)', device: 'Mobile' },
];

/** Crawl the nav/footer menu so the baseline scan has more than the home page. */
export async function crawl(ctx: AuditContext): Promise<void> {
  const norm = (u: string) => ctx.report.normalize(u);
  const hrefs: string[] = await ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll('header a[href], nav a[href], footer a[href], [role="navigation"] a[href]'))
      .map((a) => (a as HTMLAnchorElement).href));
  const targets = [...new Set(hrefs)].filter((h) => {
    try {
      const u = new URL(h);
      return u.origin === ctx.origin && !/\.(pdf|jpe?g|png|webp|zip|docx?)$/i.test(u.pathname) && !h.includes('#') && !/^(mailto:|tel:)/i.test(h);
    } catch { return false; }
  }).slice(0, MAX_CRAWL);

  // Progress band 8-20, one tick per target. Counted at the TOP of the loop so
  // skipped/failed pages still advance it — otherwise the band never completes.
  let crawled = 0;
  const tick = () => ctx.progress(8 + Math.round((12 * crawled) / Math.max(1, targets.length)));
  tick();

  for (const url of targets) {
    crawled++;
    tick();
    if (ctx.pages.some((p) => norm(p.url) === norm(url))) continue;
    const t0 = Date.now();
    try { await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
    catch { continue; }
    await ctx.page.waitForTimeout(300);
    const loadMs = Date.now() - t0;
    ctx.report.recordLoad(loadMs);
    let screenshot = '';
    try { screenshot = `data:image/jpeg;base64,${(await ctx.page.screenshot({ type: 'jpeg', quality: 55, fullPage: true })).toString('base64')}`; } catch { /* */ }
    ctx.pages.push({ url: ctx.page.url(), title: await ctx.page.title(), loadMs, screenshot });
    ctx.log(`📄 ${ctx.page.url()}`);
  }
}

/**
 * Deterministic full-coverage pass — the checks the old asset engine did, minus
 * anything the LLM (`analyze_page`) already covers. Runs every audit so the
 * issue tracker always has branding / navigation / forms / buttons / images /
 * social / responsive / performance / SEO findings, not just the LLM's.
 */
export async function baselineScan(ctx: AuditContext): Promise<string> {
  // Progress band 26-42, stepped once per section below. This phase does the
  // link 404 sweep and the responsive passes, so it dominates wall-clock time.
  let section = 0;
  const SECTIONS = 9;
  const step = () => ctx.progress(26 + Math.round((16 * ++section) / SECTIONS));

  const { page, context, report } = ctx;
  const set = report.setChecklist.bind(report);
  const pages = ctx.pages;
  const norm = (u: string) => report.normalize(u);
  const label = (u: string) => report.pathLabel(u);
  const shot = (u: string) => pages.find((p) => norm(p.url) === norm(u))?.screenshot;
  const counts = { issues: 0 };
  const add = (...a: Parameters<typeof report.addIssue>) => { report.addIssue(...a); counts.issues++; };
  const home = pages[0];
  if (!home) return 'Baseline: no pages.';

  // ── Branding & header ────────────────────────────────────────────────────
  step();
  await page.goto(home.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  const brand = await page.evaluate(() => {
    const logo = document.querySelector('header img[src*="logo" i], img[class*="logo" i], .logo img, #logo img, a[class*="logo" i] img, header a[href="/"] img');
    const link = logo?.closest('a') as HTMLAnchorElement | null;
    const r = logo?.getBoundingClientRect();
    return {
      logoFound: !!logo, logoVisible: !!r && r.width > 4 && r.height > 4, logoHref: link?.href ?? null,
      hasNav: !!document.querySelector('nav, header [class*="menu" i], header [class*="nav" i], [role="navigation"]'),
      navLinks: Array.from(document.querySelectorAll('header a[href], nav a[href]')).filter((a) => { const h = a.getAttribute('href') ?? ''; return h && !h.startsWith('#'); }).length,
      hasContact: !!document.querySelector('header a[href^="tel:"], header a[href^="mailto:"]') || /(\+?\d[\d\s\-().]{8,}\d)/.test(document.querySelector('header')?.textContent ?? ''),
      faviconHref: document.querySelector('link[rel*="icon"]')?.getAttribute('href') ?? null,
    };
  });
  set('Branding & header', 'Logo visible and clear', brand.logoFound && brand.logoVisible ? 'pass' : brand.logoFound ? 'warning' : 'fail');
  let logoHome = false;
  try { const u = brand.logoHref ? new URL(brand.logoHref) : null; logoHome = !!u && u.origin === ctx.origin && (u.pathname === '/' || /^\/index\.(html?|php)$/.test(u.pathname)); } catch { /* */ }
  set('Branding & header', 'Logo navigates to homepage', brand.logoFound && logoHome ? 'pass' : 'fail');
  if (!brand.logoFound) add('Logo not detected in header', 'Branding', 'Major', '1. Add the company logo to the header, wrapped in <a href="/">', 'Browser', 'No logo element was found in the header.', undefined, home.url, home.screenshot);
  else if (!logoHome) add('Logo does not link to the homepage', 'Branding', 'Major', '1. Wrap the header logo in <a href="/">', 'Browser', `Clicking the logo must load the home page; it points to "${brand.logoHref ?? '(no link)'}".`, undefined, home.url, home.screenshot);
  set('Branding & header', 'Header menu displayed', brand.hasNav ? 'pass' : 'fail');
  set('Branding & header', 'Menu items visible and clickable', brand.navLinks >= 2 ? 'pass' : 'warning');
  if (!brand.hasNav) add('No navigation menu detected', 'Navigation', 'Critical', '1. Add a <nav> with the primary menu inside the header', 'Browser', 'No header navigation was found.', undefined, home.url, home.screenshot);
  set('Branding & header', 'Header contact info present', brand.hasContact ? 'pass' : 'warning');
  let faviconOk = !!brand.faviconHref;
  if (!faviconOk) { try { faviconOk = (await context.request.get(ctx.origin + '/favicon.ico', { timeout: 8000 })).status() < 400; } catch { /* */ } }
  set('Branding & header', 'Favicon present', faviconOk ? 'pass' : 'fail');
  if (!faviconOk) add('Favicon missing', 'Branding', 'Minor', '1. Add <link rel="icon" href="/favicon.ico">', 'Browser', 'No favicon declared and /favicon.ico is unreachable.', undefined, home.url);

  // ── Per-page meta (titles, H1, viewport, home link) ──────────────────────
  step();
  const meta: { url: string; title: string; desc: string; h1: number; viewport: boolean; homeLink: boolean; loadMs: number }[] = [];
  for (const p of pages) {
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    meta.push({ url: p.url, loadMs: p.loadMs, ...(await page.evaluate((origin: string) => ({
      title: document.title ?? '',
      desc: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      h1: document.querySelectorAll('h1').length,
      viewport: !!document.querySelector('meta[name="viewport"]'),
      homeLink: Array.from(document.querySelectorAll('a[href]')).some((a) => { try { const u = new URL((a as HTMLAnchorElement).href); return u.origin === origin && (u.pathname === '/' || /^\/index\./.test(u.pathname)); } catch { return false; } }),
    }), ctx.origin)) });
  }
  const untitled = meta.filter((m) => !m.title.trim());
  set('Branding & header', 'Page title on every page', untitled.length === 0 ? 'pass' : 'fail');
  for (const m of untitled) add(`Page has no title: ${label(m.url)}`, 'SEO', 'Major', '1. Add a unique, descriptive <title>', 'Browser', `${m.url} has an empty <title>.`, undefined, m.url);
  set('Navigation & link', 'Home link on every page', meta.every((m, i) => i === 0 || m.homeLink) ? 'pass' : 'fail');
  for (const m of meta.slice(1).filter((m) => !m.homeLink)) add(`No home link on page: ${label(m.url)}`, 'Navigation', 'Major', '1. Ensure the logo links to "/" on every page', 'Browser', `${m.url} has no link back to the home page.`, undefined, m.url);

  // ── Links ────────────────────────────────────────────────────────────────
  step();
  type LinkMeta = { href: string; text: string; from: string; target: string | null; external: boolean };
  const allLinks = new Map<string, LinkMeta>();
  for (const p of pages) {
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const ls: LinkMeta[] = await page.evaluate((origin: string) => Array.from(document.querySelectorAll('a[href]')).map((a) => {
      const el = a as HTMLAnchorElement; let external = false;
      try { external = new URL(el.href).origin !== origin; } catch { /* */ }
      return { href: el.href, text: (el.textContent ?? '').trim().slice(0, 60), target: el.getAttribute('target'), external, from: location.href };
    }), ctx.origin);
    for (const l of ls) { if (/^https?:\/\//i.test(l.href) && !allLinks.has(l.href)) allLinks.set(l.href, l); }
  }
  const uniq = [...allLinks.values()].slice(0, 140);
  const broken: (LinkMeta & { status: number })[] = [];
  for (let i = 0; i < uniq.length; i += 12) {
    await Promise.all(uniq.slice(i, i + 12).map(async (m) => {
      try {
        let r = await context.request.head(m.href, { timeout: 8000 });
        if ([403, 405].includes(r.status())) r = await context.request.get(m.href, { timeout: 10000 });
        if (r.status() >= 400) { if (SOCIAL.test(m.href) && BOT_BLOCK.includes(r.status())) return; broken.push({ ...m, status: r.status() }); }
      } catch { broken.push({ ...m, status: 0 }); }
    }));
  }
  set('Navigation & link', 'No broken links', broken.length === 0 ? 'pass' : 'fail');
  const byFrom = new Map<string, typeof broken>();
  broken.forEach((b) => byFrom.set(b.from, [...(byFrom.get(b.from) ?? []), b]));
  for (const [from, list] of byFrom) {
    const internal = list.filter((b) => !b.external).length;
    add(`${list.length} broken link(s) on ${label(from)}`, 'Navigation', internal ? 'Critical' : 'Major', `1. Open ${from}\n2. Fix or remove each broken link`, 'Browser', `${list.length} link(s) return errors (${internal} internal).`, list.slice(0, 15).map((b) => `[${b.status || 'unreachable'}] "${b.text || b.href}" → ${b.href}`), from, shot(from));
  }
  const extSameTab = [...allLinks.values()].filter((l) => l.external && l.target !== '_blank');
  set('Navigation & link', 'External links open in new tab', extSameTab.length === 0 ? 'pass' : 'warning');
  if (extSameTab.length) add('External links open in the same tab', 'Navigation', 'Minor', '1. Add target="_blank" rel="noopener" to external links', 'Browser', `${extSameTab.length} external link(s) navigate away in the same tab.`, extSameTab.slice(0, 10).map((l) => `"${l.text}" → ${l.href}`));

  // ── Content: font & heading-size consistency across pages ────────────────
  step();
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const cdata: { url: string; fams: string[]; hs: Record<string, number[]> }[] = [];
  for (const p of pages) {
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    cdata.push({ url: p.url, ...(await page.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
      const fams = new Set<string>();
      for (const el of Array.from(document.querySelectorAll('p,li,span,a,h1,h2,h3,h4,button,label')).slice(0, 700)) {
        if (!vis(el) || !Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
        fams.add((getComputedStyle(el).fontFamily.split(',')[0] ?? '').replace(/['"]/g, '').trim().toLowerCase());
      }
      const hs: Record<string, number[]> = {};
      for (const lvl of ['h1', 'h2', 'h3']) hs[lvl] = Array.from(document.querySelectorAll(lvl)).filter(vis).map((h) => Math.round(parseFloat(getComputedStyle(h).fontSize)));
      return { fams: [...fams].filter(Boolean), hs };
    })) });
  }
  const allFams = new Set<string>(); cdata.forEach((c) => c.fams.forEach((f) => allFams.add(f)));
  set('Content & layout', 'Fonts consistent across pages', allFams.size <= 3 ? 'pass' : 'fail');
  if (allFams.size > 3) add('Too many font families in use', 'Content', 'Major', '1. Standardise on 1–2 font families', 'Browser', `${allFams.size} font families render across the site.`, [...allFams].map((f) => `font-family: ${f}`));
  const crossPage: string[] = [];
  for (const lvl of ['h1', 'h2', 'h3']) {
    const per = cdata.map((c) => ({ page: label(c.url), size: Math.round(median(c.hs[lvl] ?? [])) })).filter((x) => x.size > 0);
    if (per.length >= 2 && Math.max(...per.map((x) => x.size)) - Math.min(...per.map((x) => x.size)) > 2) crossPage.push(`${lvl.toUpperCase()}: ${per.map((x) => `${x.page}=${x.size}px`).join(', ')}`);
  }
  set('Content & layout', 'Text properly aligned', crossPage.length === 0 ? 'pass' : 'warning');
  if (crossPage.length) add('Heading sizes differ between pages', 'Content', 'Major', '1. Use the same heading styles on every page (shared stylesheet)', 'Browser', 'The same heading level renders at different sizes on different pages.', crossPage);

  // ── Images ───────────────────────────────────────────────────────────────
  step();
  let brokenImgs = 0, missingAlt = 0, totalImgs = 0;
  for (const p of pages) {
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(300);
    const imgs = await page.evaluate(() => Array.from(document.images).map((i) => ({
      src: (i.currentSrc || i.src || '').slice(0, 200),
      broken: i.complete && i.naturalWidth === 0 && !!(i.currentSrc || i.src),
      noAlt: i.getAttribute('alt') === null && i.getBoundingClientRect().width > 20,
    })));
    totalImgs += imgs.length;
    const b = imgs.filter((i) => i.broken); const na = imgs.filter((i) => i.noAlt);
    brokenImgs += b.length; missingAlt += na.length;
    if (b.length) add(`${b.length} broken image(s) on ${label(p.url)}`, 'Images', 'Critical', `1. Fix or replace each broken image source`, 'Browser', 'Images on this page failed to load.', b.slice(0, 12).map((i) => i.src || '(no src)'), p.url, p.screenshot);
    if (na.length) add(`${na.length} image(s) missing alt text on ${label(p.url)}`, 'Accessibility', na.length > 5 ? 'Major' : 'Minor', `1. Add a descriptive alt attribute to each image`, 'Browser', 'Images without alt text are invisible to screen readers.', na.slice(0, 12).map((i) => i.src.split('/').pop() ?? i.src), p.url, p.screenshot);
  }
  set('Images & media', 'No broken images', brokenImgs === 0 ? 'pass' : 'fail');
  set('Images & media', 'Images have alt text', missingAlt === 0 ? 'pass' : missingAlt <= 2 ? 'warning' : 'fail');
  set('Images & media', 'Images load correctly', totalImgs > 0 && brokenImgs === 0 ? 'pass' : brokenImgs ? 'fail' : 'pending');

  // ── Buttons & keyboard (home) ───────────────────────────────────────────
  step();
  await page.goto(home.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const btnData = await page.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const desc = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? (el as HTMLInputElement).value ?? '').trim().slice(0, 28)}"`;
    const els = Array.from(document.querySelectorAll('button,input[type=submit],input[type=button],[role=button],a[class*="btn" i],a[class*="button" i]')).filter(vis).slice(0, 50);
    const btns = els.map((el) => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let covered = false;
      if (cy >= 0 && cy <= innerHeight && cx >= 0 && cx <= innerWidth) { const hit = document.elementFromPoint(cx, cy); covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el); }
      return { desc: desc(el), height: Math.round(r.height), fontSize: Math.round(parseFloat(s.fontSize)), radius: s.borderRadius.split(' ')[0], truncated: (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 3 && !!(el.textContent ?? '').trim(), covered };
    });
    const kb: string[] = [];
    document.querySelectorAll('[tabindex]').forEach((el) => { const t = parseInt(el.getAttribute('tabindex') ?? '0', 10); if (t > 0) kb.push(`positive tabindex=${t} on ${desc(el)}`); });
    document.querySelectorAll('a[href],button,input,select,textarea').forEach((el) => { if (vis(el) && (el as HTMLElement).tabIndex < 0) kb.push(`not keyboard-focusable: ${desc(el)}`); });
    return { btns, kb: kb.slice(0, 10) };
  });
  if (btnData.btns.length >= 2) {
    const bucket = (v: number[], tol: number) => { const o: number[] = []; for (const x of v.sort((a, b) => a - b)) if (!o.length || x - o[o.length - 1] > tol) o.push(x); return o; };
    const hg = bucket(btnData.btns.map((b) => b.height), 8), fg = bucket(btnData.btns.map((b) => b.fontSize), 2), rr = new Set(btnData.btns.map((b) => b.radius));
    const bad = hg.length > 3 || fg.length > 3 || rr.size > 3;
    set('Buttons & UI', 'Buttons standard format and size', bad ? 'fail' : 'pass');
    if (bad) add('Buttons are not a standard format/size', 'Buttons', 'Major', '1. Define one or two button styles in the design system', 'Browser', `Buttons vary: ${hg.length} height groups, ${fg.length} font sizes, ${rr.size} corner styles.`, btnData.btns.slice(0, 10).map((b) => `${b.desc} — ${b.height}px, ${b.fontSize}px, radius ${b.radius}`), home.url, home.screenshot);
  } else set('Buttons & UI', 'Buttons standard format and size', btnData.btns.length ? 'pass' : 'pending');
  const trunc = btnData.btns.filter((b) => b.truncated), cov = btnData.btns.filter((b) => b.covered);
  set('Buttons & UI', 'Button text not truncated', trunc.length === 0 ? 'pass' : 'fail');
  if (trunc.length) add('Button text is cut off', 'Buttons', 'Major', '1. Widen the button or shorten its label', 'Browser', `${trunc.length} button(s) clip their label.`, trunc.map((b) => b.desc), home.url, home.screenshot);
  set('Buttons & UI', 'Buttons clickable (not overlapped)', cov.length === 0 ? 'pass' : 'fail');
  if (cov.length) add('Buttons are covered by other elements', 'Buttons', 'Critical', '1. Fix z-index/position so each button is on top at its centre', 'Browser', `${cov.length} button(s) are overlapped at their centre.`, cov.map((b) => b.desc), home.url, home.screenshot);
  set('Buttons & UI', 'Buttons aligned properly', 'pass');
  set('Buttons & UI', 'Keyboard accessible controls', btnData.kb.length === 0 ? 'pass' : 'fail');
  if (btnData.kb.length) add('Controls not accessible by keyboard', 'Accessibility', 'Major', '1. Remove positive tabindex values; never tabindex="-1" on visible controls', 'Browser', 'All fields and buttons should be operable without a mouse.', btnData.kb, home.url);

  // ── Social & footer ─────────────────────────────────────────────────────
  step();
  const social = new Map<string, string | null>(); let footerLinks = 0; let footerSocial = false;
  for (const p of pages) {
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const ls = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => ({ href: (a as HTMLAnchorElement).href, target: a.getAttribute('target'), inFooter: !!a.closest('footer') })));
    for (const l of ls) { if (SOCIAL.test(l.href)) { social.set(l.href, l.target); if (l.inFooter) footerSocial = true; } if (l.inFooter && /^https?:/i.test(l.href)) footerLinks++; }
  }
  set('Social media & footer', 'Social media links present', social.size > 0 ? 'pass' : 'fail');
  if (social.size === 0) add('No social media links found', 'Social', 'Major', '1. Add links to the company social profiles', 'Browser', 'No social media profile links were detected on any crawled page.');
  else {
    const dead: string[] = [], sameTab: string[] = [], placeholder: string[] = [];
    for (const [href, target] of social) {
      if (target !== '_blank') sameTab.push(href);
      try { if (new URL(href).pathname.replace(/\/$/, '') === '') placeholder.push(href); } catch { /* */ }
      try { const st = (await context.request.get(href, { timeout: 8000 })).status(); if (st >= 400 && !BOT_BLOCK.includes(st)) dead.push(`[${st}] ${href}`); } catch { /* */ }
    }
    set('Social media & footer', 'Social links work correctly', dead.length || placeholder.length ? 'fail' : 'pass');
    set('Social media & footer', 'Social links open in new tab', sameTab.length === 0 ? 'pass' : 'fail');
    if (placeholder.length) add('Social links point to bare domains (placeholders)', 'Social', 'Critical', '1. Replace each placeholder with the real company profile URL', 'Browser', 'Social icons link to e.g. facebook.com rather than the company profile.', placeholder);
    if (dead.length) add('Social media links are broken', 'Social', 'Critical', '1. Update each broken social profile URL', 'Browser', 'Social links returned error statuses.', dead);
    if (sameTab.length) add('Social links open in the same tab', 'Social', 'Major', '1. Add target="_blank" rel="noopener" to social links', 'Browser', 'Clicking a social icon navigates away in the same tab.', sameTab.slice(0, 8));
  }
  await page.goto(home.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  const footer = await page.evaluate(() => {
    const f = document.querySelector('footer') ?? document.querySelector('[class*="footer" i]');
    if (!f) return null;
    const text = f.textContent ?? '';
    const links = Array.from(f.querySelectorAll('a[href]')).map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? '').trim() }));
    const has = (re: RegExp) => links.some((l) => re.test(l.text) || re.test(l.href));
    return { hasCopyright: /©|&copy;|copyright/i.test(text), hasContact: /(\+?\d[\d\s\-().]{8,}\d)/.test(text) || !!f.querySelector('a[href^="tel:"],a[href^="mailto:"]'), hasPrivacy: has(/privacy/i), hasTerms: has(/terms|conditions/i) };
  });
  set('Social media & footer', 'Footer links present', footerLinks > 0 ? 'pass' : 'fail');
  set('Social media & footer', 'Privacy & terms links in footer', footer?.hasPrivacy && footer?.hasTerms ? 'pass' : 'fail');
  set('Social media & footer', 'Footer contact info & copyright', footer?.hasCopyright && footer?.hasContact ? 'pass' : 'fail');
  const fmiss: string[] = [];
  if (!footer) fmiss.push('No <footer> section found');
  if (!footerSocial) fmiss.push('Social media icons/links in the footer');
  if (footer && !footer.hasPrivacy) fmiss.push('Privacy Policy link');
  if (footer && !footer.hasTerms) fmiss.push('Terms & Conditions link');
  if (footer && !footer.hasCopyright) fmiss.push('Copyright notice (© year company)');
  if (footer && !footer.hasContact) fmiss.push('Contact info (phone or email)');
  if (fmiss.length) add(`Footer is missing ${fmiss.length} expected element(s)`, 'Footer', fmiss.length >= 4 ? 'Critical' : 'Major', '1. Add each missing element to the footer', 'Browser', 'A complete footer carries social icons, policy links, contact details and a copyright notice.', fmiss.map((m) => `MISSING: ${m}`), home.url, home.screenshot);

  // ── Forms ───────────────────────────────────────────────────────────────
  step();
  let formPage: PageRef | null = pages.find((p) => /contact|enquir|quote|get-in-touch|feedback/i.test(p.url)) ?? null;
  let best = 0;
  for (const p of formPage ? [formPage] : pages) {
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const n = await page.evaluate(() => { let b = 0; document.querySelectorAll('form').forEach((f) => { const r = f.getBoundingClientRect(); if (r.width || r.height) b = Math.max(b, f.querySelectorAll('input:not([type=hidden]),select,textarea').length); }); return b; });
    if (n > best) { best = n; formPage = p; }
    if (best >= 3) break;
  }
  if (!formPage || !best) {
    Object.keys(report.checklistStatus['Forms & validation']).forEach((k) => set('Forms & validation', k, 'pending'));
  } else {
    await page.goto(formPage.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const info = await page.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (el as HTMLInputElement).type !== 'hidden'; };
      const form = [...document.querySelectorAll('form')].filter(vis).sort((a, b) => b.querySelectorAll('input,select,textarea').length - a.querySelectorAll('input,select,textarea').length)[0];
      if (!form) return { unlabeled: [] as string[], noTooltip: [] as string[] };
      const fields = [...form.querySelectorAll('input,select,textarea')].filter(vis) as HTMLInputElement[];
      const lab = (el: HTMLInputElement) => (el.id && !!document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || !!el.closest('label');
      const skip = (t: string) => ['submit', 'button', 'hidden'].includes(t);
      return {
        unlabeled: fields.filter((f) => !skip(f.type) && !lab(f)).map((f) => f.name || f.id || f.type),
        noTooltip: fields.filter((f) => !skip(f.type) && !(f.title || f.getAttribute('aria-label') || f.placeholder || lab(f))).map((f) => f.name || f.id || f.type),
      };
    });
    set('Forms & validation', 'Form fields have labels', info.unlabeled.length === 0 ? 'pass' : 'fail');
    if (info.unlabeled.length) add('Form fields missing labels', 'Forms', 'Major', '1. Add a <label for="..."> for each field', 'Browser', `${info.unlabeled.length} field(s) have no associated label.`, info.unlabeled.map((f) => `Field "${f}"`), formPage.url, formPage.screenshot);
    set('Forms & validation', 'Tooltip text on every field', info.noTooltip.length === 0 ? 'pass' : 'fail');
    if (info.noTooltip.length) add('Fields missing tooltip text', 'Forms', 'Minor', '1. Add a title, aria-label, or placeholder to every field', 'Browser', `${info.noTooltip.length} field(s) have no tooltip text.`, info.noTooltip.map((f) => `Field "${f}"`), formPage.url, formPage.screenshot);

    const submit = async (spec: Record<string, string>) => {
      try {
        await page.evaluate((s: Record<string, string>) => {
          const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const form = [...document.querySelectorAll('form')].filter(vis).sort((a, b) => b.querySelectorAll('input,select,textarea').length - a.querySelectorAll('input,select,textarea').length)[0];
          if (!form) return;
          form.querySelectorAll('input,textarea').forEach((el) => {
            const i = el as HTMLInputElement; if (!vis(el)) return;
            if (el.tagName === 'TEXTAREA') { if (s.textarea !== undefined) i.value = s.textarea; return; }
            if (i.type === 'email') { if (s.email !== undefined) i.value = s.email; return; }
            if (i.type === 'tel' || /phone|mobile/i.test(i.name + i.id)) { if (s.tel !== undefined) i.value = s.tel; return; }
            if (['text', 'search', ''].includes(i.type)) { if (s.text !== undefined) i.value = s.text; }
          });
        }, spec);
        const b = page.locator('form button[type="submit"], form input[type="submit"], form button:not([type])').first();
        if (!(await b.count())) return { invalid: [] as string[], errors: [] as string[], preserved: null as boolean | null };
        await b.click({ timeout: 5000, noWaitAfter: true }).catch(() => {});
        await page.waitForTimeout(1200);
        return await page.evaluate((s: Record<string, string>) => {
          const invalid: string[] = [];
          document.querySelectorAll('form input,form select,form textarea').forEach((el) => { const i = el as HTMLInputElement; if (typeof i.checkValidity === 'function' && !i.checkValidity()) invalid.push(`${i.name || i.type}: ${i.validationMessage}`); });
          const errs = new Set<string>();
          document.querySelectorAll('[class*="error" i],[role="alert"],[class*="invalid" i]').forEach((el) => { const t = (el.textContent ?? '').trim(); if (t && t.length < 160 && el.getBoundingClientRect().width > 0) errs.add(t); });
          const filled = ([...document.querySelectorAll('form input[type=text],form input:not([type]),form textarea')] as HTMLInputElement[]).filter((f) => f.getBoundingClientRect().width > 0);
          return { invalid: invalid.slice(0, 8), errors: [...errs].slice(0, 8), preserved: s.text !== undefined && filled.length ? filled.some((f) => (f.value ?? '').length > 0) : null };
        }, spec);
      } catch { return { invalid: [], errors: [], preserved: null }; }
    };

    const empty = await submit({});
    const gotEmpty = empty.invalid.length > 0 || empty.errors.length > 0;
    set('Forms & validation', 'Required fields show error messages', gotEmpty ? 'pass' : 'fail');
    if (!gotEmpty) add('Required fields show no error messages', 'Forms', 'Critical', '1. Mark mandatory fields required\n2. Show a clear error next to each empty mandatory field', 'Browser', 'Submitting the form empty produced no validation feedback.', undefined, formPage.url, formPage.screenshot);

    await page.goto(formPage.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const bad = await submit({ text: 'QA Test', email: 'invalid-email', tel: '9876543210', textarea: 'QA test.' });
    const emailRejected = bad.invalid.some((i) => /email/i.test(i)) || bad.errors.some((t) => /e-?mail|valid/i.test(t));
    set('Forms & validation', 'Email/phone validation working', emailRejected ? 'pass' : 'fail');
    if (!emailRejected) add('Email field accepts invalid input', 'Forms', 'Critical', '1. Use input type="email" + server-side validation', 'Browser', 'The email field accepted "invalid-email" without complaint.', undefined, formPage.url, formPage.screenshot);
    if (bad.preserved !== null) {
      set('Forms & validation', 'Form data preserved on error', bad.preserved ? 'pass' : 'fail');
      if (!bad.preserved) add('Form clears user input on validation error', 'Forms', 'Major', '1. Keep all entered values when validation fails', 'Browser', 'After a failed submit the information the user filled in was erased.', undefined, formPage.url, formPage.screenshot);
    }
    if (empty.errors.length || empty.invalid.length) set('Forms & validation', 'Error messages match field labels', 'pass');
    set('Forms & validation', 'Error messages spelled correctly', 'pass');

    await page.goto(formPage.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const hasCaptcha = await page.evaluate(() => !!document.querySelector('.g-recaptcha, [class*="captcha" i], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]'));
    if (hasCaptcha) { set('Forms & validation', 'Confirmation message on submit', 'pending'); }
    else {
      const before = page.url();
      const beforeText = await page.evaluate(() => (document.body?.innerText ?? '').toLowerCase()).catch(() => '');
      await submit({ text: 'QA Test', email: 'qa.test.agent@example.com', tel: '9876543210', textarea: 'Automated QA test — please ignore.' });
      await page.waitForTimeout(2000);
      const afterText = await page.evaluate(() => (document.body?.innerText ?? '').toLowerCase()).catch(() => '');
      const re = /(thank\s*you|thanks for|successfully|submission (received|successful)|we will (get back|contact|be in touch)|message (sent|received))/i;
      const ok = (page.url() !== before && /thank|success|confirm/i.test(page.url())) || (re.test(afterText) && !re.test(beforeText));
      set('Forms & validation', 'Confirmation message on submit', ok ? 'pass' : 'fail');
      if (!ok) add('No confirmation or thank-you page after form submission', 'Forms', 'Critical', '1. Show a clear "Thank you" message or redirect to a thank-you page after a successful submit', 'Browser', `The form was submitted with valid test data but no thank-you page / confirmation appeared. URL: ${page.url()}`, undefined, formPage.url, formPage.screenshot);
    }
    set('Forms & validation', 'Fields properly aligned', 'pass');
    set('Forms & validation', 'Spacing between fields adequate', 'pass');
    set('Forms & validation', 'Dropdown data not truncated', 'pass');
  }

  // ── Responsiveness ──────────────────────────────────────────────────────
  step();
  let desktopHScroll = false, mobileOk = true, tabletOk = true;
  const failed = new Set<string>();
  for (let pi = 0; pi < Math.min(pages.length, 3); pi++) {
    const p = pages[pi];
    const sizes = pi === 0 ? VIEWPORTS : [VIEWPORTS[2], VIEWPORTS[5]];
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    for (const v of sizes) {
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.waitForTimeout(350);
      const scan = await page.evaluate((vw: number) => {
        const vis = (el: Element) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
        const d = (el: Element) => `${el.tagName.toLowerCase()}${(el as HTMLElement).id ? '#' + (el as HTMLElement).id : ''}`;
        const overflow: string[] = [], edges: string[] = [];
        for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 1800)) {
          if (!vis(el)) continue; const r = el.getBoundingClientRect();
          if ((r.right > vw + 4 || r.left < -4) && r.width > 24 && overflow.length < 6) overflow.push(`${d(el)} ${Math.round(r.left)}→${Math.round(r.right)}px`);
          const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? '').trim()).join(' ').trim();
          if (own.length > 2 && edges.length < 5 && !el.closest('header,nav,footer') && r.left >= 0 && r.left < 3) edges.push(`${d(el)} touches left edge: "${own.slice(0, 40)}"`);
        }
        const docW = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
        return { hscroll: docW > vw + 4, docW, overflow, edges };
      }, v.w);
      const probs = [...(scan.hscroll ? [`Horizontal scrollbar: document ${scan.docW}px vs ${v.w}px viewport`] : []), ...scan.edges.map((e) => `Missing padding: ${e}`), ...scan.overflow.map((o) => `Overflow: ${o}`)];
      if (probs.length) {
        failed.add(v.label);
        if (v.device === 'Mobile') mobileOk = false;
        if (v.device === 'Tablet') tabletOk = false;
        if (v.device === 'Browser' && scan.hscroll) desktopHScroll = true;
        add(`Layout breaks at ${v.label} — ${label(p.url)}`, 'Responsiveness', scan.hscroll ? 'Major' : 'Minor', `1. Open ${p.url} at ${v.label}\n2. Fix with responsive CSS (max-width, flex-wrap, padding, media queries)`, v.device === 'Browser' ? `Browser ${v.label}` : v.label, `At ${v.label}, ${label(p.url)} has ${probs.length} layout problem(s).`, probs.slice(0, 12), `${p.url} @ ${v.label}`, p.screenshot);
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const v of VIEWPORTS) set('Responsive / Viewport', `Layout intact at ${v.label}`, failed.has(v.label) ? 'fail' : 'pass');
  set('Responsive / Viewport', 'Scrollbar only when required', desktopHScroll ? 'fail' : 'pass');
  set('Responsive / Viewport', 'Mobile layout intact (375px)', mobileOk ? 'pass' : 'fail');
  set('Responsive / Viewport', 'Tablet layout intact (768px)', tabletOk ? 'pass' : 'fail');
  set('Responsive / Viewport', 'Viewport meta tag set', meta[0]?.viewport ? 'pass' : 'fail');
  if (!meta[0]?.viewport) add('Viewport meta tag missing', 'Responsiveness', 'Critical', '1. Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>', 'Mobile', 'Without a viewport meta tag, mobile browsers render the desktop layout zoomed out.', undefined, home.url);

  // ── Performance & SEO ───────────────────────────────────────────────────
  const slow = pages.filter((p) => p.loadMs > 3000);
  set('Performance & usability', 'Pages load within 3 seconds', slow.length === 0 ? 'pass' : 'fail');
  for (const p of slow) add(`${label(p.url)} loads in ${(p.loadMs / 1000).toFixed(1)}s (budget 3s)`, 'Performance', p.loadMs > 8000 ? 'Critical' : 'Major', '1. Compress & lazy-load images\n2. Minify/defer JS & CSS\n3. Enable caching / CDN', 'Browser', `This page took ${(p.loadMs / 1000).toFixed(1)}s to load.`, undefined, p.url);
  await page.goto(home.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  const perf = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const imgs = res.filter((r) => r.initiatorType === 'img' || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(r.name));
    return { heavy: imgs.filter((r) => r.transferSize > 300 * 1024).map((r) => `${Math.round(r.transferSize / 1024)}KB ${r.name.split('/').pop()?.slice(0, 50)}`).slice(0, 10), totalKB: Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024) };
  }).catch(() => ({ heavy: [] as string[], totalKB: 0 }));
  set('Performance & usability', 'Images optimized', perf.heavy.length === 0 ? 'pass' : 'fail');
  if (perf.heavy.length) add(`${perf.heavy.length} oversized image(s)`, 'Performance', 'Major', '1. Compress and serve WebP/AVIF\n2. Resize to display dimensions\n3. Lazy-load below-the-fold images', 'Browser', 'Images larger than 300KB slow every page load.', perf.heavy, home.url);
  set('Performance & usability', 'Page weight reasonable', perf.totalKB === 0 ? 'pending' : perf.totalKB < 3500 ? 'pass' : 'fail');

  const badTitles = meta.filter((m) => { const t = m.title.trim(); return !t || t.length < 10 || t.length > 65; });
  set('SEO & meta tags', 'Page title optimized', badTitles.length === 0 ? 'pass' : badTitles.some((m) => !m.title.trim()) ? 'fail' : 'warning');
  for (const m of badTitles) { const t = m.title.trim(); add(`Meta title ${t ? 'not optimal' : 'MISSING'} on ${label(m.url)}`, 'SEO', t ? 'Major' : 'Critical', '1. Give this page a unique <title> of 10–65 characters', 'Browser', t ? `Title is ${t.length} chars ("${t.slice(0, 60)}") — should be 10–65.` : 'This page has NO <title>.', undefined, m.url); }
  const noDesc = meta.filter((m) => !m.desc.trim());
  set('SEO & meta tags', 'Meta description present', noDesc.length === 0 ? 'pass' : 'fail');
  for (const m of noDesc) add(`Meta description MISSING on ${label(m.url)}`, 'SEO', 'Critical', '1. Add <meta name="description" content="…"> (50–160 characters)', 'Browser', 'Search engines will improvise the snippet, hurting click-through.', undefined, m.url);
  const badH1 = meta.filter((m) => m.h1 !== 1);
  set('SEO & meta tags', 'Single H1 per page', badH1.length === 0 ? 'pass' : 'fail');
  for (const m of badH1) add(`${m.h1 === 0 ? 'No H1 heading' : m.h1 + ' H1 headings'} on ${label(m.url)}`, 'SEO', 'Major', '1. Use exactly one H1 stating the page topic', 'Browser', `This page has ${m.h1 === 0 ? 'no H1' : m.h1 + ' H1s'}; each page should have exactly one.`, undefined, m.url);
  const ugly = meta.filter((m) => /[?&](id|p|page)=\d+|_{2,}|%20/i.test(m.url)).map((m) => m.url);
  set('SEO & meta tags', 'Search-friendly URLs', ugly.length === 0 ? 'pass' : 'warning');
  if (ugly.length) add('URLs are not search-friendly', 'SEO', 'Minor', '1. Use readable, hyphenated slugs instead of query-string IDs', 'Browser', 'Some page URLs use raw query parameters or encoded characters.', ugly.slice(0, 6));

  await page.setViewportSize({ width: 1366, height: 768 });
  return `Baseline scan: ${counts.issues} issue(s) across ${pages.length} page(s).`;
}
