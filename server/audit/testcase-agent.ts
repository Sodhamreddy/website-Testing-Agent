import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { TestIssue, TestResult, ChecklistStatus } from '../../src/types/index.js';

type LogType = 'info' | 'success' | 'warning' | 'error';
type LogCallback = (msg: string, type?: LogType) => void;
type ProgressCallback = (pct: number) => void;

/** Screen resolutions the manual QA checklist requires (640x480, 800x600, etc.). */
const RESOLUTIONS = [
  { width: 640,  height: 480,  label: '640×480',          device: 'Browser' },
  { width: 800,  height: 600,  label: '800×600',          device: 'Browser' },
  { width: 1366, height: 768,  label: '1366×768',         device: 'Browser' },
  { width: 1920, height: 1080, label: '1920×1080',        device: 'Browser' },
  { width: 768,  height: 1024, label: 'Tablet (768px)',   device: 'Tablet' },
  { width: 375,  height: 812,  label: 'Mobile (375px)',   device: 'Mobile' },
];

const MAX_CRAWL_PAGES = 6;
const LOAD_BUDGET_MS = 3000;

/** Common misspellings dictionary: wrong → correct. */
const MISSPELLINGS: Record<string, string> = {
  recieve: 'receive', recieved: 'received', recieving: 'receiving',
  seperate: 'separate', seperated: 'separated', seperately: 'separately',
  definately: 'definitely', occured: 'occurred', occurence: 'occurrence',
  accomodate: 'accommodate', acheive: 'achieve', beleive: 'believe',
  belive: 'believe', calender: 'calendar', collegue: 'colleague',
  comming: 'coming', commited: 'committed', concious: 'conscious',
  embarass: 'embarrass', enviroment: 'environment', existance: 'existence',
  familar: 'familiar', finaly: 'finally', foriegn: 'foreign',
  freind: 'friend', futher: 'further', goverment: 'government',
  gaurd: 'guard', happend: 'happened', harrass: 'harass',
  immediatly: 'immediately', independant: 'independent', intrest: 'interest',
  knowlege: 'knowledge', libary: 'library', lisence: 'license',
  maintainance: 'maintenance', managment: 'management', neccessary: 'necessary',
  necesary: 'necessary', noticable: 'noticeable', occassion: 'occasion',
  oppurtunity: 'opportunity', paralell: 'parallel', persistant: 'persistent',
  posession: 'possession', prefered: 'preferred', privelege: 'privilege',
  probaly: 'probably', proffesional: 'professional', publically: 'publicly',
  realy: 'really', recomend: 'recommend', refered: 'referred',
  relevent: 'relevant', remeber: 'remember', succesful: 'successful',
  sucess: 'success', sucessful: 'successful', suprise: 'surprise',
  tommorow: 'tomorrow', tommorrow: 'tomorrow', tounge: 'tongue',
  truely: 'truly', unfortunatly: 'unfortunately', untill: 'until',
  wierd: 'weird', wich: 'which', writting: 'writing',
  becuase: 'because', beggining: 'beginning', buisness: 'business',
  diffrent: 'different', excellant: 'excellent', exprience: 'experience',
  garantee: 'guarantee', gratefull: 'grateful', hieght: 'height',
  lenght: 'length', mispell: 'misspell', responsability: 'responsibility',
  rythm: 'rhythm', scedule: 'schedule', secratary: 'secretary',
  similiar: 'similar', speach: 'speech', strenght: 'strength',
  teh: 'the', thier: 'their', vaccum: 'vacuum', vegtable: 'vegetable',
  visable: 'visible', adress: 'address', amature: 'amateur',
  apparant: 'apparent', arguement: 'argument', basicly: 'basically',
  begining: 'beginning', alot: 'a lot', equipments: 'equipment',
  informations: 'information', feedbacks: 'feedback',
};

/** Repeated-word pairs that are legitimate English and must not be flagged. */
const LEGIT_DOUBLES = new Set(['had', 'that', 'is', 'do', 'very', 'so', 'no', 'can', 'will', 'may', 'ha', 'bye']);

const SOCIAL_DOMAINS = /facebook\.com|twitter\.com|\/\/(www\.)?x\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|pinterest\.|tiktok\.com|wa\.me|whatsapp\.com/i;

/** Social platforms answer bots with these statuses — not proof the link is broken. */
const BOT_BLOCK_STATUSES = [400, 403, 429, 999];

interface PageData {
  url: string;
  status: number;
  loadMs: number;
  title: string;
  text: string;
  links: { href: string; raw: string; text: string; target: string | null; inNav: boolean; inFooter: boolean }[];
  images: { src: string; alt: string | null; broken: boolean; width: number; height: number }[];
  fontFamilies: string[];
  headingSizes: Record<string, number[]>;
  bodyFontSizes: number[];
  hasHomeLink: boolean;
  hasNav: boolean;
  h1Count: number;
  h1Text: string;
  metaDescription: string;
  hasViewportMeta: boolean;
  faviconHref: string | null;
  listCount: number;
  badLists: string[];
  mixedAlignBlocks: string[];
}

/**
 * Deterministic website QA agent — NO LLM involved.
 *
 * Executes the manual-QA test-case scenarios (spelling/grammar, font and
 * alignment consistency, tooltips, button standards, logo→home, social links,
 * broken links/images, multi-resolution layout, load time, form validation,
 * keyboard access, dropdown truncation, page titles…) as concrete Playwright
 * checks across the home page and crawled internal pages, then emits the same
 * TestIssue[] / ChecklistStatus / TestResult contract the frontend consumes.
 */
export class TestCaseAuditAgent {
  private url: string;
  private origin = '';
  private onLog: LogCallback;
  private onProgress: ProgressCallback;
  private issues: TestIssue[] = [];
  private issueCounter = 1;
  public checklistStatus: ChecklistStatus = {};
  public foundData: { title?: string; h1?: string; description?: string } = {};
  private screenshotUrl = '';
  private browser!: Browser;
  private context!: BrowserContext;
  private page!: Page;
  private pages: PageData[] = [];
  /** Canonical desktop screenshot per crawled page (normalized URL → data URL). */
  private pageShots = new Map<string, string>();
  /**
   * Per-issue elements to highlight in the final marked-evidence pass. Each entry
   * names the issue, its page, and the images/links/text that locate the problem.
   * The pass scrolls the element into view, outlines it, and captures a FOCUSED
   * viewport screenshot (not full page) so the evidence shows just the problem.
   */
  private pendingMarks: { id: string; pageUrl: string; imgs: string[]; links: string[]; texts: string[]; selectors: string[] }[] = [];

  constructor(url: string, onLog: LogCallback, onProgress: ProgressCallback) {
    this.url = url;
    this.onLog = onLog;
    this.onProgress = onProgress;
  }

  async runFullAudit(): Promise<{
    issues: TestIssue[];
    result: TestResult | null;
    checklistStatus: ChecklistStatus;
  }> {
    this.issues = [];
    this.issueCounter = 1;
    this.checklistStatus = this.initChecklist();

    this.log('🧪 Starting deterministic QA audit (no LLM) for: ' + this.url);
    this.onProgress(3);

    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    // tsx/esbuild rewrites functions passed to page.evaluate with a __name()
    // helper that doesn't exist inside the browser — provide a no-op shim.
    await this.context.addInitScript({
      content: 'window.__name = window.__name || ((fn) => fn);',
    });
    this.page = await this.context.newPage();

    try {
      const home = await this.visitAndCollect(this.url);
      if (!home) {
        this.log('❌ Could not load the website — aborting audit.', 'error');
        return { issues: this.issues, result: null, checklistStatus: this.checklistStatus };
      }
      this.origin = new URL(this.page.url()).origin;
      // Use the FINAL (post-redirect) URL as the canonical site URL. If the
      // entered URL redirects (http→https, adding www), issues defaulting to
      // this.url must still match the crawled pages' keys — otherwise every
      // site-wide issue is labelled with one URL while its screenshot resolves
      // against another.
      this.url = home.url;
      this.foundData = {
        title: home.title,
        h1: home.h1Text,
        description: home.metaDescription,
      };
      await this.captureScreenshot(false);
      this.onProgress(10);

      this.log('🏷️ Branding & header checks...');
      await this.runBrandingChecks(home);
      this.onProgress(16);

      this.log('🌐 Crawling internal pages from the menu...');
      await this.crawlInternalPages(home);
      this.onProgress(34);

      this.log('🔗 Validating every link (broken links, redirects, anchors)...');
      await this.runLinkChecks();
      this.onProgress(48);

      this.log('📝 Analyzing content: spelling, grammar, fonts, alignment...');
      await this.runContentChecks();
      this.onProgress(58);

      this.log('📋 Testing forms: labels, tooltips, validation, error messages...');
      await this.runFormChecks();
      this.onProgress(68);

      this.log('🖱️ Checking buttons, keyboard access and dropdowns...');
      await this.runButtonAndKeyboardChecks();
      this.onProgress(74);

      this.log('🖼️ Verifying images & media...');
      this.runImageChecks();
      this.onProgress(78);

      this.log('📱 Testing social media & footer links...');
      await this.runSocialFooterChecks();
      this.onProgress(82);

      this.log('🖥️ Testing layout at multiple resolutions (640×480 → 1920×1080, tablet, mobile)...');
      await this.runResolutionChecks();
      this.onProgress(93);

      this.log('⚡ Performance & SEO fundamentals...');
      await this.runPerformanceSeoChecks(home);
      this.onProgress(95);

      this.log('🖍️ Marking evidence screenshots (images, links, text)...');
      this.backfillMarksByCategory();
      await this.applyIssueMarks();
      this.onProgress(98);
    } catch (err) {
      this.log('❌ Audit error: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      await this.browser.close().catch(() => {});
    }

    this.onProgress(100);
    this.log(`✅ Audit complete — ${this.issues.length} issue(s) found.`, 'success');

    return {
      issues: this.issues,
      result: this.buildResult(),
      checklistStatus: this.checklistStatus,
    };
  }

  // ─── Page visiting & data collection ───────────────────────────────────────

  private async visitAndCollect(url: string): Promise<PageData | null> {
    const started = Date.now();
    let status = 0;
    try {
      let response = null;
      try {
        response = await this.page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
      } catch {
        response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      }
      status = response?.status() ?? 0;
    } catch (err) {
      this.log(`⚠️ Failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`, 'warning');
      return null;
    }
    const loadMs = Date.now() - started;
    await this.page.waitForTimeout(300);
    // Scroll the whole page so lazy-loaded images/sections actually render
    // before we analyse the DOM and capture the evidence screenshot. Without
    // this, below-the-fold content is missing from both the analysis and the shot.
    await this.autoScroll();

    const data = await this.page.evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden';
      };

      const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        raw: a.getAttribute('href') ?? '',
        text: (a.textContent ?? '').trim().slice(0, 80),
        target: a.getAttribute('target'),
        inNav: !!a.closest('header, nav, [role="navigation"]'),
        inFooter: !!a.closest('footer'),
      }));

      const images = Array.from(document.images).map((img) => ({
        src: (img.currentSrc || img.src || '').slice(0, 300),
        alt: img.getAttribute('alt'),
        broken: img.complete && img.naturalWidth === 0 && !!(img.currentSrc || img.src),
        width: Math.round(img.getBoundingClientRect().width),
        height: Math.round(img.getBoundingClientRect().height),
      }));

      // Fonts actually used by visible text
      const families = new Set<string>();
      const bodyFontSizes: number[] = [];
      const sample = Array.from(document.querySelectorAll('p, li, span, a, h1, h2, h3, h4, button, label, td')).slice(0, 800);
      for (const el of sample) {
        if (!visible(el)) continue;
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
        if (!hasText) continue;
        const s = getComputedStyle(el);
        const fam = (s.fontFamily.split(',')[0] ?? '').replace(/['"]/g, '').trim().toLowerCase();
        if (fam) families.add(fam);
        if (el.tagName === 'P' || el.tagName === 'LI') bodyFontSizes.push(parseFloat(s.fontSize));
      }

      const headingSizes: Record<string, number[]> = {};
      for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        headingSizes[level] = Array.from(document.querySelectorAll(level))
          .filter(visible)
          .map((h) => parseFloat(getComputedStyle(h).fontSize));
      }

      // Lists with formatting problems: empty items or list markers stripped while semantically a list
      const badLists: string[] = [];
      Array.from(document.querySelectorAll('ul, ol')).slice(0, 100).forEach((l) => {
        const items = Array.from(l.querySelectorAll(':scope > li'));
        if (items.some((li) => !(li.textContent ?? '').trim() && !li.querySelector('img, a, button'))) {
          badLists.push(l.tagName.toLowerCase() + (l.id ? `#${l.id}` : '') + ' has empty list items');
        }
      });

      // Sibling paragraphs whose text-align differs → inconsistent alignment
      const mixedAlignBlocks: string[] = [];
      const containers = new Set<Element>();
      document.querySelectorAll('p').forEach((p) => { if (p.parentElement) containers.add(p.parentElement); });
      Array.from(containers).slice(0, 150).forEach((c) => {
        const ps = Array.from(c.querySelectorAll(':scope > p')).filter(visible);
        if (ps.length < 2) return;
        const aligns = new Set(ps.map((p) => getComputedStyle(p).textAlign));
        if (aligns.size > 1) {
          const id = c.id ? `#${c.id}` : c.className && typeof c.className === 'string' ? '.' + c.className.split(/\s+/)[0] : c.tagName.toLowerCase();
          mixedAlignBlocks.push(`${id} mixes alignments: ${Array.from(aligns).join(', ')}`);
        }
      });

      const origin = location.origin;
      const hasHomeLink = links.some((l) => {
        try {
          const u = new URL(l.href);
          return u.origin === origin && (u.pathname === '/' || /^\/index\.(html?|php)$/.test(u.pathname)) && !u.hash;
        } catch { return false; }
      });

      return {
        title: document.title ?? '',
        text: (document.body?.innerText ?? '').slice(0, 60000),
        links,
        images,
        fontFamilies: Array.from(families),
        headingSizes,
        bodyFontSizes,
        hasHomeLink,
        hasNav: !!document.querySelector('nav, header [class*="menu"], header [class*="nav"], [role="navigation"]'),
        h1Count: document.querySelectorAll('h1').length,
        h1Text: (document.querySelector('h1')?.textContent ?? '').trim().slice(0, 150),
        metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
        hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
        faviconHref: document.querySelector('link[rel*="icon"]')?.getAttribute('href') ?? null,
        listCount: document.querySelectorAll('ul, ol').length,
        badLists: badLists.slice(0, 5),
        mixedAlignBlocks: mixedAlignBlocks.slice(0, 5),
      };
    });

    const pageData: PageData = { url: this.page.url(), status, loadMs, ...data };
    this.pages.push(pageData);
    return pageData;
  }

  /**
   * Scroll from top to bottom in steps so lazy-loaded images and sections load,
   * then return to the top. Keeps total time bounded for very long pages.
   */
  private async autoScroll(): Promise<void> {
    try {
      await this.page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          const step = Math.max(300, window.innerHeight * 0.8);
          let y = 0;
          const maxScrolls = 40; // safety cap for extremely long pages
          let n = 0;
          const timer = setInterval(() => {
            window.scrollTo(0, y);
            y += step;
            n++;
            if (y >= document.body.scrollHeight || n >= maxScrolls) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              resolve();
            }
          }, 120);
        });
      });
      // Give freshly-triggered images a moment to decode, then settle at top.
      await this.page.waitForTimeout(500);
      await this.page.evaluate(() => window.scrollTo(0, 0));
    } catch { /* non-fatal */ }
  }

  /**
   * Capture a FULL-PAGE screenshot (entire scrollable page, not just the
   * viewport) so evidence shows the whole page — header to footer — and the
   * actual location of issues that sit below the fold.
   */
  private async captureScreenshot(fullPage = true): Promise<string> {
    try {
      const buf = await this.page.screenshot({ type: 'jpeg', quality: 60, fullPage });
      this.screenshotUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      // Keep the FIRST (desktop, during-crawl) full-page screenshot as each
      // page's canonical evidence; viewport-specific shots are passed per issue.
      const key = this.normalize(this.page.url());
      if (!this.pageShots.has(key)) this.pageShots.set(key, this.screenshotUrl);
    } catch { /* keep previous */ }
    return this.screenshotUrl;
  }

  // ─── Branding & header ───────────────────────────────────────────────────────

  private async runBrandingChecks(home: PageData) {
    // Logo present + links to home (test case: "Home page should load if user clicks on Company logo")
    const logo = await this.page.evaluate(() => {
      const el = document.querySelector(
        'header img[src*="logo" i], img[class*="logo" i], img[id*="logo" i], .logo img, #logo img, a[class*="logo" i] img, header a[href="/"] img',
      );
      if (!el) return { found: false, href: null as string | null, visible: false };
      const r = el.getBoundingClientRect();
      const link = el.closest('a');
      return {
        found: true,
        visible: r.width > 4 && r.height > 4,
        href: link ? (link as HTMLAnchorElement).href : null,
      };
    });

    if (!logo.found) {
      this.setChecklist('Branding & header', 'Logo visible and clear', 'fail');
      this.addIssue('Logo not detected', 'Branding', 'Major',
        '1. Add the company logo to the header\n2. Use class="logo" or descriptive alt text\n3. Wrap it in <a href="/">',
        'Browser', 'No logo element was found in the header using conventional selectors. Brand recognition and home navigation suffer.',
        undefined, `${this.url} › Header`);
      this.setChecklist('Branding & header', 'Logo navigates to homepage', 'fail');
    } else {
      this.setChecklist('Branding & header', 'Logo visible and clear', logo.visible ? 'pass' : 'warning');
      const goesHome = !!logo.href && (() => {
        try { const u = new URL(logo.href!); return u.origin === this.origin && (u.pathname === '/' || /^\/index\.(html?|php)$/.test(u.pathname)); }
        catch { return false; }
      })();
      this.setChecklist('Branding & header', 'Logo navigates to homepage', goesHome ? 'pass' : 'fail');
      if (!goesHome) {
        const id = this.addIssue('Logo does not link to the homepage', 'Branding', 'Major',
          '1. Wrap the header logo in <a href="/">\n2. Verify clicking the logo from every page returns to the home page',
          'Browser', `Clicking the company logo must load the home page. The logo link points to "${logo.href ?? '(no link)'}" instead of the homepage.`,
          undefined, `${this.url} › Header`);
        this.registerMarks(id, this.url, { selectors: ['header img[src*="logo" i]', 'img[class*="logo" i]', '.logo img', 'header a img'] });
      } else {
        this.log('✅ Logo links to homepage.', 'success');
      }
    }

    // Header/nav present
    this.setChecklist('Branding & header', 'Header menu displayed', home.hasNav ? 'pass' : 'fail');
    if (!home.hasNav) {
      this.addIssue('No navigation menu detected', 'Navigation', 'Critical',
        '1. Add a <nav> element with the primary menu inside the header',
        'Browser', 'No header navigation menu was found. Users cannot move between site sections.',
        undefined, `${this.url} › Header`);
    }

    const navLinks = home.links.filter((l) => l.inNav && l.raw && !l.raw.startsWith('#'));
    this.setChecklist('Branding & header', 'Menu items visible and clickable', navLinks.length >= 2 ? 'pass' : 'warning');

    // Header contact info (phone/email)
    const hasContact = home.links.some((l) => l.inNav && /^(tel:|mailto:)/i.test(l.raw)) ||
      /(\+?\d[\d\s\-().]{8,}\d)/.test(home.text.slice(0, 1500));
    this.setChecklist('Branding & header', 'Header contact info present', hasContact ? 'pass' : 'warning');

    // Favicon
    let faviconOk = !!home.faviconHref;
    if (!faviconOk) {
      try {
        const resp = await this.context.request.get(this.origin + '/favicon.ico', { timeout: 8000 });
        faviconOk = resp.status() < 400;
      } catch { faviconOk = false; }
    }
    this.setChecklist('Branding & header', 'Favicon present', faviconOk ? 'pass' : 'fail');
    if (!faviconOk) {
      this.addIssue('Favicon missing', 'Branding', 'Minor',
        '1. Add <link rel="icon" href="/favicon.ico">\n2. Provide PNG/SVG variants for high-DPI displays',
        'Browser', 'No favicon was declared and /favicon.ico is not reachable. The browser tab shows a blank icon.',
        undefined, this.url);
    }

    // Title on home page (per-page titles re-checked during crawl)
    if (!home.title.trim()) {
      this.setChecklist('Branding & header', 'Page title on every page', 'fail');
      this.addIssue('Home page has no title', 'SEO', 'Critical',
        '1. Add a descriptive <title> tag in the <head>',
        'Browser', 'document.title is empty on the home page. Titles must display on every web page (browser tab, bookmarks, search results).',
        undefined, this.url);
    }
  }

  // ─── Crawl internal pages ────────────────────────────────────────────────────

  private async crawlInternalPages(home: PageData) {
    const seen = new Set([this.normalize(this.page.url())]);
    const targets: { href: string; text: string }[] = [];

    for (const l of home.links) {
      if (targets.length >= MAX_CRAWL_PAGES) break;
      if (!l.inNav && !l.inFooter) continue;
      try {
        const u = new URL(l.href);
        if (u.origin !== this.origin) continue;
        if (/\.(pdf|jpg|jpeg|png|webp|zip|doc|docx)$/i.test(u.pathname)) continue;
        if (/^(mailto:|tel:|javascript:)/i.test(l.raw) || l.raw.startsWith('#')) continue;
        const key = this.normalize(l.href);
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ href: l.href, text: l.text || u.pathname });
      } catch { /* invalid URL */ }
    }

    let navigationOk = true;
    let slowPages = 0;
    const titles = new Map<string, string[]>([[home.title.trim(), [home.url]]]);

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      this.log(`🌐 Visiting menu page: ${t.text || t.href}`);
      const data = await this.visitAndCollect(t.href);
      this.onProgress(16 + Math.round(((i + 1) / Math.max(1, targets.length)) * 16));
      if (!data || data.status >= 400) {
        navigationOk = false;
        this.addIssue(`Menu page failed to load: ${t.text}`, 'Navigation', 'Critical',
          `1. Open ${t.href} and verify it returns HTTP 200\n2. Fix the route or remove the menu item`,
          'Browser', `The menu item "${t.text}" leads to ${t.href}, which ${data ? `returned HTTP ${data.status}` : 'did not load'}. Users cannot navigate smoothly between pages.`,
          undefined, t.href);
        continue;
      }

      // Title should display on each web page
      if (!data.title.trim()) {
        this.addIssue(`Page has no title: ${t.text}`, 'SEO', 'Major',
          '1. Add a unique, descriptive <title> tag to this page',
          'Browser', `${data.url} has an empty <title>. Every page must display a title.`,
          undefined, data.url);
      } else {
        const list = titles.get(data.title.trim()) ?? [];
        list.push(data.url);
        titles.set(data.title.trim(), list);
      }

      // Home page link should be there on every single page
      if (!data.hasHomeLink) {
        this.addIssue(`No home link on page: ${t.text}`, 'Navigation', 'Major',
          '1. Ensure the logo links to "/" on every page\n2. Or add a "Home" item to the menu',
          'Browser', `${data.url} has no link back to the home page. A home link (logo or menu) must exist on every single page.`,
          undefined, data.url);
      }

      if (data.loadMs > LOAD_BUDGET_MS) slowPages++;
      await this.captureScreenshot(false);
    }

    const allTitled = this.pages.every((p) => p.title.trim());
    this.setChecklist('Branding & header', 'Page title on every page', allTitled ? 'pass' : 'fail');

    const allHome = this.pages.every((p) => p.hasHomeLink || this.normalize(p.url) === this.normalize(this.pages[0].url));
    this.setChecklist('Navigation & link', 'Home link on every page', allHome ? 'pass' : 'fail');

    const dupTitles = Array.from(titles.entries()).filter(([title, urls]) => title && urls.length > 1);
    if (dupTitles.length) {
      this.addIssue('Duplicate page titles', 'SEO', 'Minor',
        '1. Give each page a unique <title> describing its content',
        'Browser', `${dupTitles.length} title(s) are reused across multiple pages, e.g. "${dupTitles[0][0]}".`,
        dupTitles.slice(0, 5).map(([title, urls]) => `"${title}" used by: ${urls.join(', ')}`));
    }

    this.setChecklist('Navigation & link', 'Menu items navigate correctly', navigationOk ? 'pass' : 'fail');
    this.setChecklist('Navigation & link', 'Smooth navigation between pages', navigationOk && slowPages === 0 ? 'pass' : slowPages ? 'warning' : 'fail');
    this.log(`✅ Crawled ${this.pages.length} page(s).`, 'success');
  }

  // ─── Links: broken links, anchors, external target ──────────────────────────

  private async runLinkChecks() {
    const all = new Map<string, { text: string; from: string }>();
    for (const p of this.pages) {
      for (const l of p.links) {
        if (!/^https?:\/\//i.test(l.href)) continue;
        if (!all.has(l.href)) all.set(l.href, { text: l.text, from: p.url });
      }
    }
    const urls = Array.from(all.keys()).slice(0, 120);
    this.log(`🔗 Checking ${urls.length} unique link(s)...`);

    const broken: { url: string; status: number; text: string; from: string }[] = [];
    const redirectedToHome: { url: string; finalUrl: string; text: string }[] = [];
    const CONCURRENCY = 10;

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      await Promise.all(urls.slice(i, i + CONCURRENCY).map(async (href) => {
        const meta = all.get(href)!;
        try {
          let resp = await this.context.request.head(href, { timeout: 8000, maxRedirects: 0 });
          let status = resp.status();
          if (status === 405 || status === 403) {
            resp = await this.context.request.get(href, { timeout: 10000, maxRedirects: 0 });
            status = resp.status();
          }
          if (status >= 300 && status < 400) {
            const final = await this.context.request.get(href, { timeout: 10000 });
            if (final.status() >= 400) {
              broken.push({ url: href, status: final.status(), ...meta });
            } else {
              try {
                const fu = new URL(final.url());
                const ou = new URL(href);
                // Internal link silently landing on the homepage = navigation bug
                if (ou.origin === this.origin && ou.pathname !== '/' && fu.pathname === '/' ) {
                  redirectedToHome.push({ url: href, finalUrl: final.url(), text: meta.text });
                }
              } catch { /* ignore */ }
            }
          } else if (status >= 400) {
            // Social/bot-protected domains often refuse bots — don't report as broken
            if (SOCIAL_DOMAINS.test(href) && BOT_BLOCK_STATUSES.includes(status)) return;
            broken.push({ url: href, status, ...meta });
          }
        } catch (err) {
          broken.push({ url: href, status: 0, ...meta });
        }
      }));
    }

    this.setChecklist('Navigation & link', 'No broken links', broken.length === 0 ? 'pass' : 'fail');
    if (broken.length) {
      // Report broken links PER PAGE (the page where the link appears)
      const byFrom = new Map<string, typeof broken>();
      broken.forEach((b) => byFrom.set(b.from, [...(byFrom.get(b.from) ?? []), b]));
      for (const [from, list] of byFrom) {
        const internalHere = list.filter((b) => { try { return new URL(b.url).origin === this.origin; } catch { return false; } });
        const id = this.addIssue(`${list.length} broken link(s) on ${this.pathLabel(from)}`, 'Navigation', internalHere.length ? 'Critical' : 'Major',
          `1. Open ${from}\n2. Fix or remove each broken link listed in the details\n3. Set up 301 redirects for moved pages`,
          'Browser', `This page contains ${list.length} link(s) that return errors or are unreachable (${internalHere.length} internal). Broken links frustrate users and hurt SEO.`,
          list.slice(0, 15).map((b) => `[${b.status || 'unreachable'}] "${b.text || b.url}" → ${b.url}`),
          from);
        this.registerMarks(id, from, { links: list.map((b) => b.url) });
      }
      this.log(`🔗 ${broken.length} broken link(s) across ${byFrom.size} page(s).`, 'warning');
    } else {
      this.log('✅ No broken links.', 'success');
    }

    if (redirectedToHome.length) {
      this.addIssue('Internal links silently redirect to the homepage', 'Navigation', 'Major',
        '1. Update each link to its real destination\n2. Remove redirects that mask missing pages',
        'Browser', `${redirectedToHome.length} internal link(s) redirect to the homepage instead of their labelled destination.`,
        redirectedToHome.slice(0, 10).map((r) => `"${r.text}" (${r.url}) → ${r.finalUrl}`));
    }

    // External links should open in a new tab
    const extNoBlank: { href: string; text: string }[] = [];
    for (const p of this.pages) {
      for (const l of p.links) {
        try {
          const u = new URL(l.href);
          if (u.origin !== this.origin && /^https?:/.test(u.protocol) && l.target !== '_blank') {
            if (!extNoBlank.some((e) => e.href === l.href)) extNoBlank.push({ href: l.href, text: l.text });
          }
        } catch { /* ignore */ }
      }
    }
    this.setChecklist('Navigation & link', 'External links open in new tab', extNoBlank.length === 0 ? 'pass' : 'warning');
    if (extNoBlank.length) {
      this.addIssue('External links open in the same tab', 'Navigation', 'Minor',
        '1. Add target="_blank" rel="noopener" to external links',
        'Browser', `${extNoBlank.length} external link(s) navigate away in the same tab, taking visitors off the site.`,
        extNoBlank.slice(0, 10).map((e) => `"${e.text}" → ${e.href}`));
    }

    // In-page anchors must point at existing targets
    const badAnchors = await this.page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('a[href^="#"]').forEach((a) => {
        const id = (a.getAttribute('href') ?? '').slice(1);
        if (!id) return; // href="#" used as JS hook — skip
        if (!document.getElementById(id) && !document.querySelector(`[name="${CSS.escape(id)}"]`)) {
          out.push(`#${id} ("${(a.textContent ?? '').trim().slice(0, 40)}")`);
        }
      });
      return out.slice(0, 10);
    });
    this.setChecklist('Navigation & link', 'Anchors work correctly', badAnchors.length === 0 ? 'pass' : 'fail');
    if (badAnchors.length) {
      this.addIssue('Anchor links point to missing sections', 'Navigation', 'Major',
        '1. Add the missing id attributes or fix the anchor hrefs',
        'Browser', `${badAnchors.length} in-page anchor link(s) reference IDs that do not exist, so clicking them does nothing.`,
        badAnchors);
    }
  }

  // ─── Content: spelling, grammar, fonts, alignment ────────────────────────────

  private async runContentChecks() {
    // Spelling & grammar across every crawled page
    const spelling: { word: string; correct: string; page: string; context: string }[] = [];
    const doubles: { pair: string; page: string; context: string }[] = [];
    let loremFound: string | null = null;

    for (const p of this.pages) {
      const text = p.text;
      if (/lorem ipsum/i.test(text) && !loremFound) loremFound = p.url;

      const words = text.toLowerCase().match(/[a-z]{2,}/g) ?? [];
      const seenHere = new Set<string>();
      for (const w of words) {
        if (MISSPELLINGS[w] && !seenHere.has(w)) {
          seenHere.add(w);
          const idx = text.toLowerCase().indexOf(w);
          spelling.push({
            word: w, correct: MISSPELLINGS[w], page: p.url,
            context: text.slice(Math.max(0, idx - 30), idx + w.length + 30).replace(/\s+/g, ' ').trim(),
          });
        }
      }

      const dblRe = /\b([a-z]{3,})\s+\1\b/gi;
      let m: RegExpExecArray | null;
      while ((m = dblRe.exec(text)) !== null && doubles.length < 10) {
        if (!LEGIT_DOUBLES.has(m[1].toLowerCase())) {
          // Capture the sentence around the match so the tester can find it on the page
          const start = Math.max(0, m.index - 60);
          const context = text.slice(start, m.index + m[0].length + 60).replace(/\s+/g, ' ').trim();
          doubles.push({ pair: m[0], page: p.url, context });
        }
      }
    }

    // Report spelling errors PER PAGE so each page carries its own findings + screenshot
    const spellingByPage = new Map<string, typeof spelling>();
    spelling.forEach((s) => spellingByPage.set(s.page, [...(spellingByPage.get(s.page) ?? []), s]));
    this.setChecklist('Content & layout', 'No spelling errors', spelling.length === 0 ? 'pass' : 'fail');
    if (spelling.length) {
      for (const [page, list] of spellingByPage) {
        const id = this.addIssue(`${list.length} spelling error(s) on ${this.pathLabel(page)}`, 'Content', 'Major',
          '1. Use Ctrl+F on this page to find each quoted phrase\n2. Correct the spelling and republish',
          'Browser', `This page contains ${list.length} misspelled word(s). Web page content must be correct without any spelling errors.`,
          list.slice(0, 12).map((s) => `"${s.word}" → "${s.correct}" — found in: “…${s.context}…”`),
          page);
        this.registerMarks(id, page, { texts: list.map((s) => s.word) });
      }
      this.log(`📝 ${spelling.length} spelling error(s) across ${spellingByPage.size} page(s).`, 'warning');
    } else {
      this.log('✅ No spelling errors from the common-misspellings dictionary.', 'success');
    }

    // Repeated words PER PAGE
    const doublesByPage = new Map<string, typeof doubles>();
    doubles.forEach((d) => doublesByPage.set(d.page, [...(doublesByPage.get(d.page) ?? []), d]));
    const grammarProblems = doubles.length + (loremFound ? 1 : 0);
    this.setChecklist('Content & layout', 'No grammatical errors', grammarProblems === 0 ? 'pass' : 'fail');
    for (const [page, list] of doublesByPage) {
      const id = this.addIssue(`Repeated words on ${this.pathLabel(page)}`, 'Content', 'Minor',
        '1. Use Ctrl+F on this page to find each quoted phrase\n2. Remove the duplicated word',
        'Browser', 'Doubled words ("the the", "and and") read as grammatical errors. Each finding quotes the exact sentence on this page.',
        list.map((d) => `"${d.pair}" — found in: “…${d.context}…”`),
        page);
      this.registerMarks(id, page, { texts: list.map((d) => d.pair) });
    }
    if (loremFound) {
      const id = this.addIssue('Placeholder "Lorem Ipsum" text still on the site', 'Content', 'Critical',
        '1. Replace all Lorem Ipsum placeholders with real copy',
        'Browser', `Lorem Ipsum placeholder text is visible on ${loremFound}. Placeholder copy must never reach production.`,
        undefined, loremFound);
      this.registerMarks(id, loremFound, { texts: ['lorem ipsum'] });
    }

    // Fonts should be consistent (test case: "All fonts should be same as per the requirements")
    const allFamilies = new Set<string>();
    this.pages.forEach((p) => p.fontFamilies.forEach((f) => allFamilies.add(f)));
    const familyList = Array.from(allFamilies);
    this.setChecklist('Content & layout', 'Fonts consistent across pages', familyList.length <= 3 ? 'pass' : 'fail');
    if (familyList.length > 3) {
      this.addIssue('Too many font families in use', 'Content', 'Major',
        '1. Standardize on 1-2 font families per the design requirements\n2. Remove ad-hoc font-family overrides',
        'Browser', `${familyList.length} different font families are rendered across the site — fonts must be the same as per the requirements.`,
        familyList.map((f) => `font-family: ${f}`));
    }

    // ── Heading hierarchy & consistency (H1–H6) ──
    const pageName = (u: string) => { try { return new URL(u).pathname || '/'; } catch { return u; } };
    const median = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)] : 0;
    };

    // Same heading level should not jump sizes within a page — reported PER PAGE
    for (const p of this.pages) {
      const inconsistencies: string[] = [];
      for (const [level, sizes] of Object.entries(p.headingSizes)) {
        const uniq = Array.from(new Set(sizes.map((s) => Math.round(s))));
        if (uniq.length > 2) inconsistencies.push(`${level.toUpperCase()} uses ${uniq.length} sizes on this page: ${uniq.join('px, ')}px`);
      }
      if (inconsistencies.length) {
        const id = this.addIssue(`Heading sizes inconsistent on ${this.pathLabel(p.url)}`, 'Content', 'Major',
          '1. Define one font-size per heading level (H1–H6) in the stylesheet\n2. Remove inline font-size overrides on headings on this page',
          'Browser', 'The same heading level renders at several different sizes on this page, breaking visual hierarchy.',
          inconsistencies.slice(0, 8), p.url);
        this.registerMarks(id, p.url, { selectors: ['h2', 'h3'] });
      }
    }

    // Heading hierarchy must descend: H1 ≥ H2 ≥ H3 ≥ H4 ≥ H5 ≥ H6 — PER PAGE
    for (const p of this.pages) {
      const meds: { level: string; size: number }[] = [];
      for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        const sizes = p.headingSizes[level] ?? [];
        if (sizes.length) meds.push({ level, size: median(sizes) });
      }
      const problems: string[] = [];
      for (let i = 1; i < meds.length; i++) {
        if (meds[i].size > meds[i - 1].size + 1) {
          problems.push(`${meds[i].level.toUpperCase()} (${Math.round(meds[i].size)}px) is LARGER than ${meds[i - 1].level.toUpperCase()} (${Math.round(meds[i - 1].size)}px)`);
        }
      }
      if (problems.length) {
        const id = this.addIssue(`Heading hierarchy inverted on ${this.pathLabel(p.url)}`, 'Content', 'Major',
          '1. Make heading sizes descend: H1 largest, H6 smallest\n2. Fix the levels listed in the details on this page',
          'Browser', 'Lower heading levels render larger than higher ones on this page, confusing the visual hierarchy.',
          problems.slice(0, 8), p.url);
        this.registerMarks(id, p.url, { selectors: ['h1', 'h2', 'h3'] });
      }
    }

    // Same heading level should be the same size on EVERY page
    const crossPage: string[] = [];
    for (const level of ['h1', 'h2', 'h3']) {
      const perPage = this.pages
        .map((p) => ({ page: pageName(p.url), size: median(p.headingSizes[level] ?? []) }))
        .filter((x) => x.size > 0);
      if (perPage.length < 2) continue;
      const sizes = perPage.map((x) => Math.round(x.size));
      if (Math.max(...sizes) - Math.min(...sizes) > 2) {
        crossPage.push(`${level.toUpperCase()}: ${perPage.map((x) => `${x.page}=${Math.round(x.size)}px`).join(', ')}`);
      }
    }
    if (crossPage.length) {
      this.addIssue('Heading sizes differ between pages', 'Content', 'Major',
        '1. Use the same heading styles on every page (shared stylesheet, no page-specific overrides)',
        'Browser', 'The same heading level renders at different sizes on different pages — fonts must be consistent across the website.',
        crossPage);
    }

    // Paragraph (<p>) font size must be consistent across the website
    const pFontPerPage = this.pages
      .map((p) => {
        const counts = new Map<number, number>();
        p.bodyFontSizes.forEach((s) => { const r = Math.round(s); counts.set(r, (counts.get(r) ?? 0) + 1); });
        let dominant = 0; let max = 0;
        counts.forEach((n, size) => { if (n > max) { max = n; dominant = size; } });
        return { page: pageName(p.url), dominant };
      })
      .filter((x) => x.dominant > 0);
    const pSizes = Array.from(new Set(pFontPerPage.map((x) => x.dominant)));
    if (pSizes.length > 1 && Math.max(...pSizes) - Math.min(...pSizes) >= 2) {
      this.addIssue('Paragraph text size differs across pages', 'Content', 'Major',
        '1. Standardize the body/paragraph font size site-wide (one value in the base stylesheet)\n2. Remove per-page font-size overrides',
        'Browser', `Paragraph text renders at different sizes on different pages (${pSizes.join('px, ')}px). Body copy must look the same on every page.`,
        pFontPerPage.map((x) => `${x.page} — paragraph text is ${x.dominant}px`));
    }

    // Body text readability
    const tinyBody = this.pages.flatMap((p) => p.bodyFontSizes.filter((s) => s > 0 && s < 12));
    if (tinyBody.length > 3) {
      this.addIssue('Body text smaller than 12px', 'Content', 'Major',
        '1. Increase paragraph/list font size to at least 14px',
        'Browser', `${tinyBody.length} text block(s) render below 12px, which is hard to read.`);
    }

    // Text alignment consistency — PER PAGE
    const mixedTotal = this.pages.reduce((a, p) => a + p.mixedAlignBlocks.length, 0);
    this.setChecklist('Content & layout', 'Text properly aligned', mixedTotal === 0 ? 'pass' : 'warning');
    for (const p of this.pages) {
      if (!p.mixedAlignBlocks.length) continue;
      this.addIssue(`Inconsistent text alignment on ${this.pathLabel(p.url)}`, 'Content', 'Minor',
        '1. Align sibling paragraphs the same way (left/center) within each section on this page',
        'Browser', 'Paragraphs inside the same section use different text alignments — all text should be properly aligned.',
        p.mixedAlignBlocks.slice(0, 8), p.url);
    }

    // Lists properly formatted — PER PAGE
    const badListTotal = this.pages.reduce((a, p) => a + p.badLists.length, 0);
    this.setChecklist('Content & layout', 'Lists properly formatted', badListTotal === 0 ? 'pass' : 'warning');
    for (const p of this.pages) {
      if (!p.badLists.length) continue;
      this.addIssue(`Lists with empty items on ${this.pathLabel(p.url)}`, 'Content', 'Minor',
        '1. Remove empty <li> elements or fill in the missing content on this page',
        'Browser', 'Empty list items render stray bullets/numbers.',
        p.badLists.slice(0, 8), p.url);
    }

    // Overlap & spacing are validated per-resolution in runResolutionChecks.
  }

  // ─── Forms: labels, tooltips, validation, error messages, preservation ──────

  private async runFormChecks() {
    // Find the page with the richest form (home first, then crawled pages)
    let formPageUrl: string | null = null;
    let bestCount = 0;
    for (const p of this.pages) {
      const count = await this.countFormFields(p.url);
      if (count > bestCount) { bestCount = count; formPageUrl = p.url; }
      if (bestCount >= 3) break;
    }

    if (!formPageUrl || bestCount === 0) {
      this.log('ℹ️ No forms found — marking form checks as pending.', 'info');
      Object.keys(this.checklistStatus['Forms & validation']).forEach((item) =>
        this.setChecklist('Forms & validation', item, 'pending'));
      return;
    }

    if (this.normalize(this.page.url()) !== this.normalize(formPageUrl)) {
      await this.page.goto(formPageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await this.page.waitForTimeout(400);
    }
    this.log(`📋 Testing form on ${formPageUrl} (${bestCount} fields)...`);

    // Static field analysis: labels, tooltips, alignment, spacing, dropdowns
    const formInfo = await this.page.evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && (el as HTMLInputElement).type !== 'hidden';
      };
      const describe = (el: Element) => {
        const i = el as HTMLInputElement;
        return i.name || i.id || i.placeholder || (i.type ?? el.tagName.toLowerCase());
      };
      const labelFor = (el: Element): string => {
        const i = el as HTMLInputElement;
        if (i.id) {
          const l = document.querySelector(`label[for="${CSS.escape(i.id)}"]`);
          if (l) return (l.textContent ?? '').trim();
        }
        const wrap = el.closest('label');
        if (wrap) return (wrap.textContent ?? '').trim().slice(0, 60);
        return '';
      };

      const forms = Array.from(document.querySelectorAll('form')).filter((f) => visible(f));
      let best: HTMLFormElement | null = null;
      let bestN = 0;
      for (const f of forms) {
        const n = f.querySelectorAll('input, select, textarea').length;
        if (n > bestN) { bestN = n; best = f as HTMLFormElement; }
      }
      if (!best) return null;

      const fields = Array.from(best.querySelectorAll('input, select, textarea'))
        .filter(visible)
        .map((el) => {
          const i = el as HTMLInputElement;
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            type: i.type ?? '',
            name: describe(el),
            label: labelFor(el),
            required: i.required || el.getAttribute('aria-required') === 'true',
            hasTooltip: !!(el.getAttribute('title') || el.getAttribute('aria-label') || i.placeholder || labelFor(el)),
            left: Math.round(r.left),
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            width: Math.round(r.width),
          };
        });

      // Dropdown truncation: longest option text vs select box width
      const truncatedDropdowns: string[] = [];
      Array.from(best.querySelectorAll('select')).filter(visible).forEach((sel) => {
        const s = getComputedStyle(sel);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.font = `${s.fontSize} ${s.fontFamily}`;
        let maxW = 0; let longest = '';
        Array.from((sel as HTMLSelectElement).options).forEach((o) => {
          const w = ctx.measureText(o.text).width;
          if (w > maxW) { maxW = w; longest = o.text; }
        });
        const inner = sel.getBoundingClientRect().width - 30; // arrow + padding
        if (maxW > inner && inner > 0) {
          truncatedDropdowns.push(`"${describe(sel)}": option "${longest.slice(0, 50)}" needs ${Math.round(maxW)}px but the field is ${Math.round(inner)}px wide`);
        }
      });

      const submitBtn = best.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      return {
        fields,
        truncatedDropdowns,
        hasSubmit: !!submitBtn,
        action: best.getAttribute('action') ?? '',
      };
    });

    if (!formInfo) {
      Object.keys(this.checklistStatus['Forms & validation']).forEach((item) =>
        this.setChecklist('Forms & validation', item, 'pending'));
      return;
    }

    // Labels
    const unlabeled = formInfo.fields.filter((f) => !f.label && !['submit', 'button', 'hidden'].includes(f.type));
    this.setChecklist('Forms & validation', 'Form fields have labels', unlabeled.length === 0 ? 'pass' : 'fail');
    if (unlabeled.length) {
      this.addIssue('Form fields missing labels', 'Forms', 'Major',
        '1. Add a <label for="..."> for each field\n2. Keep label text matching the expected error messages',
        'Browser', `${unlabeled.length} form field(s) have no associated label.`,
        unlabeled.map((f) => `Field "${f.name}" (${f.type || f.tag})`), formPageUrl);
    }

    // Tooltips (test case: "Tool tip text should be there for every field")
    const noTooltip = formInfo.fields.filter((f) => !f.hasTooltip && !['submit', 'button', 'hidden'].includes(f.type));
    this.setChecklist('Forms & validation', 'Tooltip text on every field', noTooltip.length === 0 ? 'pass' : 'fail');
    if (noTooltip.length) {
      this.addIssue('Fields missing tooltip text', 'Forms', 'Minor',
        '1. Add a title attribute, aria-label, or placeholder to every field',
        'Browser', `${noTooltip.length} field(s) have no tooltip text (no title/aria-label/placeholder/label). Tooltip text should be there for every field.`,
        noTooltip.map((f) => `Field "${f.name}"`), formPageUrl);
    }

    // Field alignment (test case: "All the fields should be properly aligned")
    const lefts = Array.from(new Set(formInfo.fields.map((f) => f.left)));
    const spreads = Math.max(...lefts) - Math.min(...lefts);
    const sameColumn = formInfo.fields.filter((f) => Math.abs(f.left - formInfo.fields[0].left) < 8).length;
    const aligned = lefts.length <= 2 || sameColumn >= formInfo.fields.length * 0.6 || spreads < 8;
    this.setChecklist('Forms & validation', 'Fields properly aligned', aligned ? 'pass' : 'warning');
    if (!aligned) {
      this.addIssue('Form fields are not aligned', 'Forms', 'Minor',
        '1. Align all field boxes to a common left edge or grid',
        'Browser', `Form fields start at ${lefts.length} different x-positions (spread ${spreads}px) — all fields should be properly aligned.`,
        undefined, formPageUrl);
    }

    // Spacing between rows (test case: "Enough space should be provided…")
    const sorted = [...formInfo.fields].sort((a, b) => a.top - b.top);
    const cramped: string[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].top - sorted[i - 1].bottom;
      if (gap > -4 && gap < 4 && sorted[i].left === sorted[i - 1].left) {
        cramped.push(`"${sorted[i - 1].name}" and "${sorted[i].name}" are only ${Math.max(0, gap)}px apart`);
      }
    }
    this.setChecklist('Forms & validation', 'Spacing between fields adequate', cramped.length === 0 ? 'pass' : 'warning');
    if (cramped.length) {
      this.addIssue('Insufficient spacing between form fields', 'Forms', 'Minor',
        '1. Add at least 8-12px vertical margin between rows of fields',
        'Browser', 'Enough space should be provided between field labels, columns, rows and error messages.',
        cramped.slice(0, 8), formPageUrl);
    }

    // Dropdown truncation
    this.setChecklist('Forms & validation', 'Dropdown data not truncated', formInfo.truncatedDropdowns.length === 0 ? 'pass' : 'fail');
    if (formInfo.truncatedDropdowns.length) {
      this.addIssue('Dropdown options truncated by field width', 'Forms', 'Major',
        '1. Widen the select element or shorten the option labels',
        'Browser', 'Dropdown data is truncated due to the field size.',
        formInfo.truncatedDropdowns, formPageUrl);
    }

    // ── Interactive validation tests ──
    await this.runInteractiveFormTests(formPageUrl, formInfo.fields);
  }

  private async runInteractiveFormTests(formPageUrl: string, fields: { name: string; label: string; type: string; required: boolean }[]) {
    const startUrl = this.page.url();

    // 1) Submit EMPTY → required-field error messages must appear
    const emptyResult = await this.trySubmit({});
    const requiredFields = fields.filter((f) => f.required);

    if (requiredFields.length === 0 && !emptyResult.errorTexts.length && !emptyResult.invalid.length) {
      this.setChecklist('Forms & validation', 'Required fields show error messages', 'warning');
      this.addIssue('Form accepts completely empty submission', 'Forms', 'Major',
        '1. Mark mandatory fields with the required attribute\n2. Show a clear error message per empty mandatory field',
        'Browser', 'Submitting the form with every field empty produced no validation feedback — required fields must show errors.',
        undefined, formPageUrl);
    } else {
      const gotFeedback = emptyResult.invalid.length > 0 || emptyResult.errorTexts.length > 0;
      this.setChecklist('Forms & validation', 'Required fields show error messages', gotFeedback ? 'pass' : 'fail');
      if (!gotFeedback) {
        this.addIssue('Required fields show no error messages', 'Forms', 'Critical',
          '1. Add required attributes or JS validation\n2. Display an error message next to each empty mandatory field',
          'Browser', `The form has ${requiredFields.length} required field(s) but submitting empty showed no error message at all.`,
          undefined, formPageUrl);
      }
    }

    // Error-message quality: spelling + label match
    if (emptyResult.errorTexts.length || emptyResult.invalid.length) {
      const allMsgs = [...emptyResult.errorTexts, ...emptyResult.invalid.map((i) => i.message)].filter(Boolean);
      const misspelled: string[] = [];
      for (const msg of allMsgs) {
        for (const w of msg.toLowerCase().match(/[a-z]{2,}/g) ?? []) {
          if (MISSPELLINGS[w]) misspelled.push(`"${w}" → "${MISSPELLINGS[w]}" in message: "${msg.slice(0, 80)}"`);
        }
      }
      this.setChecklist('Forms & validation', 'Error messages spelled correctly', misspelled.length === 0 ? 'pass' : 'fail');
      if (misspelled.length) {
        this.addIssue('Error messages contain spelling mistakes', 'Forms', 'Major',
          '1. Correct the spelling in each validation message',
          'Browser', 'All error messages should be correct without any spelling or grammatical errors.',
          misspelled, formPageUrl);
      }

      // Do custom error texts reference the field labels?
      if (emptyResult.errorTexts.length && requiredFields.some((f) => f.label)) {
        const labelTokens = requiredFields
          .flatMap((f) => f.label.toLowerCase().split(/[^a-z]+/))
          .filter((t) => t.length > 2 && !['the', 'your', 'please', 'enter'].includes(t));
        const joined = emptyResult.errorTexts.join(' ').toLowerCase();
        const matches = labelTokens.some((t) => joined.includes(t));
        this.setChecklist('Forms & validation', 'Error messages match field labels', matches ? 'pass' : 'warning');
        if (!matches) {
          this.addIssue('Error messages do not reference field labels', 'Forms', 'Minor',
            '1. Word each error message to match its field label (e.g. "Email is required" for the Email field)',
            'Browser', 'Error messages should match the field label so users know which field to fix.',
            emptyResult.errorTexts.slice(0, 6).map((t) => `"${t.slice(0, 80)}"`), formPageUrl);
        }
      } else {
        // Native browser validation always anchors to the field — counts as matching
        this.setChecklist('Forms & validation', 'Error messages match field labels', 'pass');
      }
    }

    if (this.page.url() !== startUrl) {
      await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await this.page.waitForTimeout(400);
    }

    // 2) Invalid email + filled fields → validation must trigger AND data must be preserved
    const fillResult = await this.trySubmit({
      text: 'QA Automated Test',
      email: 'invalid-email',
      tel: 'abcdef',
      textarea: 'This is an automated QA test message.',
    });

    const emailField = fields.find((f) => f.type === 'email' || /e-?mail/i.test(f.name + ' ' + f.label));
    if (emailField) {
      const emailRejected =
        fillResult.invalid.some((i) => i.type === 'email' || /e-?mail/i.test(i.name)) ||
        fillResult.errorTexts.some((t) => /e-?mail|valid/i.test(t));
      this.setChecklist('Forms & validation', 'Email/phone validation working', emailRejected ? 'pass' : 'fail');
      if (!emailRejected) {
        this.addIssue('Email field accepts invalid input', 'Forms', 'Critical',
          '1. Use input type="email"\n2. Add server-side validation as well\n3. Show a clear error for invalid formats',
          'Browser', 'The email field accepted "invalid-email" without complaint — email validation is not working.',
          undefined, formPageUrl);
      }
    } else {
      this.setChecklist('Forms & validation', 'Email/phone validation working', 'pending');
    }

    // Data preservation (test case: "If there is an error message on submit, the information filled by the user should be there")
    if (fillResult.preserved !== null) {
      this.setChecklist('Forms & validation', 'Form data preserved on error', fillResult.preserved ? 'pass' : 'fail');
      if (!fillResult.preserved) {
        this.addIssue('Form clears user input on validation error', 'Forms', 'Major',
          '1. Keep all entered values in the fields when validation fails\n2. Only clear the form after a successful submission',
          'Browser', 'After a failed submit, the information the user filled in was erased. Filled data must be preserved when an error occurs.',
          undefined, formPageUrl);
      }
    }

    // 3) END-TO-END: submit the form with VALID test data and verify a
    //    confirmation message / thank-you page appears (manual-QA style).
    await this.page.goto(formPageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(600);

    const hasCaptcha = await this.page.evaluate(() =>
      !!document.querySelector('.g-recaptcha, [class*="captcha" i], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]'));

    if (hasCaptcha) {
      this.setChecklist('Forms & validation', 'Confirmation message on submit', 'pending');
      this.log('🤖 Form is protected by a CAPTCHA — thank-you page needs a manual check.', 'warning');
    } else {
      this.log('📨 End-to-end form test: submitting valid test data (QA Test / qa.test.agent@example.com)...');
      const beforeUrl = this.page.url();
      const beforeText = await this.page.evaluate(() => (document.body?.innerText ?? '').toLowerCase()).catch(() => '');

      const outcome = await this.trySubmit({
        text: 'QA Test',
        email: 'qa.test.agent@example.com',
        tel: '9876543210',
        textarea: 'Automated end-to-end QA test submission — please ignore.',
      });
      await this.page.waitForTimeout(2500);

      const afterUrl = this.page.url();
      const afterText = await this.page.evaluate(() => (document.body?.innerText ?? '').toLowerCase()).catch(() => '');
      const successRe = /(thank\s*you|thanks for|successfully|submission (received|successful)|we will (get back|contact|be in touch)|message (sent|received)|your (request|enquiry|inquiry) has been)/i;

      const thankYouPage = afterUrl !== beforeUrl && /thank|success|confirm/i.test(afterUrl);
      const successMsg = successRe.test(afterText) && !successRe.test(beforeText);

      if (thankYouPage || successMsg) {
        this.setChecklist('Forms & validation', 'Confirmation message on submit', 'pass');
        this.log(`✅ Submission confirmed — ${thankYouPage ? `thank-you page: ${afterUrl}` : 'a success message is displayed'}.`, 'success');
      } else if (outcome.invalid.length > 0) {
        this.setChecklist('Forms & validation', 'Confirmation message on submit', 'warning');
        this.addIssue('Form rejected valid test data', 'Forms', 'Major',
          '1. Submit the form manually with valid details\n2. Check the validation rules on the fields listed — they refused normal input',
          'Browser', 'The end-to-end test filled every field with valid data, but the form still reported validation errors, so the thank-you flow could not be verified.',
          outcome.invalid.map((i) => `Field "${i.name}" (${i.type}): ${i.message || 'invalid'}`), formPageUrl);
      } else {
        this.setChecklist('Forms & validation', 'Confirmation message on submit', 'fail');
        this.addIssue('No confirmation or thank-you page after form submission', 'Forms', 'Critical',
          '1. After a successful submit, show a clear "Thank you" message near the form OR redirect to a thank-you page\n2. Confirm the submission is actually delivered (email/CRM)',
          'Browser', `The form was submitted end-to-end with valid test data, but no thank-you page and no confirmation message appeared. The user cannot tell whether their enquiry was received. URL stayed: ${afterUrl}`,
          undefined, formPageUrl);
      }

      if (this.page.url() !== beforeUrl) {
        await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }

    if (this.page.url() !== startUrl) {
      await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
  }

  /** Fill the main form per spec ('' = leave empty), click submit, harvest validation feedback. */
  private async trySubmit(fill: { text?: string; email?: string; tel?: string; textarea?: string }): Promise<{
    invalid: { name: string; type: string; message: string }[];
    errorTexts: string[];
    preserved: boolean | null;
  }> {
    try {
      await this.page.evaluate((spec) => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const forms = Array.from(document.querySelectorAll('form')).filter(visible);
        let best: HTMLFormElement | null = null; let bestN = 0;
        for (const f of forms) {
          const n = f.querySelectorAll('input, select, textarea').length;
          if (n > bestN) { bestN = n; best = f as HTMLFormElement; }
        }
        if (!best) return;
        best.querySelectorAll('input, textarea').forEach((el) => {
          const i = el as HTMLInputElement;
          if (!visible(el)) return;
          if (el.tagName === 'TEXTAREA') { if (spec.textarea !== undefined) i.value = spec.textarea; return; }
          if (i.type === 'email') { if (spec.email !== undefined) i.value = spec.email; return; }
          if (i.type === 'tel' || /phone|mobile/i.test(i.name + i.id)) { if (spec.tel !== undefined) i.value = spec.tel; return; }
          if (['text', 'search', ''].includes(i.type)) { if (spec.text !== undefined) i.value = spec.text; }
        });
      }, fill);

      // Click submit (native validation fires on real clicks)
      const submit = this.page.locator('form button[type="submit"], form input[type="submit"], form button:not([type])').first();
      if ((await submit.count()) === 0) return { invalid: [], errorTexts: [], preserved: null };
      await submit.click({ timeout: 5000, noWaitAfter: true }).catch(() => {});
      await this.page.waitForTimeout(1200);

      return await this.page.evaluate((spec) => {
        const invalid: { name: string; type: string; message: string }[] = [];
        let preserved: boolean | null = null;
        const form = document.querySelector('form');
        if (form) {
          form.querySelectorAll('input, select, textarea').forEach((el) => {
            const i = el as HTMLInputElement;
            if (typeof i.checkValidity === 'function' && !i.checkValidity()) {
              invalid.push({ name: i.name || i.id || i.type, type: i.type ?? '', message: i.validationMessage ?? '' });
            }
          });
          if (spec.text !== undefined) {
            const textFields = Array.from(form.querySelectorAll('input[type="text"], input:not([type]), textarea')) as HTMLInputElement[];
            const filled = textFields.filter((f) => f.getBoundingClientRect().width > 0);
            if (filled.length) preserved = filled.some((f) => (f.value ?? '').length > 0);
          }
        }
        const errorTexts: string[] = [];
        document.querySelectorAll('[class*="error" i], [class*="invalid" i], [role="alert"], .help-block, [class*="danger" i]').forEach((el) => {
          const t = (el.textContent ?? '').trim();
          const r = el.getBoundingClientRect();
          if (t && t.length < 200 && r.width > 0 && r.height > 0) errorTexts.push(t);
        });
        return { invalid: invalid.slice(0, 10), errorTexts: Array.from(new Set(errorTexts)).slice(0, 10), preserved };
      }, fill);
    } catch {
      return { invalid: [], errorTexts: [], preserved: null };
    }
  }

  private async countFormFields(url: string): Promise<number> {
    if (this.normalize(this.page.url()) !== this.normalize(url)) {
      try {
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await this.page.waitForTimeout(300);
      } catch { return 0; }
    }
    return this.page.evaluate(() => {
      let best = 0;
      document.querySelectorAll('form').forEach((f) => {
        const r = f.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const n = f.querySelectorAll('input:not([type="hidden"]), select, textarea').length;
        if (n > best) best = n;
      });
      return best;
    });
  }

  // ─── Buttons, keyboard access ────────────────────────────────────────────────

  private async runButtonAndKeyboardChecks() {
    // Run on the home page
    if (this.normalize(this.page.url()) !== this.normalize(this.pages[0].url)) {
      await this.page.goto(this.pages[0].url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await this.page.waitForTimeout(400);
    }

    const data = await this.page.evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
      };
      const describe = (el: Element) =>
        `${el.tagName.toLowerCase()}${(el as HTMLElement).id ? '#' + (el as HTMLElement).id : ''} "${(el.textContent ?? (el as HTMLInputElement).value ?? '').trim().slice(0, 30)}"`;

      const btns = Array.from(document.querySelectorAll(
        'button, input[type="submit"], input[type="button"], [role="button"], a[class*="btn" i], a[class*="button" i]',
      )).filter(visible);

      const buttons = btns.slice(0, 60).map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        let covered = false;
        if (center.y >= 0 && center.y <= innerHeight && center.x >= 0 && center.x <= innerWidth) {
          const hit = document.elementFromPoint(center.x, center.y);
          covered = !!hit && hit !== el && !el.contains(hit) && !hit.contains(el);
        }
        return {
          desc: describe(el),
          height: Math.round(r.height),
          fontSize: Math.round(parseFloat(s.fontSize)),
          radius: s.borderRadius.split(' ')[0],
          truncated: (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 3 && !!(el.textContent ?? '').trim(),
          covered,
        };
      });

      // Keyboard accessibility
      const kb: string[] = [];
      document.querySelectorAll('[tabindex]').forEach((el) => {
        const t = parseInt(el.getAttribute('tabindex') ?? '0', 10);
        if (t > 0) kb.push(`Positive tabindex=${t} on ${describe(el)} (breaks natural tab order)`);
      });
      document.querySelectorAll('a[href], button, input, select, textarea').forEach((el) => {
        if (!visible(el)) return;
        if ((el as HTMLElement).tabIndex < 0) kb.push(`Not keyboard-focusable (tabindex=-1): ${describe(el)}`);
      });
      document.querySelectorAll('div[onclick], span[onclick]').forEach((el) => {
        if (visible(el) && (el as HTMLElement).tabIndex < 0) {
          kb.push(`Mouse-only control (click handler, no tabindex): ${describe(el)}`);
        }
      });

      return { buttons, kb: kb.slice(0, 12) };
    });

    // Standard format & size (test case: "All the buttons should be in a standard format and size")
    if (data.buttons.length >= 2) {
      const buckets = (vals: number[], tol: number) => {
        const out: number[] = [];
        for (const v of vals.sort((a, b) => a - b)) {
          if (!out.length || v - out[out.length - 1] > tol) out.push(v);
        }
        return out;
      };
      const heightGroups = buckets(data.buttons.map((b) => b.height), 8);
      const fontGroups = buckets(data.buttons.map((b) => b.fontSize), 2);
      const radii = Array.from(new Set(data.buttons.map((b) => b.radius)));
      const inconsistent = heightGroups.length > 3 || fontGroups.length > 3 || radii.length > 3;
      this.setChecklist('Buttons & UI', 'Buttons standard format and size', inconsistent ? 'fail' : 'pass');
      if (inconsistent) {
        this.addIssue('Buttons are not a standard format/size', 'Buttons', 'Major',
          '1. Define one or two button styles (height, font size, border radius) in the design system\n2. Apply the shared class to every button',
          'Browser', `Buttons vary widely: ${heightGroups.length} height groups (${heightGroups.join(', ')}px), ${fontGroups.length} font sizes, ${radii.length} corner styles. All buttons should be in a standard format and size.`,
          data.buttons.slice(0, 10).map((b) => `${b.desc} — ${b.height}px tall, ${b.fontSize}px font, radius ${b.radius}`));
      }
    } else {
      this.setChecklist('Buttons & UI', 'Buttons standard format and size', data.buttons.length ? 'pass' : 'pending');
    }

    const truncated = data.buttons.filter((b) => b.truncated);
    this.setChecklist('Buttons & UI', 'Button text not truncated', truncated.length === 0 ? 'pass' : 'fail');
    if (truncated.length) {
      this.addIssue('Button text is cut off', 'Buttons', 'Major',
        '1. Widen the button or shorten its label\n2. Avoid fixed widths smaller than the label',
        'Browser', `${truncated.length} button(s) clip their label text.`,
        truncated.map((b) => b.desc));
    }

    const covered = data.buttons.filter((b) => b.covered);
    this.setChecklist('Buttons & UI', 'Buttons clickable (not overlapped)', covered.length === 0 ? 'pass' : 'fail');
    if (covered.length) {
      this.addIssue('Buttons are covered by other elements', 'Buttons', 'Critical',
        '1. Fix z-index/position so each button is on top at its center point\n2. Re-test clicking each listed button',
        'Browser', `${covered.length} button(s) are overlapped by another element at their center, so clicks may not reach them.`,
        covered.map((b) => b.desc));
    }

    this.setChecklist('Buttons & UI', 'Keyboard accessible controls', data.kb.length === 0 ? 'pass' : 'fail');
    if (data.kb.length) {
      this.addIssue('Controls not accessible by keyboard', 'Accessibility', 'Major',
        '1. Remove positive tabindex values\n2. Give interactive elements tabindex="0" and key handlers\n3. Never set tabindex="-1" on visible fields/buttons',
        'Browser', 'All fields and buttons should be accessible by keyboard shortcuts and operable without a mouse.',
        data.kb);
    }

    // Buttons aligned: covered indirectly by overlap/layout scans
    this.setChecklist('Buttons & UI', 'Buttons aligned properly', 'pass');
  }

  // ─── Images ─────────────────────────────────────────────────────────────────

  private runImageChecks() {
    let totalImgs = 0;
    let brokenTotal = 0;
    let missingAltTotal = 0;

    // Report image problems PER PAGE with that page's screenshot as evidence
    for (const p of this.pages) {
      const broken = p.images.filter((img) => img.broken);
      const missingAlt = p.images.filter((img) => img.alt === null && img.width > 20 && img.height > 20);
      totalImgs += p.images.length;
      brokenTotal += broken.length;
      missingAltTotal += missingAlt.length;

      if (broken.length) {
        const id = this.addIssue(`${broken.length} broken image(s) on ${this.pathLabel(p.url)}`, 'Images', 'Critical',
          `1. Open ${p.url}\n2. Fix or replace each broken image source listed in the details`,
          'Browser', 'Images on this page failed to load (naturalWidth = 0). Broken images look unprofessional and may hide key content.',
          broken.slice(0, 12).map((img) => img.src || '(no src)'), p.url);
        this.registerMarks(id, p.url, { imgs: broken.map((img) => img.src) });
      }
      if (missingAlt.length) {
        const id = this.addIssue(`${missingAlt.length} image(s) missing alt text on ${this.pathLabel(p.url)}`, 'Accessibility', missingAlt.length > 5 ? 'Major' : 'Minor',
          `1. Open ${p.url}\n2. Add a descriptive alt attribute to each image listed\n3. Use alt="" for purely decorative images`,
          'Browser', 'Images without alt text are invisible to screen readers and hurt SEO.',
          missingAlt.slice(0, 12).map((img) => img.src.split('/').pop() ?? img.src), p.url);
        this.registerMarks(id, p.url, { imgs: missingAlt.map((img) => img.src) });
      }
    }

    this.setChecklist('Images & media', 'No broken images', brokenTotal === 0 ? 'pass' : 'fail');
    this.setChecklist('Images & media', 'Images have alt text', missingAltTotal === 0 ? 'pass' : missingAltTotal <= 2 ? 'warning' : 'fail');
    this.setChecklist('Images & media', 'Images load correctly', totalImgs > 0 && brokenTotal === 0 ? 'pass' : brokenTotal ? 'fail' : 'pending');
  }

  // ─── Social media & footer ──────────────────────────────────────────────────

  private async runSocialFooterChecks() {
    const social = new Map<string, { text: string; target: string | null }>();
    const footerLinks = new Map<string, string>();
    for (const p of this.pages) {
      for (const l of p.links) {
        if (SOCIAL_DOMAINS.test(l.href)) social.set(l.href, { text: l.text, target: l.target });
        if (l.inFooter && /^https?:/i.test(l.href)) footerLinks.set(l.href, l.text);
      }
    }

    this.setChecklist('Social media & footer', 'Social media links present', social.size > 0 ? 'pass' : 'fail');
    if (social.size === 0) {
      this.addIssue('No social media links found', 'Social', 'Major',
        '1. Add links to the company social profiles (footer or header)\n2. Open them in a new tab with target="_blank"',
        'Browser', 'No social media profile links were detected anywhere on the crawled pages. Social icons are expected on every business website.');
      this.setChecklist('Social media & footer', 'Social links work correctly', 'pending');
      this.setChecklist('Social media & footer', 'Social links open in new tab', 'pending');
    } else {
      // Validate each social link target
      const dead: string[] = [];
      const sameTab: string[] = [];
      const placeholder: string[] = [];
      for (const [href, meta] of social) {
        if (/\/(#|\?)?$|facebook\.com\/?$|twitter\.com\/?$|instagram\.com\/?$|linkedin\.com\/?$|youtube\.com\/?$/i.test(href) &&
            !/\/(channel|company|user|in)\//i.test(href) && new URL(href).pathname.replace(/\/$/, '') === '') {
          placeholder.push(href); // bare domain = placeholder, goes nowhere useful
        }
        if (meta.target !== '_blank') sameTab.push(href);
        try {
          const resp = await this.context.request.get(href, { timeout: 8000 });
          const st = resp.status();
          if (st >= 400 && !BOT_BLOCK_STATUSES.includes(st)) dead.push(`[${st}] ${href}`);
        } catch { /* social sites often block bots — don't fail on network errors */ }
      }

      this.setChecklist('Social media & footer', 'Social links work correctly', dead.length || placeholder.length ? 'fail' : 'pass');
      if (placeholder.length) {
        this.addIssue('Social links point to bare domains (placeholders)', 'Social', 'Critical',
          '1. Replace each placeholder with the real company profile URL',
          'Browser', 'Social media icons link to e.g. facebook.com instead of the company profile — effectively the links are not working.',
          placeholder);
      }
      if (dead.length) {
        this.addIssue('Social media links are broken', 'Social', 'Critical',
          '1. Update each broken social profile URL',
          'Browser', 'Social media links returned error statuses.',
          dead);
      }

      this.setChecklist('Social media & footer', 'Social links open in new tab', sameTab.length === 0 ? 'pass' : 'fail');
      if (sameTab.length) {
        this.addIssue('Social links open in the same tab', 'Social', 'Major',
          '1. Add target="_blank" rel="noopener" to all social media links',
          'Browser', 'Clicking a social icon navigates away from the website in the same tab.',
          sameTab.slice(0, 8));
      }
    }

    this.setChecklist('Social media & footer', 'Footer links present', footerLinks.size > 0 ? 'pass' : 'fail');
    if (footerLinks.size === 0) {
      this.addIssue('Footer has no links', 'Footer', 'Major',
        '1. Add site links (About, Services, Privacy Policy, Contact) to the footer',
        'Browser', 'The footer contains no links. Footers should carry site navigation and policy links.');
    }

    // ── Footer completeness: report exactly WHAT is missing ──
    if (this.normalize(this.page.url()) !== this.normalize(this.pages[0].url)) {
      await this.page.goto(this.pages[0].url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await this.page.waitForTimeout(300);
    }
    const footer = await this.page.evaluate(() => {
      const f = document.querySelector('footer') ?? document.querySelector('[class*="footer" i]');
      if (!f) return null;
      const text = (f.textContent ?? '');
      return {
        exists: true,
        hasCopyright: /©|&copy;|copyright/i.test(text),
        hasPhone: /(\+?\d[\d\s\-().]{8,}\d)/.test(text) || !!f.querySelector('a[href^="tel:"]'),
        hasEmail: /[\w.+-]+@[\w-]+\.[\w.]+/.test(text) || !!f.querySelector('a[href^="mailto:"]'),
        hasAddress: /\b\d{1,5}\s+[A-Za-z].{4,40}?,/.test(text) || /address/i.test(text),
      };
    }).catch(() => null);

    const footerHrefs = Array.from(footerLinks.entries());
    const linkMatches = (re: RegExp) => footerHrefs.some(([href, text]) => re.test(text) || re.test(href));
    const hasPrivacy = linkMatches(/privacy/i);
    const hasTerms = linkMatches(/terms|conditions/i);
    const hasContactLink = linkMatches(/contact/i);
    const hasAbout = linkMatches(/about/i);
    const footerSocial = this.pages.some((p) => p.links.some((l) => l.inFooter && SOCIAL_DOMAINS.test(l.href)));

    const missing: string[] = [];
    if (!footer) missing.push('No <footer> section found at all');
    if (!footerSocial) missing.push('Social media icons/links in the footer');
    if (!hasPrivacy) missing.push('Privacy Policy link');
    if (!hasTerms) missing.push('Terms & Conditions link');
    if (!hasContactLink) missing.push('Contact link');
    if (!hasAbout) missing.push('About link');
    if (footer && !footer.hasCopyright) missing.push('Copyright notice (© year company)');
    if (footer && !footer.hasPhone && !footer.hasEmail) missing.push('Contact info (phone or email)');
    if (footer && !footer.hasAddress) missing.push('Business address');

    this.setChecklist('Social media & footer', 'Privacy & terms links in footer', hasPrivacy && hasTerms ? 'pass' : 'fail');
    this.setChecklist('Social media & footer', 'Footer contact info & copyright',
      footer && footer.hasCopyright && (footer.hasPhone || footer.hasEmail) ? 'pass' : 'fail');

    if (missing.length) {
      this.addIssue(`Footer is missing ${missing.length} expected element(s)`, 'Footer', missing.length >= 4 ? 'Critical' : 'Major',
        '1. Add each missing element listed in the details to the footer\n2. Privacy Policy and Terms pages are legally expected on business sites\n3. Show social profiles, contact info and a copyright line',
        'Browser', 'A complete footer should carry social media icons, policy links (Privacy/Terms), contact details, and a copyright notice. The following are missing:',
        missing.map((m) => `MISSING: ${m}`));
      this.log(`📋 Footer is missing: ${missing.join(', ')}`, 'warning');
    } else {
      this.log('✅ Footer is complete (social, policies, contact, copyright).', 'success');
    }
  }

  // ─── Multi-resolution layout testing (EVERY page) ───────────────────────────

  /**
   * Home page is scanned at all six resolutions; every other crawled page is
   * scanned at desktop (1366×768) and mobile (375px), so padding/cut-off
   * problems are reported per page — like a manual tester walking the site.
   */
  private async runResolutionChecks() {
    const PER_PAGE_SIZES = [RESOLUTIONS[2], RESOLUTIONS[5]]; // 1366×768 + Mobile (375px)
    let mobileOk = true;
    let tabletOk = true;
    let desktopHScroll = false;
    const sizeFailed = new Map<string, boolean>();
    let step = 0;
    const totalSteps = RESOLUTIONS.length + Math.max(0, this.pages.length - 1) * PER_PAGE_SIZES.length;

    for (let pi = 0; pi < this.pages.length; pi++) {
      const pageUrl = this.pages[pi].url;
      const pageLabel = (() => { try { return new URL(pageUrl).pathname || '/'; } catch { return pageUrl; } })();
      const sizes = pi === 0 ? RESOLUTIONS : PER_PAGE_SIZES;

      if (this.normalize(this.page.url()) !== this.normalize(pageUrl)) {
        try {
          await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await this.page.waitForTimeout(300);
        } catch { continue; }
      }

      for (const res of sizes) {
        await this.page.setViewportSize({ width: res.width, height: res.height });
        await this.page.waitForTimeout(450);
        // Re-trigger lazy content at this width so the scan and evidence shot
        // reflect what a real visitor sees at this resolution.
        await this.autoScroll();
        this.log(`📐 Scanning ${pageLabel} at ${res.label}...`);
        const scan = await this.scanLayout(res.device !== 'Browser');

        const problems =
          (scan.hasHScroll ? 1 : 0) + scan.overflowing.length + scan.overlaps.length +
          scan.edges.length + scan.cutByHeader.length;
        if (problems > 0) {
          sizeFailed.set(res.label, true);
          if (res.device === 'Mobile') mobileOk = false;
          if (res.device === 'Tablet') tabletOk = false;
          if (res.device === 'Browser' && scan.hasHScroll) desktopHScroll = true;

          // Re-run the scan in MARK mode to draw red outlines + numbered badges
          // on the exact offending elements and scroll the first into view, then
          // capture a FOCUSED viewport screenshot of that problem area.
          await this.scanLayout(res.device !== 'Browser', true);
          await this.page.waitForTimeout(250);
          const evidence = await this.captureScreenshot(false);
          await this.clearMarks();
          const details: string[] = [];
          if (scan.hasHScroll) details.push(`Horizontal scrollbar: document is ${scan.docWidth}px wide vs ${res.width}px viewport`);
          details.push(...scan.cutByHeader.map((o) => `Cut by fixed header: ${o}`));
          details.push(...scan.edges.map((o) => `Missing padding (touches screen edge): ${o}`));
          details.push(...scan.overflowing.map((o) => `Overflow: ${o}`));
          details.push(...scan.overlaps.map((o) => `Overlap: ${o}`));
          details.push(...scan.tinyFonts.map((o) => `Tiny font: ${o}`));
          details.push(...scan.smallTaps.map((o) => `Small tap target: ${o}`));

          const severe = scan.hasHScroll || scan.overlaps.length > 0 || scan.cutByHeader.length > 0;
          this.addIssue(`Layout breaks at ${res.label} — ${pageLabel}`, 'Responsiveness',
            severe ? 'Major' : scan.edges.length || scan.overflowing.length ? 'Major' : 'Minor',
            `1. Open ${pageUrl} at ${res.label}\n2. Fix the elements listed in the details (responsive CSS: max-width, flex-wrap, padding, media queries)\n3. Make sure headings are not hidden behind the fixed header`,
            res.device === 'Browser' ? `Browser ${res.label}` : res.label,
            `At ${res.label}, ${pageLabel} has ${problems} layout problem(s): ${scan.hasHScroll ? 'horizontal scroll, ' : ''}${scan.cutByHeader.length ? scan.cutByHeader.length + ' element(s) cut by the fixed header, ' : ''}${scan.edges.length ? scan.edges.length + ' element(s) touching the screen edge (missing padding), ' : ''}${scan.overflowing.length} overflowing, ${scan.overlaps.length} overlapping.`,
            details.slice(0, 15), `${pageUrl} @ ${res.label}`, evidence);
          this.log(`📐 ${pageLabel} @ ${res.label}: ${problems} problem(s).`, 'warning');
        } else {
          this.log(`✅ ${pageLabel} @ ${res.label}: layout intact.`, 'success');
        }
        step++;
        this.onProgress(80 + Math.round((step / Math.max(1, totalSteps)) * 13));
      }
    }

    for (const res of RESOLUTIONS) {
      this.setChecklist('Responsive / Viewport', `Layout intact at ${res.label}`, sizeFailed.get(res.label) ? 'fail' : 'pass');
    }

    // Scrollbar should appear only if required
    this.setChecklist('Responsive / Viewport', 'Scrollbar only when required', desktopHScroll ? 'fail' : 'pass');
    if (desktopHScroll) {
      this.addIssue('Unnecessary horizontal scrollbar on desktop', 'Responsiveness', 'Major',
        '1. Find elements wider than the viewport (see layout details)\n2. Use max-width: 100% and overflow-x: hidden judiciously',
        'Browser', 'A horizontal scrollbar appears on desktop resolutions. Scroll bars should appear only when required.');
    }

    this.setChecklist('Responsive / Viewport', 'Mobile layout intact (375px)', mobileOk ? 'pass' : 'fail');
    this.setChecklist('Responsive / Viewport', 'Tablet layout intact (768px)', tabletOk ? 'pass' : 'fail');
    this.setChecklist('Responsive / Viewport', 'Viewport meta tag set', this.pages[0].hasViewportMeta ? 'pass' : 'fail');
    if (!this.pages[0].hasViewportMeta) {
      this.addIssue('Viewport meta tag missing', 'Responsiveness', 'Critical',
        '1. Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>',
        'Mobile', 'Without a viewport meta tag, mobile browsers render the desktop layout zoomed out.');
    }

    // Restore desktop viewport
    await this.page.setViewportSize({ width: 1366, height: 768 });
  }

  /**
   * Layout scan of the current page at the current viewport. When `mark` is true
   * it ALSO draws a red outline + a numbered badge on each flagged element (the
   * badge numbers line up with the issue's detail list), so the evidence
   * screenshot points at exactly where each problem is. Outlines/badges are
   * applied AFTER all measurements so they never affect the metrics.
   */
  private async scanLayout(isSmall: boolean, mark = false): Promise<{
    hasHScroll: boolean; docWidth: number; overflowing: string[]; overlaps: string[];
    edges: string[]; cutByHeader: string[]; tinyFonts: string[]; smallTaps: string[];
  }> {
    return this.page.evaluate(({ isSmall, mark }) => {
        const vw = innerWidth;
        // Elements flagged per category, kept parallel to the string arrays so
        // badge N matches detail line N.
        const flOverflow: Element[] = [];
        const flEdge: Element[] = [];
        const flCut: Element[] = [];
        const flOverlap: Element[] = [];
        const flTiny: Element[] = [];
        const flTap: Element[] = [];
        const describe = (el: Element) => {
          const h = el as HTMLElement;
          const id = h.id ? `#${h.id}` : '';
          const cls = typeof h.className === 'string' && h.className.trim() ? '.' + h.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          return `${el.tagName.toLowerCase()}${id}${cls}`;
        };
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const s = getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
        };

        const overflowing: string[] = [];
        const overlaps: string[] = [];
        const edges: string[] = [];
        const cutByHeader: string[] = [];
        const tinyFonts: string[] = [];
        const smallTaps: string[] = [];

        // Fixed/sticky header bar (if any) — content must not start underneath it
        let headerBottom = 0;
        let headerDesc = '';
        for (const h of Array.from(document.querySelectorAll('header, nav, [class*="header" i], [class*="navbar" i]'))) {
          const s = getComputedStyle(h);
          if (s.position !== 'fixed' && s.position !== 'sticky') continue;
          const r = h.getBoundingClientRect();
          if (r.top <= 2 && r.height > 20 && r.height < innerHeight * 0.5 && r.bottom > headerBottom) {
            headerBottom = r.bottom;
            headerDesc = describe(h);
          }
        }

        const all = Array.from(document.querySelectorAll('body *')).slice(0, 2500);
        for (const el of all) {
          if (!visible(el)) continue;
          const r = el.getBoundingClientRect();
          if ((r.right > vw + 4 || r.left < -4) && r.width > 24 && overflowing.length < 10) {
            overflowing.push(`${describe(el)} spans ${Math.round(r.left)}→${Math.round(r.right)}px (viewport ${vw}px)`);
            flOverflow.push(el);
          }
          const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? '').trim()).join(' ').trim();
          // Text flush against the screen edge = missing padding ("content cutting")
          if (ownText && ownText.length > 2 && edges.length < 8 && !el.closest('header, nav, footer')) {
            if (r.left >= 0 && r.left < 3) { edges.push(`${describe(el)} touches the LEFT edge: "${ownText.slice(0, 50)}"`); flEdge.push(el); }
            else if (r.right > vw - 3 && r.right <= vw) { edges.push(`${describe(el)} touches the RIGHT edge: "${ownText.slice(0, 50)}"`); flEdge.push(el); }
          }
          if (isSmall && ownText && tinyFonts.length < 8) {
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs > 0 && fs < 11) { tinyFonts.push(`${describe(el)} renders at ${fs}px: "${ownText.slice(0, 40)}"`); flTiny.push(el); }
          }
        }

        // Headings hidden/cut behind the fixed header bar at the top of the page
        if (headerBottom > 0) {
          for (const h of Array.from(document.querySelectorAll('h1, h2, h3'))) {
            if (!visible(h) || cutByHeader.length >= 5) continue;
            const r = h.getBoundingClientRect();
            if (r.top < headerBottom - 4 && r.bottom > 4 && !h.closest('header, nav')) {
              cutByHeader.push(`${describe(h)} "${(h.textContent ?? '').trim().slice(0, 40)}" starts at ${Math.round(r.top)}px but the fixed header (${headerDesc}) extends to ${Math.round(headerBottom)}px`);
              flCut.push(h);
            }
          }
        }

        // Sibling overlap detection (content overlapping = layout bug)
        const containers = Array.from(document.querySelectorAll('section, div, main, article')).slice(0, 400);
        outer:
        for (const c of containers) {
          const kids = Array.from(c.children).filter((k) => visible(k) && (k.textContent ?? '').trim());
          for (let a = 0; a < kids.length && a < 12; a++) {
            for (let b = a + 1; b < kids.length && b < 12; b++) {
              const ra = kids[a].getBoundingClientRect();
              const rb = kids[b].getBoundingClientRect();
              const xOver = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
              const yOver = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
              if (xOver > 12 && yOver > 12) {
                const sa = getComputedStyle(kids[a]); const sb = getComputedStyle(kids[b]);
                if (sa.position === 'absolute' || sb.position === 'absolute' || sa.position === 'fixed' || sb.position === 'fixed') continue;
                overlaps.push(`${describe(kids[a])} overlaps ${describe(kids[b])} by ${Math.round(xOver)}×${Math.round(yOver)}px`);
                flOverlap.push(kids[a]);
                if (overlaps.length >= 8) break outer;
              }
            }
          }
        }

        if (isSmall) {
          for (const el of Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"]'))) {
            if (!visible(el) || smallTaps.length >= 8) continue;
            const r = el.getBoundingClientRect();
            if ((r.width < 28 || r.height < 28) && (el.textContent ?? '').trim()) {
              smallTaps.push(`${describe(el)} is ${Math.round(r.width)}×${Math.round(r.height)}px: "${(el.textContent ?? '').trim().slice(0, 30)}"`);
              flTap.push(el);
            }
          }
        }

        // ── Mark the flagged elements with red outline boxes (no numbers) ──
        if (mark) {
          const ordered = [...flCut, ...flEdge, ...flOverflow, ...flOverlap, ...flTiny, ...flTap];
          const marked: { el: HTMLElement; prev: string; prevOff: string }[] = [];
          ordered.slice(0, 24).forEach((el) => {
            const h = el as HTMLElement;
            marked.push({ el: h, prev: h.style.outline, prevOff: h.style.outlineOffset });
            h.style.outline = '3px solid #ff2d55';
            h.style.outlineOffset = '1px';
          });
          (window as unknown as { __qaMarked?: typeof marked }).__qaMarked = marked;
          // Scroll the first flagged element to the centre so the focused shot
          // captures that problem area.
          if (ordered[0]) (ordered[0] as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
        }

        const docWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
        return {
          hasHScroll: docWidth > vw + 4,
          docWidth,
          overflowing,
          overlaps,
          edges,
          cutByHeader,
          tinyFonts,
          smallTaps,
        };
      }, { isSmall, mark });
  }

  /** Remove any red outlines + numbered badges applied by scanLayout(mark=true). */
  private async clearMarks(): Promise<void> {
    try {
      await this.page.evaluate(() => {
        document.getElementById('__qaBadges')?.remove(); // legacy, if any
        const w = window as unknown as { __qaMarked?: { el: HTMLElement; prev: string; prevOff?: string }[] };
        (w.__qaMarked ?? []).forEach(({ el, prev, prevOff }) => {
          el.style.outline = prev;
          el.style.outlineOffset = prevOff ?? '';
        });
        delete w.__qaMarked;
      });
    } catch { /* non-fatal */ }
  }

  /**
   * Final pass: for each content/image/link issue, re-open its page, outline the
   * offending element(s) in red with numbered badges, scroll the first one to the
   * centre, and capture a FOCUSED viewport screenshot (not full page) so the
   * evidence shows just the part where the problem is. Replaces that issue's shot.
   */
  private async applyIssueMarks(): Promise<void> {
    // Group by page so we navigate each page once, then mark each issue in turn.
    const byPage = new Map<string, typeof this.pendingMarks>();
    for (const m of this.pendingMarks) {
      const key = this.normalize(m.pageUrl);
      byPage.set(key, [...(byPage.get(key) ?? []), m]);
    }

    for (const [key, marks] of byPage) {
      const page = this.pages.find((p) => this.normalize(p.url) === key);
      if (!page) continue;
      try {
        if (this.normalize(this.page.url()) !== key) {
          await this.page.goto(page.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await this.page.setViewportSize({ width: 1366, height: 768 });
        await this.autoScroll();

        for (const m of marks) {
          const issue = this.issues.find((i) => i.id === m.id);
          if (!issue) continue;
          const marked = await this.page.evaluate((t) => {
            const visible = (el: Element) => {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return false;
              const s = getComputedStyle(el);
              return s.display !== 'none' && s.visibility !== 'hidden';
            };
            const recs: { el: HTMLElement; prev: string; prevOff: string }[] = [];
            const found: HTMLElement[] = [];
            let n = 0;
            const mark = (el: Element | null) => {
              if (!el || n >= 12) return;
              const h = el as HTMLElement;
              if (recs.some((r) => r.el === h)) return;
              recs.push({ el: h, prev: h.style.outline, prevOff: h.style.outlineOffset });
              h.style.outline = '3px solid #ff2d55';
              h.style.outlineOffset = '1px';
              found.push(h);
              n++;
            };

            for (const src of t.imgs) {
              const file = src.split('/').pop() ?? src;
              const img = Array.from(document.images).find(
                (im) => im.currentSrc === src || im.src === src || (file && (im.currentSrc.includes(file) || im.src.includes(file))),
              );
              if (img && visible(img)) mark(img);
            }
            for (const href of t.links) {
              const a = Array.from(document.querySelectorAll('a[href]')).find((x) => (x as HTMLAnchorElement).href === href);
              if (a && visible(a)) mark(a);
            }
            // Selector-based marks (e.g. 'form', 'footer', 'h1', buttons): mark the
            // first few visible matches.
            for (const sel of t.selectors) {
              let matched = 0;
              for (const el of Array.from(document.querySelectorAll(sel))) {
                if (matched >= 4) break;
                if (visible(el)) { mark(el); matched++; }
              }
            }
            const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
            const candidates = Array.from(document.querySelectorAll('p, li, span, a, h1, h2, h3, h4, h5, h6, td, div, button, label'));
            for (const text of t.texts) {
              const needle = norm(text);
              if (!needle) continue;
              let best: Element | null = null;
              for (const el of candidates) {
                if (!visible(el)) continue;
                if (norm(el.textContent ?? '').includes(needle)) {
                  best = el;
                  if (el.children.length === 0 || (el.textContent ?? '').length < 200) break;
                }
              }
              if (!best) {
                const lastWord = needle.split(' ').pop() ?? needle;
                let bestLen = Infinity;
                for (const el of candidates) {
                  if (!visible(el)) continue;
                  const txt = norm(el.textContent ?? '');
                  if (txt.startsWith(lastWord) && txt.length < bestLen) { best = el; bestLen = txt.length; }
                }
              }
              if (best) mark(best);
            }

            (window as unknown as { __qaMarked?: typeof recs }).__qaMarked = recs;
            // Scroll the FIRST flagged element to the centre so the focused shot
            // captures the problem area.
            if (found[0]) found[0].scrollIntoView({ block: 'center', inline: 'nearest' });
            return n;
          }, { imgs: m.imgs, links: m.links, texts: m.texts, selectors: m.selectors });

          if (marked > 0) {
            await this.page.waitForTimeout(250);
            // Focused VIEWPORT screenshot (not full page) — shows just the
            // region around the marked element.
            const buf = await this.page.screenshot({ type: 'jpeg', quality: 72 });
            issue.screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
          }
          await this.clearMarks();
        }
      } catch { /* non-fatal: keep the existing shot for this page */ }
    }
  }

  // ─── Performance & SEO ──────────────────────────────────────────────────────

  private async runPerformanceSeoChecks(home: PageData) {
    // Pages should load within 3 seconds — reported PER PAGE
    const slow = this.pages.filter((p) => p.loadMs > LOAD_BUDGET_MS);
    this.setChecklist('Performance & usability', 'Pages load within 3 seconds', slow.length === 0 ? 'pass' : 'fail');
    for (const p of slow) {
      this.addIssue(`${this.pathLabel(p.url)} loads in ${(p.loadMs / 1000).toFixed(1)}s (budget: 3s)`, 'Performance',
        p.loadMs > 8000 ? 'Critical' : 'Major',
        `1. Open ${p.url} with DevTools → Network\n2. Compress and lazy-load images\n3. Minify/defer JS and CSS\n4. Enable caching/CDN`,
        'Browser', `This page took ${(p.loadMs / 1000).toFixed(1)} seconds to load. Web pages should load within 3 seconds — slow pages drive visitors away.`,
        undefined, p.url);
    }
    if (!slow.length) {
      this.log(`✅ All ${this.pages.length} page(s) loaded under 3s.`, 'success');
    }

    // Image weight via resource timing on the (current) home page
    const perf = await this.page.evaluate(() => {
      const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const imgs = res.filter((r) => r.initiatorType === 'img' || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(r.name));
      const heavy = imgs.filter((r) => r.transferSize > 300 * 1024)
        .map((r) => `${Math.round(r.transferSize / 1024)}KB — ${r.name.split('/').pop()?.slice(0, 60) ?? r.name}`);
      const totalKB = Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024);
      return { heavy: heavy.slice(0, 10), totalKB, imgCount: imgs.length };
    }).catch(() => ({ heavy: [] as string[], totalKB: 0, imgCount: 0 }));

    this.setChecklist('Performance & usability', 'Images optimized', perf.heavy.length === 0 ? 'pass' : 'fail');
    if (perf.heavy.length) {
      const id = this.addIssue(`${perf.heavy.length} oversized image(s)`, 'Performance', 'Major',
        '1. Compress images and serve WebP/AVIF\n2. Resize images to their display dimensions\n3. Lazy-load below-the-fold images',
        'Browser', 'Images larger than 300KB slow down every page load.',
        perf.heavy, home.url);
      // perf.heavy entries are "123KB — filename.jpg" → extract the filename to locate the <img>
      this.registerMarks(id, home.url, { imgs: perf.heavy.map((h) => h.split('—').pop()?.trim() ?? h) });
    }
    this.setChecklist('Performance & usability', 'Page weight reasonable', perf.totalKB === 0 ? 'pending' : perf.totalKB < 3500 ? 'pass' : 'fail');
    if (perf.totalKB >= 3500) {
      this.addIssue('Total page weight is very heavy', 'Performance', 'Major',
        '1. Audit network transfers and trim the heaviest assets',
        'Browser', `The page transfers ~${(perf.totalKB / 1024).toFixed(1)}MB of resources.`);
    }

    // SEO fundamentals — checked on EVERY crawled page, reported PER PAGE so
    // every page gets its own SEO findings with its own screenshot.
    const badTitles = this.pages.filter((p) => {
      const t = p.title.trim();
      return !t || t.length < 10 || t.length > 65;
    });
    this.setChecklist('SEO & meta tags', 'Page title optimized', badTitles.length === 0 ? 'pass' : badTitles.some((p) => !p.title.trim()) ? 'fail' : 'warning');
    for (const p of badTitles) {
      const t = p.title.trim();
      this.addIssue(`Meta title ${t ? 'not optimal' : 'MISSING'} on ${this.pathLabel(p.url)}`, 'SEO',
        t ? 'Major' : 'Critical',
        '1. Give this page a unique <title> of 10–65 characters\n2. Use the "Primary Keyword | Brand" pattern',
        'Browser',
        t
          ? `From an SEO point of view this page's meta title is ${t.length} characters ("${t.slice(0, 60)}") — it should be 10–65 characters.`
          : 'This page has NO meta title at all. Every page needs an optimized title for search results and the browser tab.',
        undefined, p.url);
    }

    const noDesc = this.pages.filter((p) => !p.metaDescription.trim());
    const shortDesc = this.pages.filter((p) => { const d = p.metaDescription.trim(); return d && (d.length < 50 || d.length > 165); });
    this.setChecklist('SEO & meta tags', 'Meta description present', noDesc.length === 0 ? (shortDesc.length ? 'warning' : 'pass') : 'fail');
    for (const p of noDesc) {
      this.addIssue(`Meta description MISSING on ${this.pathLabel(p.url)}`, 'SEO', 'Critical',
        '1. Add <meta name="description" content="…"> (50–160 characters) to this page\n2. Describe the page content with the target keyword',
        'Browser', 'This page has NO meta description — search engines will improvise the snippet, hurting click-through rates.',
        undefined, p.url);
    }
    for (const p of shortDesc) {
      this.addIssue(`Meta description length not optimal on ${this.pathLabel(p.url)}`, 'SEO', 'Major',
        '1. Rewrite this page\'s meta description to 50–160 characters',
        'Browser', `This page's meta description is ${p.metaDescription.trim().length} characters — outside the 50–160 range search engines display.`,
        undefined, p.url);
    }

    const badH1 = this.pages.filter((p) => p.h1Count !== 1);
    this.setChecklist('SEO & meta tags', 'Single H1 per page', badH1.length === 0 ? 'pass' : 'fail');
    for (const p of badH1) {
      const id = this.addIssue(`${p.h1Count === 0 ? 'No H1 heading' : p.h1Count + ' H1 headings'} on ${this.pathLabel(p.url)}`, 'SEO', 'Major',
        '1. Use exactly one H1 on this page stating the page topic\n2. Add an H1 where missing; demote extra H1s to H2',
        'Browser', `This page has ${p.h1Count === 0 ? 'no H1 heading' : p.h1Count + ' H1 headings'}; each page should have exactly one for SEO and accessibility.`,
        undefined, p.url);
      // Mark the H1 elements only when there ARE some (multiple-H1 case).
      if (p.h1Count > 1) this.registerMarks(id, p.url, { selectors: ['h1'] });
    }

    const uglyUrls = this.pages.filter((p) => /[?&](id|p|page)=\d+|_{2,}|%20/i.test(p.url)).map((p) => p.url);
    this.setChecklist('SEO & meta tags', 'Search-friendly URLs', uglyUrls.length === 0 ? 'pass' : 'warning');
    if (uglyUrls.length) {
      this.addIssue('URLs are not search-friendly', 'SEO', 'Minor',
        '1. Use readable, hyphenated slugs instead of query-string IDs',
        'Browser', 'Some page URLs use raw query parameters or encoded characters.',
        uglyUrls.slice(0, 6));
    }
  }

  // ─── Result builder ─────────────────────────────────────────────────────────

  private buildResult(): TestResult {
    const pct = (cat: string) => {
      const items = Object.values(this.checklistStatus[cat] ?? {}).filter((s) => s !== 'pending');
      if (!items.length) return 0.5;
      const score = items.reduce((a, s) => a + (s === 'pass' ? 1 : s === 'warning' ? 0.5 : 0), 0);
      return score / items.length;
    };
    const to100 = (x: number) => Math.min(100, Math.max(0, Math.round(x * 100)));

    const avgLoad = this.pages.length ? this.pages.reduce((a, p) => a + p.loadMs, 0) / this.pages.length : 4000;
    const perfBase = avgLoad < 1200 ? 95 : avgLoad < 2000 ? 88 : avgLoad < 3000 ? 78 : avgLoad < 5000 ? 58 : 40;
    const performance = Math.round((perfBase + to100(pct('Performance & usability'))) / 2);

    const critCount = this.issues.filter((i) => i.severity === 'Critical').length;
    const majorCount = this.issues.filter((i) => i.severity === 'Major').length;
    const minorCount = this.issues.filter((i) => i.severity === 'Minor').length;
    const penalty = Math.min(70, critCount * 12 + majorCount * 5 + Math.round(minorCount * 1.5));

    return {
      mobile: {
        performance,
        accessibility: to100((pct('Images & media') + pct('Buttons & UI') + pct('Forms & validation')) / 3),
        seo: to100(pct('SEO & meta tags')),
        bestPractices: to100((pct('Content & layout') + pct('Branding & header') + pct('Responsive / Viewport')) / 3),
        vitals: {},
      },
      foundData: this.foundData,
      isEstimated: false,
      testingScore: Math.max(10, 100 - penalty),
    };
  }

  // ─── Checklist ──────────────────────────────────────────────────────────────

  private initChecklist(): ChecklistStatus {
    return {
      'Branding & header': {
        'Logo visible and clear': 'pending',
        'Logo navigates to homepage': 'pending',
        'Header menu displayed': 'pending',
        'Menu items visible and clickable': 'pending',
        'Header contact info present': 'pending',
        'Favicon present': 'pending',
        'Page title on every page': 'pending',
      },
      'Navigation & link': {
        'Menu items navigate correctly': 'pending',
        'Home link on every page': 'pending',
        'No broken links': 'pending',
        'External links open in new tab': 'pending',
        'Anchors work correctly': 'pending',
        'Smooth navigation between pages': 'pending',
      },
      'Content & layout': {
        'No spelling errors': 'pending',
        'No grammatical errors': 'pending',
        'Fonts consistent across pages': 'pending',
        'Text properly aligned': 'pending',
        'Lists properly formatted': 'pending',
      },
      'Forms & validation': {
        'Form fields have labels': 'pending',
        'Tooltip text on every field': 'pending',
        'Required fields show error messages': 'pending',
        'Error messages match field labels': 'pending',
        'Error messages spelled correctly': 'pending',
        'Email/phone validation working': 'pending',
        'Form data preserved on error': 'pending',
        'Fields properly aligned': 'pending',
        'Spacing between fields adequate': 'pending',
        'Dropdown data not truncated': 'pending',
        'Confirmation message on submit': 'pending',
      },
      'Buttons & UI': {
        'Buttons standard format and size': 'pending',
        'Button text not truncated': 'pending',
        'Buttons clickable (not overlapped)': 'pending',
        'Buttons aligned properly': 'pending',
        'Keyboard accessible controls': 'pending',
      },
      'Images & media': {
        'No broken images': 'pending',
        'Images have alt text': 'pending',
        'Images load correctly': 'pending',
      },
      'Social media & footer': {
        'Social media links present': 'pending',
        'Social links work correctly': 'pending',
        'Social links open in new tab': 'pending',
        'Footer links present': 'pending',
        'Privacy & terms links in footer': 'pending',
        'Footer contact info & copyright': 'pending',
      },
      'Responsive / Viewport': {
        'Layout intact at 640×480': 'pending',
        'Layout intact at 800×600': 'pending',
        'Layout intact at 1366×768': 'pending',
        'Layout intact at 1920×1080': 'pending',
        'Layout intact at Tablet (768px)': 'pending',
        'Layout intact at Mobile (375px)': 'pending',
        'Scrollbar only when required': 'pending',
        'Mobile layout intact (375px)': 'pending',
        'Tablet layout intact (768px)': 'pending',
        'Viewport meta tag set': 'pending',
      },
      'Performance & usability': {
        'Pages load within 3 seconds': 'pending',
        'Images optimized': 'pending',
        'Page weight reasonable': 'pending',
      },
      'SEO & meta tags': {
        'Page title optimized': 'pending',
        'Meta description present': 'pending',
        'Single H1 per page': 'pending',
        'Search-friendly URLs': 'pending',
      },
    };
  }

  private setChecklist(category: string, item: string, status: 'pass' | 'fail' | 'warning' | 'pending') {
    if (this.checklistStatus[category]?.[item] !== undefined) {
      this.checklistStatus[category][item] = status;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private normalize(url: string): string {
    try {
      const u = new URL(url);
      return u.origin + u.pathname.replace(/\/$/, '');
    } catch { return url; }
  }

  /**
   * For issues that didn't register a specific element but whose category has an
   * obvious on-page region (forms, buttons, footer, social), infer a CSS selector
   * so they still get a focused, marked screenshot of the relevant area instead
   * of no shot. Truly abstract issues (fonts, page weight, meta tags, favicon)
   * are intentionally left without a screenshot — there is no single spot to show.
   */
  private backfillMarksByCategory() {
    const already = new Set(this.pendingMarks.map((m) => m.id));
    const pageOf = (raw: string) => raw.split(' @ ')[0].split(' › ')[0].trim() || this.url;
    for (const issue of this.issues) {
      if (already.has(issue.id) || issue.screenshot) continue; // skip marked or layout(explicit) issues
      const cat = issue.category;
      const name = issue.name.toLowerCase();
      let selectors: string[] | null = null;
      if (cat === 'Forms') {
        selectors = ['form'];
      } else if (cat === 'Buttons' || /button|keyboard/.test(name)) {
        selectors = ['button', '[role="button"]', 'a[class*="btn" i]', 'a[class*="button" i]', 'input[type="submit"]'];
      } else if (cat === 'Footer' || cat === 'Social') {
        selectors = ['footer'];
      } else if (cat === 'Navigation' && /external link/.test(name)) {
        selectors = ['a[target="_blank"]', 'header a, nav a'];
      } else if (cat === 'Navigation' && /anchor/.test(name)) {
        selectors = ['a[href^="#"]'];
      }
      if (selectors) this.registerMarks(issue.id, pageOf(issue.affectedPage), { selectors });
    }
  }

  /** Register an issue's locating elements for the focused marked-evidence pass. */
  private registerMarks(
    id: string,
    pageUrl: string,
    targets: { imgs?: string[]; links?: string[]; texts?: string[]; selectors?: string[] },
  ) {
    this.pendingMarks.push({
      id,
      pageUrl,
      imgs: targets.imgs ?? [],
      links: targets.links ?? [],
      texts: targets.texts ?? [],
      selectors: targets.selectors ?? [],
    });
  }

  /** Human page label for issue titles: "Home page" or the decoded path. */
  private pathLabel(url: string): string {
    try {
      const p = new URL(url).pathname;
      return p === '/' || p === '' ? 'Home page' : decodeURIComponent(p).replace(/\/$/, '');
    } catch { return url; }
  }

  private addIssue(
    name: string,
    category: string,
    severity: 'Critical' | 'Major' | 'Minor',
    steps: string,
    browser: string,
    description: string,
    details?: string[],
    affectedPage?: string,
    screenshot?: string,
  ): string {
    const emoji = severity === 'Critical' ? '🔴' : severity === 'Major' ? '🟡' : '🟢';
    this.log(`${emoji} [${severity}] ${name}`, severity === 'Critical' ? 'error' : severity === 'Major' ? 'warning' : 'info');
    // No shared fallback screenshot: an issue gets EITHER an explicit focused
    // shot (layout) OR a per-issue marked shot filled in by applyIssueMarks (for
    // issues that registered a markable element) OR none at all (abstract issues
    // like font/weight/meta with no single on-page element). This guarantees no
    // two issues share the same generic screenshot.
    const id = String(this.issueCounter++);
    this.issues.push({
      id,
      name,
      category,
      severity,
      steps,
      browser,
      affectedPage: affectedPage ?? this.url,
      status: 'Open',
      description,
      details,
      screenshot: screenshot ?? '',
    });
    return id;
  }

  private log(msg: string, type: LogType = 'info') {
    this.onLog(msg, type);
  }
}
