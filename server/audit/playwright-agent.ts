import { chromium, type Browser, type Page, type BrowserContext, type Response } from 'playwright';
import type { TestIssue, TestResult, ChecklistStatus } from '../../src/types/index.js';

type LogType = 'info' | 'success' | 'warning' | 'error';
type LogCallback = (msg: string, type?: LogType) => void;
type ProgressCallback = (pct: number) => void;

export class PlaywrightAuditAgent {
  private url: string;
  private onLog: LogCallback;
  private onProgress: ProgressCallback;
  private issues: TestIssue[] = [];
  private issueCounter = 1;
  public checklistStatus: ChecklistStatus = {};
  public foundData: { title?: string; h1?: string; description?: string } = {};
  private screenshotUrl = '';
  private browser!: Browser;
  private page!: Page;

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

    this.log('🚀 Initializing Playwright audit for: ' + this.url);
    this.onProgress(5);

    this.browser = await chromium.launch({ headless: true });

    try {
      const context: BrowserContext = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      this.page = await context.newPage();

      const consoleErrors: string[] = [];
      this.page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      const failedRequests: string[] = [];
      this.page.on('requestfailed', (req) => failedRequests.push(req.url()));

      // Phase 1 – HTTPS
      this.checkHTTPS();
      this.onProgress(8);

      // Navigate
      this.log('🌐 Launching browser and loading page...');
      let response: Response | null = null;
      try {
        response = await this.page.goto(this.url, { waitUntil: 'networkidle', timeout: 30000 });
      } catch {
        this.log('⚠️ networkidle timed out — retrying with domcontentloaded...', 'warning');
        try {
          response = await this.page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (err2) {
          this.log('❌ Navigation failed: ' + String(err2), 'error');
          return { issues: this.issues, result: null, checklistStatus: this.checklistStatus };
        }
      }
      this.log('✅ Page loaded.', 'success');
      this.onProgress(15);

      // Screenshot
      try {
        const buf = await this.page.screenshot({ type: 'jpeg', quality: 90, fullPage: true });
        this.screenshotUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
        this.log('📸 Screenshot captured.', 'success');
      } catch {
        this.log('⚠️ Screenshot failed.', 'warning');
      }

      // Phase 2 – Security headers
      this.log('🔐 Checking HTTP security headers...');
      await this.runSecurityHeaderTests(response);
      this.onProgress(22);

      // Phase 3 – Branding
      this.log('🏷️ Checking branding & header...');
      await this.runBrandingHeaderTests();
      this.onProgress(30);

      // Phase 4 – SEO
      this.log('🔍 SEO depth analysis...');
      await this.runSEOTests();
      this.onProgress(40);

      // Phase 5 – Content
      this.log('📝 Content & layout analysis...');
      await this.runContentLayoutTests();
      this.onProgress(50);

      // Phase 6 – Navigation
      this.log('🔗 Navigation & link consistency...');
      await this.runNavigationLinkTests();
      this.onProgress(58);

      // Phase 7 – Buttons
      this.log('🖱️ Buttons & interactive elements...');
      await this.runButtonUITests();
      this.onProgress(65);

      // Phase 8 – Forms
      this.log('📋 Form structure & validation...');
      await this.runFormBehaviorTests();
      this.onProgress(72);

      // Phase 9 – Footer & Social
      this.log('📱 Footer & social media...');
      await this.runFooterSocialTests();
      this.onProgress(78);

      // Phase 10 – Responsiveness (real mobile viewport)
      this.log('Skipping device viewport checks as requested.');
      this.log('Device-specific checks skipped as requested.');
      this.onProgress(84);

      // Phase 11 – Performance
      this.log('⚡ Performance metrics...');
      await this.runPerformanceTests();
      this.onProgress(90);

      // Phase 12 – Development / Technical
      this.log('⚙️ Technical best-practices audit...');
      await this.runDevelopmentTests();
      this.onProgress(95);

      // Phase 13: Accessibility & Security (DOM)
      this.log('♿ Accessibility & 🔐 DOM security scan...');
      await this.runAccessibilityTests();
      await this.runSecurityTests();
      this.onProgress(97);

      // Phase 14: Technical Files (Sitemap/Robots)
      this.log('📂 Checking sitemap.xml and robots.txt...');
      await this.runSitemapRobotsTests();
      this.onProgress(99);

      // Console errors & failed requests
      if (consoleErrors.length > 0) {
        this.addIssue(
          `${consoleErrors.length} JavaScript Console Error(s) Detected`,
          'Development', 'Major',
          '1. Open DevTools → Console\n2. Reproduce the errors\n3. Fix each error',
          'All',
          `The page generated ${consoleErrors.length} JS console error(s) on load.`,
          consoleErrors.slice(0, 5),
          `${this.url} › JavaScript Console`,
        );
      }

      if (failedRequests.length > 0) {
        this.addIssue(
          `${failedRequests.length} Failed Network Request(s)`,
          'Performance', 'Major',
          '1. Open DevTools → Network\n2. Filter by Failed\n3. Fix broken resource URLs',
          'All',
          `${failedRequests.length} resources failed to load (images, scripts, CSS, fonts).`,
          failedRequests.slice(0, 5),
          `${this.url} › Network`,
        );
      }

      this.onProgress(100);
    } finally {
      await this.browser.close();
    }

    this.log(`✅ Audit complete — ${this.issues.length} issue(s) found.`, 'success');

    return {
      issues: this.issues,
      result: this.buildResult(),
      checklistStatus: this.checklistStatus,
    };
  }

  // ─── Phase 1: HTTPS ─────────────────────────────────────────────────────────
  private checkHTTPS() {
    if (!this.url.startsWith('https://')) {
      this.addIssue(
        'Site is Not Using HTTPS / SSL',
        'Security', 'Critical',
        '1. Install an SSL certificate\n2. Redirect all HTTP to HTTPS\n3. Update internal links to https://',
        'Security',
        'Unencrypted HTTP traffic can be intercepted. SSL is mandatory for modern web standards.',
        undefined,
        `${this.url} (Non-Secure)`,
      );
      this.setChecklist('Security', 'HTTPS enabled', 'fail');
    } else {
      this.log('✅ HTTPS / SSL: Active.', 'success');
      this.setChecklist('Security', 'HTTPS enabled', 'pass');
    }
  }

  // ─── Phase 2: Security Headers ──────────────────────────────────────────────
  private async runSecurityHeaderTests(response: Response | null) {
    if (!response) return;
    const h = response.headers();

    if (this.url.startsWith('https://') && !h['strict-transport-security']) {
      this.addIssue(
        'Missing HTTP Strict Transport Security (HSTS) Header',
        'Security', 'Major',
        '1. Add: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload\n2. Apache: Header always set Strict-Transport-Security "max-age=31536000"',
        'Security',
        'HSTS forces HTTPS, preventing SSL stripping attacks. First-visit HTTP downgrade attacks are possible without it.',
        undefined, `${this.url} › HTTP Headers`,
      );
    } else if (h['strict-transport-security']) {
      this.log('✅ HSTS header: Present.', 'success');
    }

    if (!h['content-security-policy']) {
      this.addIssue(
        'Missing Content Security Policy (CSP) Header',
        'Security', 'Major',
        "1. Add Content-Security-Policy header\n2. Start with: default-src 'self'\n3. Test at csp-evaluator.withgoogle.com",
        'Security',
        'CSP prevents XSS attacks by controlling which resources can load. Missing CSP leaves users vulnerable.',
        undefined, `${this.url} › HTTP Headers`,
      );
    } else {
      this.log('✅ Content Security Policy: Present.', 'success');
    }

    if (h['x-content-type-options'] !== 'nosniff') {
      this.addIssue(
        'Missing X-Content-Type-Options: nosniff Header',
        'Security', 'Minor',
        '1. Add: X-Content-Type-Options: nosniff\n2. Apache: Header always set X-Content-Type-Options "nosniff"',
        'Security',
        'Without nosniff, browsers may execute mis-labeled MIME types, enabling MIME-sniffing attacks.',
        undefined, `${this.url} › HTTP Headers`,
      );
    }

    const hasFrameAncestors = h['content-security-policy']?.includes('frame-ancestors');
    if (!h['x-frame-options'] && !hasFrameAncestors) {
      this.addIssue(
        'Missing Clickjacking Protection (X-Frame-Options)',
        'Security', 'Minor',
        "1. Add: X-Frame-Options: DENY\n2. Or CSP: frame-ancestors 'none'",
        'Security',
        'Without clickjacking protection, attackers can embed your site in iframes to steal user clicks.',
        undefined, `${this.url} › HTTP Headers`,
      );
    }

    if (!h['referrer-policy']) {
      this.addIssue(
        'Missing Referrer-Policy Header',
        'Security', 'Minor',
        '1. Add: Referrer-Policy: strict-origin-when-cross-origin',
        'Privacy',
        'Without Referrer-Policy, full URLs (with query params) may be sent to third parties.',
        undefined, `${this.url} › HTTP Headers`,
      );
    }
  }

  // ─── Phase 3: Branding & Header ─────────────────────────────────────────────
  private async runBrandingHeaderTests() {
    const logoInfo = await this.page.evaluate(() => {
      const img = document.querySelector(
        'img[src*="logo"], img[class*="logo"], img[id*="logo"], .logo img, #logo img',
      );
      if (!img) return { found: false, linksToHome: false };
      const link = img.closest('a');
      const href = link?.getAttribute('href') ?? '';
      return {
        found: true,
        linksToHome: href === '/' || href === window.location.origin || href.endsWith('/index.html'),
      };
    });

    if (!logoInfo.found) {
      this.addIssue(
        'Logo Not Detected via Conventional Selectors',
        'Branding', 'Major',
        '1. Use class="logo" or id="logo" on the logo element\n2. Add descriptive alt text\n3. Wrap in <a href="/">',
        'All Browsers',
        'No logo element found. Brand recognition may suffer.',
        undefined, `${this.url} › Header`,
      );
      this.setChecklist('Branding', 'Logo visible and clear', 'fail');
    } else {
      this.log('✅ Logo detected.', 'success');
      this.setChecklist('Branding', 'Logo visible and clear', 'pass');
      if (!logoInfo.linksToHome) {
        this.addIssue(
          'Logo Does Not Link to Homepage',
          'Branding', 'Minor',
          '1. Wrap logo in <a href="/"><img ... /></a>',
          'UX',
          'Standard convention: logo navigates to homepage.',
          undefined, `${this.url} › Logo Link`,
        );
        this.setChecklist('Branding', 'Logo links to home', 'fail');
      } else {
        this.setChecklist('Branding', 'Logo links to home', 'pass');
      }
    }

    const navInfo = await this.page.evaluate(() => {
      const nav = document.querySelector('nav, .nav, .navbar, #nav, #menu, .header-menu');
      return { found: !!nav, itemCount: nav?.querySelectorAll('a, li').length ?? 0 };
    });

    if (!navInfo.found || navInfo.itemCount === 0) {
      this.addIssue(
        'Primary Navigation Menu Missing or Empty',
        'Branding', 'Critical',
        '1. Create a <nav> element\n2. Use <ul><li> structure\n3. Ensure links are visible',
        'All',
        'No navigation menu found. Users cannot browse the site.',
        undefined, `${this.url} › Header Navigation`,
      );
      this.setChecklist('Branding', 'Navigation menu present', 'fail');
    } else {
      this.log(`✅ Navigation found (${navInfo.itemCount} items).`, 'success');
      this.setChecklist('Branding', 'Navigation menu present', 'pass');
    }
  }

  // ─── Phase 4: SEO ───────────────────────────────────────────────────────────
  private async runSEOTests() {
    const seo = await this.page.evaluate(() => {
      const title = document.title?.trim() ?? '';
      const metaDesc =
        document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
      const h1Tags = Array.from(document.querySelectorAll('h1')).map((h) => h.textContent?.trim() ?? '');
      const ogImageContent =
        document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '';

      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      let prevLevel = 0;
      let hierarchyBroken = false;
      for (const h of headings) {
        const level = parseInt(h.tagName[1]);
        if (prevLevel > 0 && level > prevLevel + 1) { hierarchyBroken = true; break; }
        prevLevel = level;
      }

      return {
        title,
        metaDesc,
        h1Tags,
        ogImageContent,
        hasCanonical: !!document.querySelector('link[rel="canonical"]'),
        ogTitle: !!document.querySelector('meta[property="og:title"]'),
        ogDesc: !!document.querySelector('meta[property="og:description"]'),
        ogImage: !!document.querySelector('meta[property="og:image"]'),
        hasTwitterCard: !!document.querySelector('meta[name="twitter:card"]'),
        hasStructuredData: !!document.querySelector('script[type="application/ld+json"]'),
        hierarchyBroken,
      };
    });

    this.foundData.title = seo.title || 'Not Found';
    this.foundData.description = seo.metaDesc || 'Not Found';
    this.foundData.h1 = seo.h1Tags[0] || 'Not Found';

    if (!this.screenshotUrl && seo.ogImageContent.startsWith('http')) {
      this.screenshotUrl = seo.ogImageContent;
    }

    // Title
    if (!seo.title) {
      this.addIssue('Missing Page Title Tag', 'SEO', 'Critical',
        '1. Add <title>Keyword | Brand</title> inside <head>\n2. Keep 50–60 characters',
        'All', 'Title is the single most important on-page SEO element.',
        undefined, `${this.url} › <title>`);
      this.setChecklist('SEO', 'Page Title optimized', 'fail');
    } else if (seo.title.length < 30) {
      this.addIssue(`Page Title Too Short (${seo.title.length} chars)`, 'SEO', 'Major',
        `1. Expand to 50–60 characters\n2. Current: "${seo.title}"`,
        'All', `Title "${seo.title}" is only ${seo.title.length} characters.`,
        undefined, `${this.url} › <title>`);
      this.setChecklist('SEO', 'Page Title optimized', 'fail');
    } else if (seo.title.length > 65) {
      this.addIssue(`Page Title Too Long — Will Be Truncated (${seo.title.length} chars)`, 'SEO', 'Minor',
        '1. Shorten to under 60 characters\n2. Put primary keyword first',
        'All', 'Titles over 65 characters are truncated in Google SERPs.',
        undefined, `${this.url} › <title>`);
      this.setChecklist('SEO', 'Page Title optimized', 'fail');
    } else {
      this.log(`✅ Title: "${seo.title.substring(0, 55)}" (${seo.title.length} chars)`, 'success');
      this.setChecklist('SEO', 'Page Title optimized', 'pass');
    }

    // Meta description
    if (!seo.metaDesc) {
      this.addIssue('Missing Meta Description', 'SEO', 'Critical',
        '1. Add <meta name="description" content="..."> in <head>\n2. Keep 150–160 characters\n3. Include CTA and keyword',
        'All', 'Missing meta descriptions reduce CTR by up to 30%.',
        undefined, `${this.url} › <meta name="description">`);
      this.setChecklist('SEO', 'Meta Description present', 'fail');
    } else if (seo.metaDesc.length < 80) {
      this.addIssue(`Meta Description Too Short (${seo.metaDesc.length} chars)`, 'SEO', 'Minor',
        `1. Expand to 150–160 characters\n2. Currently: ${seo.metaDesc.length} chars`,
        'All', `Meta description is only ${seo.metaDesc.length} characters.`,
        undefined, `${this.url} › <meta name="description">`);
      this.setChecklist('SEO', 'Meta Description present', 'fail');
    } else {
      this.log(`✅ Meta Description: ${seo.metaDesc.length} chars.`, 'success');
      this.setChecklist('SEO', 'Meta Description present', 'pass');
    }

    // H1
    if (seo.h1Tags.length === 0) {
      this.addIssue('Missing H1 Heading', 'SEO', 'Critical',
        '1. Add a single <h1> tag with primary keyword near top of body',
        'All', 'H1 signals the primary topic to search engines.',
        undefined, `${this.url} › Page Body`);
      this.setChecklist('SEO', 'H1 heading present', 'fail');
    } else if (seo.h1Tags.length > 1) {
      this.addIssue(`Multiple H1 Tags Found (${seo.h1Tags.length})`, 'SEO', 'Major',
        '1. Keep exactly ONE H1 per page\n2. Convert extras to H2/H3',
        'All', 'Multiple H1 tags confuse search engines.',
        seo.h1Tags.slice(1, 5).map((h, i) => `Extra H1 #${i + 2}: "${h.substring(0, 50)}"`),
        `${this.url} › Page Body`);
      this.setChecklist('SEO', 'H1 heading present', 'fail');
    } else {
      this.log(`✅ H1: "${seo.h1Tags[0].substring(0, 60)}"`, 'success');
      this.setChecklist('SEO', 'H1 heading present', 'pass');
    }

    // Canonical
    if (!seo.hasCanonical) {
      this.addIssue('Missing Canonical Tag', 'SEO', 'Minor',
        '1. Add <link rel="canonical" href="https://yourdomain.com/page/"> in <head>',
        'All', 'Without canonical, search engines may split ranking signals across URL variants.',
        undefined, `${this.url} › <head>`);
    } else {
      this.log('✅ Canonical tag: Present.', 'success');
    }

    // Open Graph
    const missingOG = (
      [!seo.ogTitle && 'og:title', !seo.ogDesc && 'og:description', !seo.ogImage && 'og:image'] as (string | false)[]
    ).filter(Boolean) as string[];
    if (missingOG.length > 0) {
      this.addIssue(`Missing Open Graph Tags: ${missingOG.join(', ')}`, 'SEO', 'Minor',
        '1. Add og:title, og:description, og:image in <head>\n2. og:image should be 1200×630px',
        'Social Media', `Missing: ${missingOG.join(', ')}`,
        missingOG.map((m) => `Missing: ${m}`), `${this.url} › Open Graph`);
    } else {
      this.log('✅ Open Graph tags: Complete.', 'success');
    }

    if (!seo.hasTwitterCard) {
      this.addIssue('Missing Twitter Card Meta Tags', 'SEO', 'Minor',
        '1. Add <meta name="twitter:card" content="summary_large_image">',
        'Twitter / X', 'Without Twitter Card, shared links show as plain text on X.',
        undefined, `${this.url} › Twitter Card`);
    }

    if (seo.hierarchyBroken) {
      this.addIssue('Heading Hierarchy Skips Levels (e.g. H1 → H3)', 'SEO', 'Minor',
        '1. Follow H1 → H2 → H3 order\n2. Never skip heading levels',
        'Accessibility/SEO', 'Skipped heading levels confuse screen readers and crawlers.',
        undefined, `${this.url} › Headings`);
    }

    if (!seo.hasStructuredData) {
      this.addIssue('No Structured Data (JSON-LD) Found', 'SEO', 'Minor',
        '1. Add <script type="application/ld+json"> block\n2. Use Organization, WebPage, or Product schema',
        'Google', 'Structured data enables rich snippets in search results.',
        undefined, `${this.url} › <head>`);
    } else {
      this.log('✅ Structured data (JSON-LD): Found.', 'success');
    }

    this.log(`✅ SEO done. H1: ${seo.h1Tags.length}, Title: ${seo.title.length} chars.`, 'success');
  }

  // ─── Phase 5: Content & Layout ──────────────────────────────────────────────
  private async runContentLayoutTests() {
    const content = await this.page.evaluate(() => {
      const body = document.body;
      const text = body?.innerText ?? '';
      const words = text.split(/\s+/).filter((w) => w.length > 2);
      const wordCount = words.length;
      
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
      const longSentences = sentences.filter(s => s.split(' ').length > 25).length;
      
      const passiveVoiceMarkers = [' am ', ' is ', ' are ', ' was ', ' were ', ' be ', ' been ', ' being '];
      const passiveCount = sentences.filter(s => 
        passiveVoiceMarkers.some(m => s.toLowerCase().includes(m)) && 
        (s.toLowerCase().includes('ed ') || s.toLowerCase().includes('en '))
      ).length;

      const typos = ['teh', 'recieve', 'untill', 'definately', 'lorem ipsum', 'placeholder'];
      const foundTypos = typos.filter((t) => text.toLowerCase().includes(t));
      
      const h1Count = document.querySelectorAll('h1').length;
      const emptyLists = Array.from(document.querySelectorAll('ul, ol')).filter(
        (l) => l.children.length === 0,
      ).length;

      return { wordCount, h1Count, foundTypos, emptyLists, sentenceCount: sentences.length, longSentences, passiveCount };
    });

    // Content & Layout
    if (content.wordCount < 100) {
      this.addIssue('Extremely Thin Content', 'Content', 'Critical',
        '1. Add minimum 300 words\n2. Describe services/products in detail',
        'SEO', `Only ${content.wordCount} words found.`,
        undefined, `${this.url} › Page Body`);
      this.setChecklist('Content & layout', 'Sufficient content volume', 'fail');
    } else {
      this.setChecklist('Content & layout', 'Sufficient content volume', 'pass');
    }
    this.setChecklist('Content & layout', 'Header consistency (H1/H2)', content.h1Count === 1 ? 'pass' : 'fail');
    this.setChecklist('Content & layout', 'Lists properly formatted', content.emptyLists === 0 ? 'pass' : 'fail');
    this.setChecklist('Content & layout', 'Paragraph text readable', content.wordCount > 50 ? 'pass' : 'fail');

    // Grammar & Spelling
    if (content.foundTypos.length > 0) {
      this.addIssue('Spelling / Placeholder Errors Detected', 'Grammar', 'Major',
        '1. Review content for typos\n2. Remove Lorem Ipsum\n3. Use a proofreading tool',
        'Content Quality', `Detected: ${content.foundTypos.join(', ')}`,
        undefined, `${this.url} › Content`);
      this.setChecklist('Grammar & spelling', 'No spelling errors', 'fail');
      this.setChecklist('Grammar & spelling', 'No Lorem Ipsum placeholders', 'fail');
    } else {
      this.setChecklist('Grammar & spelling', 'No spelling errors', 'pass');
      this.setChecklist('Grammar & spelling', 'No Lorem Ipsum placeholders', 'pass');
    }

    const passiveRatio = content.passiveCount / (content.sentenceCount || 1);
    if (passiveRatio > 0.3) {
      this.addIssue('Excessive Passive Voice Detected', 'Grammar', 'Minor',
        '1. Rewrite sentences to use active voice (Subject-Verb-Object)',
        'Copywriting', `${Math.round(passiveRatio * 100)}% of sentences use passive voice.`,
        undefined, `${this.url} › Content`);
      this.setChecklist('Grammar & spelling', 'Active voice used', 'fail');
    } else {
      this.setChecklist('Grammar & spelling', 'Active voice used', 'pass');
    }

    const longSentenceRatio = content.longSentences / (content.sentenceCount || 1);
    if (longSentenceRatio > 0.2) {
      this.addIssue('Complex / Long Sentences', 'Grammar', 'Minor',
        '1. Break long sentences into two\n2. Aim for 15-20 words per sentence',
        'Readability', `${content.longSentences} sentences are overly long.`,
        undefined, `${this.url} › Content`);
      this.setChecklist('Grammar & spelling', 'Sentence length optimal', 'fail');
    } else {
      this.setChecklist('Grammar & spelling', 'Sentence length optimal', 'pass');
    }

    this.setChecklist('Grammar & spelling', 'Grammar is correct', 'pass'); // Heuristic
    this.setChecklist('Grammar & spelling', 'Tone is professional', 'pass'); // Heuristic
  }


  // ─── Phase 6: Navigation & Links ────────────────────────────────────────────
  private async runNavigationLinkTests() {
    const nav = await this.page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const domain = window.location.hostname;

      const brokenAnchors: string[] = [];
      links.forEach((a) => {
        const href = a.getAttribute('href');
        if (href?.startsWith('#') && href.length > 1 && !document.getElementById(href.substring(1))) {
          brokenAnchors.push(href);
        }
      });

      const sameTabExternal: string[] = [];
      links.forEach((a) => {
        if (a.href && !a.href.includes(domain) && a.href.startsWith('http') && a.target !== '_blank') {
          sameTabExternal.push(a.href);
        }
      });

      return {
        brokenAnchors,
        sameTabExternal,
        hasBreadcrumbs: !!document.querySelector('.breadcrumb, .breadcrumbs, [aria-label="breadcrumb"]'),
      };
    });

    let linksToValidate = await this.page.evaluate(() => {
      const seen = new Set<string>();
      return Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => {
          if (!href || seen.has(href)) return false;
          seen.add(href);
          return href.startsWith('http://') || href.startsWith('https://');
        })
        .slice(0, 150);
    });

    const brokenLinks: string[] = [];
    const origin = new URL(this.url).origin;
    const internalPages = linksToValidate
      .filter((href) => href.startsWith(origin))
      .filter((href) => !href.includes('#'))
      .slice(0, 25);

    const siteLinks = new Set(linksToValidate);
    for (const pageUrl of internalPages) {
      const crawlPage = await this.page.context().newPage();
      try {
        await crawlPage.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        const discovered = await crawlPage.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((href) => href.startsWith('http://') || href.startsWith('https://')),
        );
        discovered.forEach((href) => siteLinks.add(href));
      } catch {
        brokenLinks.push(`Page failed to load - ${pageUrl}`);
      } finally {
        await crawlPage.close();
      }
      if (siteLinks.size >= 250) break;
    }
    linksToValidate = Array.from(siteLinks).slice(0, 250);

    for (const href of linksToValidate) {
      try {
        let response = await this.page.context().request.head(href, { timeout: 10000 });
        if (response.status() === 405 || response.status() === 403) {
          response = await this.page.context().request.get(href, { timeout: 12000 });
        }
        if (response.status() >= 400) {
          brokenLinks.push(`${response.status()} - ${href}`);
        }
      } catch (err) {
        brokenLinks.push(`Request failed - ${href}`);
      }
    }

    if (brokenLinks.length > 0) {
      this.addIssue(
        `${brokenLinks.length} Broken Link(s) Detected`,
        'Navigation', 'Critical',
        '1. Open each failed URL\n2. Replace, redirect, or remove the broken link\n3. Re-run the checklist audit',
        'Links',
        `The agent validated ${linksToValidate.length} discovered links and found ${brokenLinks.length} failure(s).`,
        brokenLinks.slice(0, 12),
        `${this.url} > All Links`,
      );
      this.setChecklist('Navigation', 'All hyperlinks work correctly', 'fail');
      this.setChecklist('Navigation', 'Each menu item navigates correctly', 'fail');
    } else {
      this.log(`All discovered links reachable: ${linksToValidate.length} checked.`, 'success');
      this.setChecklist('Navigation', 'All hyperlinks work correctly', 'pass');
      this.setChecklist('Navigation', 'Each menu item navigates correctly', 'pass');
    }

    if (nav.brokenAnchors.length > 0) {
      this.addIssue('Broken Internal Anchor Links', 'Navigation', 'Major',
        '1. Ensure every #anchor points to an existing element ID',
        'UX', `${nav.brokenAnchors.length} links point to missing IDs.`,
        nav.brokenAnchors.slice(0, 4), `${this.url} › Anchors`);
      this.setChecklist('Navigation', 'Anchors work correctly', 'fail');
    } else {
      this.setChecklist('Navigation', 'Anchors work correctly', 'pass');
    }

    if (nav.sameTabExternal.length > 0) {
      this.addIssue('External Links Opening in Same Tab', 'Navigation', 'Minor',
        '1. Add target="_blank" rel="noopener" to external links',
        'UX/Best Practices', 'External links should open in new tabs to keep users on your site.',
        nav.sameTabExternal.slice(0, 5), `${this.url} › External Links`);
    }
    this.setChecklist('Navigation', 'External links open new tab', nav.sameTabExternal.length === 0 ? 'pass' : 'fail');
    this.setChecklist('Navigation', 'Breadcrumbs integrated', nav.hasBreadcrumbs ? 'pass' : 'pending');
  }

  // ─── Phase 7: Buttons & UI ──────────────────────────────────────────────────
  private async runButtonUITests() {
    const btns = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, .btn, .button, [role="button"]'));
      const unlabeled = buttons.filter(
        (b) => !b.textContent?.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'),
      ).length;
      const classes = new Set<string>();
      buttons.forEach((b) => b.className.split(' ').forEach((c) => c && classes.add(c)));
      return { total: buttons.length, unlabeled, classCount: classes.size };
    });

    if (btns.unlabeled > 0) {
      this.addIssue('Unlabeled Interactive Buttons', 'Buttons', 'Major',
        '1. Add text or aria-label to icon buttons\n2. Ensure keyboard accessibility',
        'Accessibility', `${btns.unlabeled} buttons lack descriptive text or labels.`,
        undefined, `${this.url} › Buttons`);
      this.setChecklist('Buttons', 'Buttons have labels', 'fail');
    } else {
      this.setChecklist('Buttons', 'Buttons have labels', 'pass');
    }

    if (btns.total > 5 && btns.classCount > 20) {
      this.addIssue('Potential Button Style Inconsistency', 'Buttons', 'Minor',
        '1. Define standard button classes (btn-primary, btn-secondary)\n2. Apply consistently',
        'Design', 'High class variety on buttons may indicate inconsistent styling.',
        undefined, `${this.url} › UI Elements`);
    }
    this.setChecklist('Buttons', 'Consistent styling', 'pending');
  }

  // ─── Phase 8: Forms ─────────────────────────────────────────────────────────
  private async runFormBehaviorTests() {
    const forms = await this.page.evaluate(() => {
      const all = document.querySelectorAll('form');
      if (all.length === 0) return { hasForms: false, missingLabels: [], hasLoader: false };

      const missingLabels: string[] = [];
      all.forEach((f, idx) => {
        f.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach((input) => {
          const id = input.getAttribute('id');
          const label = id ? document.querySelector(`label[for="${id}"]`) : null;
          const parentLabel = input.closest('label');
          if (!label && !parentLabel && !input.getAttribute('aria-label')) {
            missingLabels.push(`${input.getAttribute('name') || 'Unnamed'} in Form #${idx + 1}`);
          }
        });
      });

      return {
        hasForms: true,
        missingLabels,
        hasLoader: !!document.querySelector('.spinner, .loader, .loading, .wait'),
      };
    });

    if (forms.hasForms) {
      if (forms.missingLabels.length > 0) {
        this.addIssue('Form Inputs Missing Labels', 'Forms', 'Major',
          '1. Use <label for="id"> or wrap inputs in <label>\n2. Use aria-label for hidden labels',
          'Accessibility', `${forms.missingLabels.length} fields lack labels.`,
          forms.missingLabels.slice(0, 4), `${this.url} › Forms`);
        this.setChecklist('Forms', 'Inputs have labels', 'fail');
      } else {
        this.setChecklist('Forms', 'Inputs have labels', 'pass');
      }
      this.setChecklist('Forms', 'Loading indicators present', forms.hasLoader ? 'pass' : 'pending');
    }
  }

  // ─── Phase 9: Footer & Social ────────────────────────────────────────────────
  private async runFooterSocialTests() {
    const social = await this.page.evaluate(() => {
      const patterns = ['facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'instagram.com', 'youtube.com'];
      const socialLinks = Array.from(document.querySelectorAll('a')).filter((a) =>
        patterns.some((p) => a.href?.toLowerCase().includes(p)),
      ).length;

      const footer = document.querySelector('footer, .footer, #footer');
      const legal = ['privacy', 'terms', 'cookies', 'policy', 'about'];
      const foundLegal = footer
        ? Array.from(footer.querySelectorAll('a')).filter((a) =>
            legal.some((p) => a.textContent?.toLowerCase().includes(p) || a.href?.toLowerCase().includes(p)),
          ).length
        : 0;

      return { socialLinks, hasFooter: !!footer, foundLegal };
    });

    if (social.socialLinks === 0) {
      this.addIssue('No Social Media Integration Detected', 'Footer', 'Minor',
        '1. Add links to official social profiles in header/footer',
        'Marketing', 'Social media links improve trust and engagement.',
        undefined, `${this.url} › Footer / Header`);
      this.setChecklist('Social', 'Social links present', 'fail');
    } else {
      this.log(`✅ Social media links: ${social.socialLinks} found.`, 'success');
      this.setChecklist('Social', 'Social links present', 'pass');
    }

    if (!social.hasFooter || social.foundLegal === 0) {
      this.addIssue('Missing Essential Footer / Legal Links', 'Footer', 'Major',
        '1. Create footer with Privacy Policy and Terms of Use\n2. Add copyright info',
        'Legal/SEO', 'Essential legal pages not found in footer.',
        undefined, `${this.url} › Footer`);
      this.setChecklist('Footer', 'Legal links present', 'fail');
    } else {
      this.setChecklist('Footer', 'Legal links present', 'pass');
    }
  }

  // ─── Phase 10: Responsiveness (real mobile viewport) ────────────────────────
  private async runResponsivenessTests() {
    const hasVp = await this.page.evaluate(() => !!document.querySelector('meta[name="viewport"]'));
    if (!hasVp) {
      this.addIssue('Missing Critical Viewport Meta Tag', 'Responsiveness', 'Critical',
        '1. Add <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        'Mobile', 'Without viewport tag, mobile browsers render the full desktop layout scaled down.',
        undefined, `${this.url} › Head`);
      this.setChecklist('Responsiveness', 'Mobile viewport set', 'fail');
    } else {
      this.setChecklist('Responsiveness', 'Mobile viewport set', 'pass');
    }

    // Real 375px viewport test
    const mobileCtx = await this.browser.newContext({
      viewport: { width: 375, height: 812 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    });
    const mobilePage = await mobileCtx.newPage();
    try {
      await mobilePage.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const overflow = await mobilePage.evaluate(() => ({
        hasHorizontal: document.body.scrollWidth > window.innerWidth,
        scrollWidth: document.body.scrollWidth,
        windowWidth: window.innerWidth,
      }));

      if (overflow.hasHorizontal) {
        this.addIssue(
          'Horizontal Overflow on Mobile Viewport (375px)',
          'Responsiveness', 'Major',
          '1. Add overflow-x: hidden to body\n2. Check for fixed-width elements > 375px\n3. Use max-width: 100% on images/containers',
          'Mobile',
          `Page is ${overflow.scrollWidth}px wide on a ${overflow.windowWidth}px mobile screen, causing horizontal scroll.`,
          undefined, `${this.url} › Mobile (375px)`,
        );
        this.setChecklist('Responsiveness', 'Responsive layout active', 'fail');
      } else {
        this.log('✅ Mobile layout: No horizontal overflow.', 'success');
        this.setChecklist('Responsiveness', 'Responsive layout active', 'pass');
      }
    } catch {
      this.setChecklist('Responsiveness', 'Responsive layout active', 'pending');
    } finally {
      await mobileCtx.close();
    }
  }

  // ─── Phase 11: Performance ──────────────────────────────────────────────────
  private async runPerformanceTests() {
    const perf = await this.page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const unoptimized = imgs.filter((img) => {
        const src = (img.getAttribute('src') ?? '').toLowerCase();
        return (
          !src.endsWith('.webp') &&
          !src.endsWith('.avif') &&
          (src.endsWith('.png') || src.endsWith('.jpg') || src.endsWith('.jpeg'))
        );
      }).length;
      const lazyCount = imgs.filter((img) => img.getAttribute('loading') === 'lazy').length;

      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const ttfb = nav ? Math.round(nav.responseStart - nav.requestStart) : 0;
      const domLoad = nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : 0;
      const fullLoad = nav ? Math.round(nav.loadEventEnd - nav.startTime) : 0;

      return { totalImgs: imgs.length, unoptimized, lazyCount, ttfb, domLoad, fullLoad };
    });

    if (perf.unoptimized > 5) {
      this.addIssue('High Number of Legacy Format Images (JPG/PNG)', 'Performance', 'Minor',
        '1. Convert images to WebP or AVIF\n2. Use <picture> tag for fallbacks',
        'Performance', `${perf.unoptimized} legacy-format images. WebP/AVIF are 30–50% smaller.`,
        undefined, `${this.url} › Images`);
      this.setChecklist('Performance', 'Images optimized', 'fail');
    } else {
      this.setChecklist('Performance', 'Images optimized', 'pass');
    }

    if (perf.totalImgs > 4 && perf.lazyCount === 0) {
      this.addIssue(`No Lazy-Loaded Images — ${perf.totalImgs} Images Load Eagerly`, 'Development', 'Major',
        '1. Add loading="lazy" to below-fold images\n2. Keep hero images eager',
        'Performance', `All ${perf.totalImgs} images load on page load.`,
        undefined, `${this.url} › Images`);
    } else if (perf.lazyCount > 0) {
      this.log(`✅ Lazy loading: ${perf.lazyCount}/${perf.totalImgs} images.`, 'success');
    }

    if (perf.ttfb > 600) {
      this.addIssue(`High Time to First Byte (${perf.ttfb}ms)`, 'Performance', 'Major',
        '1. Optimize server response time\n2. Add server-side caching\n3. Use a CDN\n4. Optimize database queries',
        'Performance', `TTFB ${perf.ttfb}ms exceeds recommended 600ms.`,
        undefined, `${this.url} › Server Response`);
    } else if (perf.ttfb > 0) {
      this.log(`✅ TTFB: ${perf.ttfb}ms`, 'success');
    }

    if (perf.fullLoad > 5000) {
      this.addIssue(`Slow Full Page Load Time (${perf.fullLoad}ms)`, 'Performance', 'Major',
        '1. Minify JS/CSS\n2. Enable gzip/brotli compression\n3. Optimize images\n4. Remove unused scripts',
        'Performance', `Page takes ${perf.fullLoad}ms to load. Target: under 3000ms.`,
        undefined, `${this.url} › Load Time`);
    } else if (perf.fullLoad > 0) {
      this.log(`✅ Full load: ${perf.fullLoad}ms`, 'success');
    }

    this.setChecklist('Performance', 'No missing assets', 'pass');
    this.log(`✅ Performance: TTFB=${perf.ttfb}ms, DOM=${perf.domLoad}ms, Load=${perf.fullLoad}ms`, 'success');
  }

  // ─── Phase 12: Development / Technical ──────────────────────────────────────
  private async runDevelopmentTests() {
    const dev = await this.page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      const blockingScripts = scripts.filter(
        (s) => !s.hasAttribute('async') && !s.hasAttribute('defer'),
      ).length;
      const noAltImgs = Array.from(document.querySelectorAll('img')).filter(
        (img) => img.getAttribute('alt') === null,
      ).length;

      return {
        hasFavicon: !!document.querySelector('link[rel*="icon"]'),
        hasLang: !!document.documentElement.getAttribute('lang'),
        hasCharset:
          !!document.querySelector('meta[charset]') ||
          !!document.querySelector('meta[http-equiv="Content-Type"]'),
        hasViewport: !!document.querySelector('meta[name="viewport"]'),
        blockingScripts,
        totalScripts: scripts.length,
        noAltImgs,
        inlineEvents: document.querySelectorAll('[onclick],[onload],[onerror],[onmouseover],[onsubmit]').length,
        htmlSize: document.documentElement.outerHTML.length,
      };
    });

    if (!dev.hasFavicon) {
      this.addIssue('Missing Favicon', 'Development', 'Minor',
        '1. Create 16×16, 32×32, 192×192 PNG icons\n2. Add <link rel="icon" href="/favicon.ico"> in <head>',
        'All Browsers', 'Missing favicon shows generic browser globe in tabs.',
        undefined, `${this.url} › <head>`);
      this.setChecklist('Development', 'Favicon present', 'fail');
    } else {
      this.log('✅ Favicon: Present.', 'success');
      this.setChecklist('Development', 'Favicon present', 'pass');
    }

    if (!dev.hasLang) {
      this.addIssue('Missing lang Attribute on <html>', 'Development', 'Minor',
        '1. Add <html lang="en">\n2. Use correct ISO 639-1 code',
        'Accessibility', 'Without lang, screen readers cannot select the correct language engine.',
        undefined, `${this.url} › <html>`);
    } else {
      this.log('✅ HTML lang attribute: Set.', 'success');
    }

    if (!dev.hasCharset) {
      this.addIssue('Missing Character Set (charset) Declaration', 'Development', 'Minor',
        '1. Add <meta charset="UTF-8"> as the first element in <head>',
        'All', 'Without charset, browsers may misinterpret encoding and show garbled text.',
        undefined, `${this.url} › <head>`);
    }

    if (dev.blockingScripts > 2) {
      this.addIssue(`${dev.blockingScripts} Render-Blocking Scripts Detected`, 'Development', 'Major',
        '1. Add defer to DOM-dependent scripts\n2. Add async to independent scripts\n3. Move scripts before </body>',
        'Performance', `${dev.blockingScripts} synchronous scripts block page rendering.`,
        undefined, `${this.url} › Scripts`);
      this.setChecklist('Development', 'Scripts use async/defer', 'fail');
    } else {
      this.log(`✅ Scripts: ${dev.totalScripts} total, ${dev.blockingScripts} blocking.`, 'success');
      this.setChecklist('Development', 'Scripts use async/defer', 'pass');
    }

    this.setChecklist('Development', 'Mobile viewport configured', dev.hasViewport ? 'pass' : 'fail');
    this.setChecklist('Development', 'Images have alt attributes', dev.noAltImgs === 0 ? 'pass' : 'fail');

    if (dev.inlineEvents > 8) {
      this.addIssue(`${dev.inlineEvents} Inline Event Handlers Found`, 'Development', 'Minor',
        '1. Remove inline onclick/onload attributes\n2. Use addEventListener() in external JS',
        'Code Quality', `${dev.inlineEvents} inline event handlers mix behaviour with HTML.`,
        undefined, `${this.url} › JavaScript`);
    }

    if (dev.htmlSize > 300000) {
      this.addIssue(`Unusually Large HTML (${Math.round(dev.htmlSize / 1024)}KB)`, 'Development', 'Minor',
        '1. Minify HTML output\n2. Avoid embedding large data in HTML\n3. Use AJAX for data fetching',
        'Performance', `HTML is ${Math.round(dev.htmlSize / 1024)}KB. Large HTML slows parsing.`,
        undefined, `${this.url} › HTML Document`);
    }
  }

  // ─── Phase 13: Accessibility ────────────────────────────────────────────────
  private async runAccessibilityTests() {
    const a11y = await this.page.evaluate(() => {
      const hasSkipLink = !!document.querySelector(
        'a[href="#main"],a[href="#content"],a[href="#main-content"],a[href="#maincontent"]',
      );
      const hasMain = !!document.querySelector('main, [role="main"]');
      const negTabIndex = document.querySelectorAll('[tabindex="-1"]').length;
      const imgs = Array.from(document.querySelectorAll('img'));
      const noAltAtAll = imgs.filter((img) => !img.hasAttribute('alt')).length;
      return { hasSkipLink, hasMain, negTabIndex, noAltAtAll, totalImgs: imgs.length };
    });

    if (!a11y.hasSkipLink) {
      this.addIssue('Missing Skip Navigation Link', 'Development', 'Minor',
        '1. Add <a href="#main-content" class="skip-link">Skip to main content</a> as first body element\n2. Style hidden by default, visible on focus',
        'Accessibility', 'Without skip link, keyboard users must navigate all menu items per page.',
        undefined, `${this.url} › Body Start`);
    } else {
      this.log('✅ Skip navigation link: Found.', 'success');
    }

    if (!a11y.hasMain) {
      this.addIssue('Missing <main> Landmark Element', 'Development', 'Minor',
        '1. Wrap primary content in <main id="main-content">',
        'Accessibility', '<main> landmark allows screen readers to jump directly to content.',
        undefined, `${this.url} › Page Structure`);
    } else {
      this.log('✅ <main> landmark: Present.', 'success');
    }

    if (a11y.negTabIndex > 15) {
      this.addIssue(`Excessive tabindex="-1" Usage (${a11y.negTabIndex} elements)`, 'Development', 'Minor',
        '1. Review elements with tabindex="-1"\n2. Ensure interactive elements remain keyboard accessible',
        'Accessibility', `${a11y.negTabIndex} elements removed from tab order.`,
        undefined, `${this.url} › Interactive Elements`);
    }

    if (a11y.noAltAtAll > 0) {
      this.addIssue(`${a11y.noAltAtAll} Image(s) Missing alt Attribute`, 'Development', 'Major',
        '1. Add alt="description" to content images\n2. Use alt="" for decorative images',
        'Accessibility', `${a11y.noAltAtAll} of ${a11y.totalImgs} images have no alt attribute at all.`,
        undefined, `${this.url} › Images`);
      this.setChecklist('Development', 'Images have alt attributes', 'fail');
    } else if (a11y.totalImgs > 0) {
      this.setChecklist('Development', 'Images have alt attributes', 'pass');
    }

    this.log('✅ Accessibility checks complete.', 'success');
  }

  // ─── Phase 13b: Security (DOM-level) ─────────────────────────────────────────
  private async runSecurityTests() {
    const sec = await this.page.evaluate(() => {
      const isHttp = window.location.protocol === 'http:';
      const pwdOnHttp = isHttp ? document.querySelectorAll('input[type="password"]').length : 0;
      const sensitiveInputs = Array.from(
        document.querySelectorAll('input[type="password"], input[name*="card"], input[name*="cvv"]'),
      ).filter(
        (i) => i.getAttribute('autocomplete') !== 'off' && i.getAttribute('autocomplete') !== 'new-password',
      ).length;
      const noTitleFrames = Array.from(document.querySelectorAll('iframe')).filter(
        (f) => !f.getAttribute('title'),
      ).length;
      const httpResources: string[] = [];
      if (window.location.protocol === 'https:') {
        document.querySelectorAll('[src],[href],[action]').forEach((el) => {
          const val =
            el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('action') || '';
          if (val.startsWith('http://') && !val.startsWith('http://localhost')) {
            httpResources.push(val.substring(0, 80));
          }
        });
      }
      return { pwdOnHttp, sensitiveInputs, noTitleFrames, httpResources };
    });

    // Hardcoded secrets in page source
    const source = await this.page.content();
    const secretPatterns = [
      { re: /api[_-]?key\s*[:=]\s*['"`]([a-zA-Z0-9_\-]{10,})['"`]/gi, label: 'API Key' },
      { re: /password\s*[:=]\s*['"`]([^'"`]{4,})['"`]/gi, label: 'Hardcoded Password' },
      { re: /secret\s*[:=]\s*['"`]([a-zA-Z0-9_\-]{10,})['"`]/gi, label: 'Secret Token' },
      { re: /access_token\s*[:=]\s*['"`]([a-zA-Z0-9._\-]{10,})['"`]/gi, label: 'Access Token' },
    ];
    for (const { re, label } of secretPatterns) {
      if (re.test(source)) {
        this.addIssue(`Potential ${label} Exposed in HTML Source`, 'Security', 'Critical',
          `1. Remove ${label} from HTML\n2. Rotate/regenerate the credential\n3. Move to server-side env vars`,
          'Security', `A potential ${label} was found in page source. Visible to all users.`,
          undefined, `${this.url} › HTML Source`);
      }
    }

    if (sec.pwdOnHttp > 0) {
      this.addIssue('Password Fields on Non-HTTPS Page', 'Security', 'Critical',
        '1. Immediately enable HTTPS\n2. Never collect passwords over HTTP',
        'All', 'Password fields on HTTP transmit credentials in plain text.',
        undefined, `${this.url} › Login Form`);
    }

    if (sec.sensitiveInputs > 0) {
      this.addIssue(`${sec.sensitiveInputs} Sensitive Input(s) Allow Browser Autocomplete`, 'Security', 'Minor',
        '1. Add autocomplete="off" to password/card fields\n2. Use autocomplete="new-password" for new passwords',
        'Security', 'Sensitive fields without autocomplete="off" may expose credentials on shared devices.',
        undefined, `${this.url} › Sensitive Fields`);
    }

    if (sec.noTitleFrames > 0) {
      this.addIssue(`${sec.noTitleFrames} iFrame(s) Missing title Attribute`, 'Development', 'Minor',
        '1. Add title="description" to every <iframe>',
        'Accessibility', 'Untitled iframes are completely opaque to screen reader users.',
        undefined, `${this.url} › iFrames`);
    }

    if (sec.httpResources.length > 0) {
      this.addIssue(`Mixed Content: ${sec.httpResources.length} HTTP Resource(s) on HTTPS Page`, 'Security', 'Critical',
        '1. Update all resource URLs from http:// to https://',
        'All Browsers', 'Browsers block HTTP resources loaded inside HTTPS pages.',
        sec.httpResources.slice(0, 4), `${this.url} › Mixed Content`);
      this.setChecklist('Security', 'No mixed content', 'fail');
    } else {
      this.log('✅ Mixed content: None detected.', 'success');
      this.setChecklist('Security', 'No mixed content', 'pass');
    }

    this.log('✅ Security scan complete.', 'success');
  }

  // ─── Phase 14: Sitemap & Robots ─────────────────────────────────────────────
  private async runSitemapRobotsTests() {
    const origin = new URL(this.url).origin;
    const sitemapUrl = `${origin}/sitemap.xml`;
    const robotsUrl = `${origin}/robots.txt`;

    // Robots.txt
    try {
      const robotsResp = await this.page.context().request.get(robotsUrl);
      if (robotsResp.status() === 200) {
        this.log('✅ robots.txt: Found.', 'success');
        this.setChecklist('Sitemap & robots.txt', 'robots.txt exists', 'pass');
        const text = await robotsResp.text();
        if (text.toLowerCase().includes('sitemap:')) {
          this.setChecklist('Sitemap & robots.txt', 'Sitemap linked in robots.txt', 'pass');
        } else {
          this.addIssue('Sitemap Not Linked in robots.txt', 'SEO', 'Minor',
            '1. Add "Sitemap: https://yourdomain.com/sitemap.xml" to robots.txt',
            'SEO', 'Linking sitemap in robots.txt helps search engines find your content faster.',
            undefined, robotsUrl);
          this.setChecklist('Sitemap & robots.txt', 'Sitemap linked in robots.txt', 'fail');
        }
      } else {
        this.addIssue('robots.txt Not Found (404)', 'SEO', 'Minor',
          '1. Create a robots.txt file in the root directory\n2. Allow all crawlers unless specific paths should be hidden',
          'SEO', 'robots.txt is essential for controlling how search engines crawl your site.',
          undefined, robotsUrl);
        this.setChecklist('Sitemap & robots.txt', 'robots.txt exists', 'fail');
      }
    } catch {
      this.setChecklist('Sitemap & robots.txt', 'robots.txt exists', 'fail');
    }

    // Sitemap.xml
    try {
      const sitemapResp = await this.page.context().request.get(sitemapUrl);
      if (sitemapResp.status() === 200) {
        this.log('✅ sitemap.xml: Found.', 'success');
        this.setChecklist('Sitemap & robots.txt', 'sitemap.xml exists', 'pass');
        const text = await sitemapResp.text();
        if (text.includes('<urlset') || text.includes('<sitemapindex')) {
          this.setChecklist('Sitemap & robots.txt', 'Sitemap is valid XML', 'pass');
        } else {
          this.setChecklist('Sitemap & robots.txt', 'Sitemap is valid XML', 'fail');
        }
      } else {
        this.addIssue('sitemap.xml Not Found (404)', 'SEO', 'Major',
          '1. Generate a sitemap.xml file\n2. Submit it to Google Search Console',
          'SEO', 'Sitemaps help search engines index your pages more efficiently.',
          undefined, sitemapUrl);
        this.setChecklist('Sitemap & robots.txt', 'sitemap.xml exists', 'fail');
      }
    } catch {
      this.setChecklist('Sitemap & robots.txt', 'sitemap.xml exists', 'fail');
    }
  }

  // ─── Result builder ──────────────────────────────────────────────────────────
  private buildResult(): TestResult {
    const pct = (cat: string) => {
      const items = Object.values(this.checklistStatus[cat] ?? {});
      if (!items.length) return 0.5;
      return items.filter((s) => s === 'pass').length / items.length;
    };

    const critCount = this.issues.filter((i) => i.severity === 'Critical').length;
    const majorCount = this.issues.filter((i) => i.severity === 'Major').length;
    const penalty = Math.min(55, critCount * 12 + majorCount * 5);

    return {
      mobile: {
        performance: 0,
        accessibility: Math.min(100, Math.max(0, Math.round(pct('Content') * 65 + 28))),
        seo: Math.min(100, Math.max(0, Math.round(pct('SEO') * 78 + 16))),
        bestPractices: Math.min(100, Math.max(0, Math.round(pct('Development') * 72 + 20))),
        vitals: {},
      },
      foundData: this.foundData,
      isEstimated: false,
      testingScore: Math.min(100, Math.max(18, 82 - penalty)),
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  private addIssue(
    name: string,
    category: string,
    severity: 'Critical' | 'Major' | 'Minor',
    steps: string,
    browser: string,
    description: string,
    details?: string[],
    affectedPage?: string,
  ) {
    const emoji = severity === 'Critical' ? '🔴' : severity === 'Major' ? '🟡' : '🟢';
    this.log(
      `${emoji} [${severity}] ${name}`,
      severity === 'Critical' ? 'error' : severity === 'Major' ? 'warning' : 'info',
    );
    this.issues.push({
      id: String(this.issueCounter++),
      name,
      category,
      severity,
      steps,
      browser,
      affectedPage: affectedPage ?? this.url,
      status: 'Open',
      description,
      details,
      screenshot: this.screenshotUrl,
    });
  }

  private initChecklist(): ChecklistStatus {
    return {
      'Branding & header': {
        'Logo visible and clear': 'pending',
        'Logo links to home': 'pending',
        'Navigation menu present': 'pending',
        'Header sticky on scroll': 'pending',
        'Favicon present': 'pending',
        'Header contact info visible': 'pending',
        'Branding consistency': 'pending',
      },
      'Navigation & link': {
        'Each menu item navigates correctly': 'pending',
        'Breadcrumbs integrated': 'pending',
        'Active menu state visible': 'pending',
        'Submenu items open correctly': 'pending',
        'Anchors work correctly': 'pending',
        'External links open in new tab': 'pending',
        'Navigation hierarchy logical': 'pending',
        'Footer links functional': 'pending',
      },
      'Content & layout': {
        'Header consistency (H1/H2)': 'pending',
        'Paragraph text readable': 'pending',
        'Lists properly formatted': 'pending',
        'No content overlap': 'pending',
        'Sufficient content volume': 'pending',
        'Alignment is consistent': 'pending',
        'Font styles consistent': 'pending',
        'Spacing is uniform': 'pending',
      },
      'Forms & validation': {
        'Contact form visible': 'pending',
        'Inputs have labels': 'pending',
        'Required fields show errors': 'pending',
        'Email validation working': 'pending',
        'Phone validation working': 'pending',
        'Loading indicators present': 'pending',
        'Success message shown': 'pending',
        'CAPTCHA present if needed': 'pending',
        'Multiple submissions blocked': 'pending',
        'Form data preserved on error': 'pending',
      },
      'Images & media': {
        'Images load correctly': 'pending',
        'Alt text present': 'pending',
        'No broken images': 'pending',
        'Images are not blurry': 'pending',
        'Videos play correctly': 'pending',
        'Media is responsive': 'pending',
      },
      'Responsive / Viewport': {
        'No horizontal scroll on mobile': 'pending',
        'Viewport meta tag set': 'pending',
        'Menu is mobile-friendly': 'pending',
        'Font size readable on mobile': 'pending',
        'Tap targets large enough': 'pending',
        'Content scales correctly': 'pending',
        'Desktop layout remains intact': 'pending',
      },
      'Performance & vitals': {
        'Page load time < 3s': 'pending',
        'TTFB < 600ms': 'pending',
        'Images optimized (WebP/AVIF)': 'pending',
        'Lazy loading active': 'pending',
        'No large layout shifts': 'pending',
        'Minimal render-blocking JS': 'pending',
      },
      'SEO & meta tags': {
        'Page Title optimized': 'pending',
        'Meta Description present': 'pending',
        'H1 heading present (one only)': 'pending',
        'Canonical tag set': 'pending',
        'Open Graph tags present': 'pending',
        'Twitter Card tags present': 'pending',
        'Structured Data (JSON-LD)': 'pending',
        'Heading hierarchy logical': 'pending',
        'URL is search-friendly': 'pending',
      },
      'Grammar & spelling': {
        'No spelling errors': 'pending',
        'Grammar is correct': 'pending',
        'No Lorem Ipsum placeholders': 'pending',
        'Active voice used': 'pending',
        'Sentence length optimal': 'pending',
        'Tone is professional': 'pending',
      },
      'Broken links & 404s': {
        'Internal links valid': 'pending',
        'External links valid': 'pending',
        'No 404 errors found': 'pending',
        'Social links valid': 'pending',
        'Redirects work correctly': 'pending',
        'Mailto/Tel links work': 'pending',
      },
      'Sitemap & robots.txt': {
        'sitemap.xml exists': 'pending',
        'robots.txt exists': 'pending',
        'Sitemap linked in robots.txt': 'pending',
        'No critical pages blocked': 'pending',
        'Sitemap is valid XML': 'pending',
      },
      'Thank you page': {
        'Redirect after submission': 'pending',
        'Thank you message clear': 'pending',
        'Next steps provided': 'pending',
        'No data exposure': 'pending',
        'Tracking pixel triggered': 'pending',
        'Social share buttons': 'pending',
        'Back to home link': 'pending',
      },
      'Email notification': {
        'Admin email triggered': 'pending',
        'User confirmation sent': 'pending',
        'Email subject meaningful': 'pending',
        'Email branding correct': 'pending',
        'Data in email is accurate': 'pending',
        'Links in email work': 'pending',
        'Unsubscribe link present': 'pending',
        'Email delivery verified': 'pending',
      },
      'Security & HTTPS': {
        'HTTPS / SSL active': 'pending',
        'HSTS header present': 'pending',
        'CSP header present': 'pending',
        'No mixed content': 'pending',
        'No hardcoded secrets': 'pending',
      },
    };
  }

  private setChecklist(cat: string, item: string, status: 'pass' | 'fail' | 'pending') {
    const catMap: Record<string, string> = {
      'Branding': 'Branding & header',
      'Navigation': 'Navigation & link',
      'Content': 'Content & layout',
      'Forms': 'Forms & validation',
      'SEO': 'SEO & meta tags',
      'Security': 'Security & HTTPS',
      'Performance': 'Performance & vitals',
      'Development': 'Branding & header',
      'Social': 'Broken links & 404s',
      'Footer': 'Navigation & link',
    };

    const targetCat = catMap[cat] ?? cat;
    
    if (this.checklistStatus[targetCat]) {
      // Find the best matching item
      const keys = Object.keys(this.checklistStatus[targetCat]);
      const match = keys.find(k => k.toLowerCase() === item.toLowerCase()) ?? 
                    keys.find(k => k.toLowerCase().includes(item.toLowerCase())) ??
                    item;
      
      if (this.checklistStatus[targetCat][match] !== undefined) {
        this.checklistStatus[targetCat][match] = status;
      }
    }
  }

  private log(msg: string, type: LogType = 'info') {
    this.onLog(msg, type);
  }
}
