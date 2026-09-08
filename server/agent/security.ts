import type { AuditContext } from './types.js';

/** Common misconfiguration / accidental-exposure paths. HEAD only, flag only real hits. */
const SENSITIVE_PATHS = [
  '/.git/config', '/.env', '/.env.local', '/.env.production', '/.htaccess',
  '/wp-config.php.bak', '/config.php.bak', '/.DS_Store', '/backup.zip',
  '/db.sql', '/database.sql', '/phpinfo.php', '/server-status', '/.svn/entries',
];

/**
 * Non-invasive security review of the audited site: HTTPS, security headers,
 * mixed content, cookie flags, version disclosure, and a small probe for
 * common accidentally-exposed files. No fuzzing, no auth, no payloads — just
 * reads what the server already returns. Files issues + rates the Security
 * checklist directly.
 */
export async function securityScan(ctx: AuditContext): Promise<string> {
  const { report } = ctx;
  const set = (item: string, s: 'pass' | 'fail' | 'warning' | 'pending') => report.setChecklist('Security', item, s);
  const root = ctx.rootUrl || ctx.page.url();
  const u = new URL(root);
  const findings: string[] = [];

  // ── HTTPS ────────────────────────────────────────────────────────────────
  const isHttps = u.protocol === 'https:';
  set('Served over HTTPS', isHttps ? 'pass' : 'fail');
  if (!isHttps) {
    report.addIssue('Site is not served over HTTPS', 'Security', 'Critical',
      '1. Install a TLS certificate (Let\'s Encrypt is free)\n2. Serve all pages over https://\n3. Redirect http:// to https://',
      'Browser', 'The site loads over plain HTTP. All traffic — including form data — is sent unencrypted and can be read or modified in transit.',
      undefined, root);
    findings.push('no HTTPS');
  }

  // ── HTTP → HTTPS redirect ────────────────────────────────────────────────
  try {
    const httpResp = await ctx.context.request.get(`http://${u.host}${u.pathname}`, { timeout: 9000, maxRedirects: 0 });
    const loc = httpResp.headers()['location'] ?? '';
    const redirects = httpResp.status() >= 300 && httpResp.status() < 400 && /^https:/i.test(loc);
    set('HTTP redirects to HTTPS', redirects ? 'pass' : isHttps ? 'fail' : 'pending');
    if (isHttps && !redirects) {
      report.addIssue('HTTP is not redirected to HTTPS', 'Security', 'Major',
        '1. Add a 301 redirect from http:// to https:// for every path at the web-server / CDN level',
        'Browser', `Requesting the site over http:// returns status ${httpResp.status()} without redirecting to https://. Visitors who type the bare domain stay on an insecure connection.`,
        [`http://${u.host}/ → ${httpResp.status()}${loc ? ` (Location: ${loc})` : ''}`], root);
      findings.push('no HTTP→HTTPS redirect');
    }
  } catch {
    set('HTTP redirects to HTTPS', 'pending');
  }

  // ── Response headers ─────────────────────────────────────────────────────
  let headers: Record<string, string> = {};
  try {
    const resp = await ctx.context.request.get(root, { timeout: 12000 });
    headers = Object.fromEntries(Object.entries(resp.headers()).map(([k, v]) => [k.toLowerCase(), v]));
  } catch { /* keep empty */ }

  const has = (h: string) => !!headers[h]?.trim();

  set('HSTS header set', has('strict-transport-security') ? 'pass' : isHttps ? 'fail' : 'pending');
  if (isHttps && !has('strict-transport-security')) {
    report.addIssue('Missing HSTS header', 'Security', 'Major',
      '1. Send: Strict-Transport-Security: max-age=31536000; includeSubDomains\n2. Only after confirming every subdomain works over HTTPS',
      'Browser', 'No Strict-Transport-Security header. Browsers will still try http:// first on the next visit, leaving a window for downgrade attacks.',
      undefined, root);
    findings.push('no HSTS');
  }

  set('Content-Security-Policy set', has('content-security-policy') ? 'pass' : 'fail');
  if (!has('content-security-policy')) {
    report.addIssue('No Content-Security-Policy', 'Security', 'Major',
      '1. Add a Content-Security-Policy header\n2. Start in report-only mode, then enforce\n3. At minimum restrict script-src and object-src',
      'Browser', 'No Content-Security-Policy header. A CSP is the main defence against cross-site scripting (XSS) and data-injection attacks.',
      undefined, root);
    findings.push('no CSP');
  }

  const clickjack = has('x-frame-options') || /frame-ancestors/i.test(headers['content-security-policy'] ?? '');
  set('Clickjacking protection set', clickjack ? 'pass' : 'fail');
  if (!clickjack) {
    report.addIssue('No clickjacking protection', 'Security', 'Major',
      '1. Send X-Frame-Options: DENY (or SAMEORIGIN)\n2. Or a CSP frame-ancestors directive',
      'Browser', 'Neither X-Frame-Options nor a CSP frame-ancestors directive is set. The site can be embedded in a hidden iframe on an attacker page (clickjacking).',
      undefined, root);
    findings.push('no anti-clickjacking');
  }

  set('X-Content-Type-Options nosniff', /nosniff/i.test(headers['x-content-type-options'] ?? '') ? 'pass' : 'fail');
  if (!/nosniff/i.test(headers['x-content-type-options'] ?? '')) {
    report.addIssue('Missing X-Content-Type-Options: nosniff', 'Security', 'Minor',
      '1. Send X-Content-Type-Options: nosniff on all responses',
      'Browser', 'Without nosniff, browsers may MIME-sniff responses and execute a non-script file as script.',
      undefined, root);
  }

  // ── Version disclosure ───────────────────────────────────────────────────
  const server = headers['server'] ?? '';
  const powered = headers['x-powered-by'] ?? '';
  const leaks = /\d/.test(server) || !!powered || /wordpress|drupal|joomla/i.test(headers['x-generator'] ?? '');
  set('Server/tech version not disclosed', leaks ? 'warning' : 'pass');
  if (leaks) {
    report.addIssue('Server / technology version disclosed in headers', 'Security', 'Minor',
      '1. Remove or blank the Server, X-Powered-By and X-Generator headers at the web-server / framework level',
      'Browser', 'Response headers reveal the exact server and framework versions, which helps an attacker target known CVEs.',
      [server && `Server: ${server}`, powered && `X-Powered-By: ${powered}`, headers['x-generator'] && `X-Generator: ${headers['x-generator']}`].filter(Boolean) as string[],
      root);
    findings.push('version disclosure');
  }

  // ── Mixed content ────────────────────────────────────────────────────────
  if (isHttps) {
    const mixed: string[] = await ctx.page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('script[src], link[href], img[src], iframe[src], source[src], video[src], audio[src]').forEach((el) => {
        const src = (el.getAttribute('src') || el.getAttribute('href') || '');
        if (/^http:\/\//i.test(src)) out.push(`${el.tagName.toLowerCase()} ← ${src}`);
      });
      return out.slice(0, 15);
    }).catch(() => []);
    set('No mixed (http) content', mixed.length === 0 ? 'pass' : 'fail');
    if (mixed.length) {
      report.addIssue('Mixed content — HTTPS page loads http:// resources', 'Security', 'Major',
        '1. Change every http:// asset URL to https:// (or a protocol-relative //)\n2. Add: Content-Security-Policy: upgrade-insecure-requests',
        'Browser', `${mixed.length} resource(s) are loaded over insecure http:// on an https:// page. Browsers block or downgrade these and it breaks the padlock.`,
        mixed, root);
      findings.push(`${mixed.length} mixed-content`);
    }
  } else {
    set('No mixed (http) content', 'pending');
  }

  // ── Cookies ──────────────────────────────────────────────────────────────
  try {
    const cookies = await ctx.context.cookies();
    const bad = cookies.filter((c) => !c.secure || !c.httpOnly);
    set('Cookies Secure + HttpOnly', cookies.length === 0 ? 'pending' : bad.length === 0 ? 'pass' : 'warning');
    if (bad.length) {
      report.addIssue('Cookies missing Secure / HttpOnly flags', 'Security', 'Major',
        '1. Set Secure on every cookie (HTTPS-only)\n2. Set HttpOnly on session/auth cookies (blocks JS theft)\n3. Set SameSite=Lax or Strict',
        'Browser', `${bad.length} cookie(s) lack Secure and/or HttpOnly. Those can be stolen over an insecure hop or via XSS.`,
        bad.slice(0, 10).map((c) => `${c.name}: ${[c.secure ? '' : 'no Secure', c.httpOnly ? '' : 'no HttpOnly', c.sameSite && c.sameSite !== 'None' ? '' : 'weak SameSite'].filter(Boolean).join(', ')}`),
        root);
      findings.push(`${bad.length} weak cookies`);
    }
  } catch {
    set('Cookies Secure + HttpOnly', 'pending');
  }

  // ── Insecure form action ────────────────────────────────────────────────
  const httpForms: string[] = await ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll('form[action]'))
      .map((f) => f.getAttribute('action') || '')
      .filter((a) => /^http:\/\//i.test(a)).slice(0, 8)).catch(() => []);
  if (httpForms.length) {
    report.addIssue('Form submits over insecure http://', 'Security', 'Critical',
      '1. Change the form action to https://\n2. Never post credentials or personal data over http',
      'Browser', `${httpForms.length} form(s) post to an http:// URL, sending whatever the user types in clear text.`,
      httpForms, root);
    findings.push('insecure form action');
  }

  // ── Sensitive file probe ─────────────────────────────────────────────────
  const exposed: string[] = [];
  await Promise.all(SENSITIVE_PATHS.map(async (path) => {
    try {
      const r = await ctx.context.request.get(u.origin + path, { timeout: 7000, maxRedirects: 0 });
      const body = (await r.text().catch(() => '')).slice(0, 300);
      // 200 with real content (not an SPA index / soft-404)
      if (r.status() === 200 && body && !/<!doctype html|<html/i.test(body)) {
        exposed.push(`${path} → 200 (${(r.headers()['content-type'] ?? '').split(';')[0]})`);
      }
    } catch { /* unreachable = good */ }
  }));
  set('No sensitive files exposed', exposed.length === 0 ? 'pass' : 'fail');
  if (exposed.length) {
    report.addIssue('Sensitive / config files are publicly reachable', 'Security', 'Critical',
      '1. Block these paths at the web server (deny .git, .env, .svn, *.bak, *.sql, .DS_Store)\n2. Move secrets out of the web root\n3. Rotate any credentials that were exposed',
      'Browser', 'Files that should never be public returned HTTP 200. These often contain credentials, source history, or database dumps.',
      exposed, root);
    findings.push(`${exposed.length} exposed file(s)`);
  }

  const summary = findings.length ? `Security issues: ${findings.join('; ')}.` : 'Security scan: no issues found.';
  ctx.log(`🔒 ${summary}`, findings.length ? 'warning' : 'success');
  return summary;
}
