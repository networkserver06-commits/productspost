const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'test-jwt-key-with-sufficient-length-123456';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-password-123';
process.env.NOTE_ENCRYPTION_KEY = 'test-note-key-that-is-long-enough-123456';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27099/productspost-test';
process.env.CORS_ORIGINS = 'https://post.leetec.online';
process.env.APP_URL = 'https://post.leetec.online';
process.env.PUBLIC_SITE_BASE_URL = 'https://post.leetec.online';

const app = require('./server');

function request(path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      http.get({ host: '127.0.0.1', port, path }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => server.close(() => resolve({ status: response.statusCode, headers: response.headers, body })));
      }).on('error', error => server.close(() => reject(error)));
    });
  });
}

test('public config reports the creator-site base URL', async () => {
  const response = await request('/api/config');
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.publicSiteBaseUrl, 'https://post.leetec.online');
  assert.equal(data.currency, 'KES');
});

test('upgrade script is served from the same origin', async () => {
  const response = await request('/app-upgrade.js');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /javascript/);
  assert.match(response.body, /function openDashboard/);
});

test('public navigation hides admin portal while preserving direct admin access', async () => {
  const shell = await request('/');
  assert.equal(shell.status, 200);
  assert.doesNotMatch(shell.body, /id="adminBtn"/);
  assert.match(shell.body, /id="admin"/);
  assert.match(shell.body, /openAdmin\(\)/);
  assert.match(shell.body, /get\('admin'\)==='1'/);
});

test('performance and resilience assets are delivered with fresh cache semantics', async () => {
  const version = await request('/api/version');
  assert.equal(version.status, 200);
  assert.match(version.headers['cache-control'], /no-store/);
  assert.ok(JSON.parse(version.body).version);
  const worker = await request('/sw.js');
  assert.equal(worker.status, 200);
  assert.match(worker.headers['content-type'], /javascript/);
  assert.match(worker.body, /offline\.html/);
  const offline = await request('/offline.html');
  assert.equal(offline.status, 200);
  assert.match(offline.headers['cache-control'], /no-store/);
  assert.match(offline.body, /You’re offline for now/);
  const shell = await request('/');
  assert.match(shell.headers['cache-control'], /no-store/);
  assert.match(shell.body, /connectionBanner/);
  assert.match(shell.body, /app-upgrade\.js/);
});

test('unknown API routes return JSON 404 instead of the storefront HTML', async () => {
  const response = await request('/api/does-not-exist');
  assert.equal(response.status, 404);
  assert.deepEqual(JSON.parse(response.body), { error: 'API route not found' });
});

test('client-side routes receive the nonce-bearing storefront shell', async () => {
  const response = await request('/leetech');
  assert.equal(response.status, 200);
  assert.match(response.body, /Content-Security-Policy|Lee Tech/);
  assert.doesNotMatch(response.body, /__CSP_NONCE__/);
  assert.match(response.body, /\.upgrade-overlay\{position:fixed/);
});

test('automatic refresh and reconnect hooks are wired without private data caching', async () => {
  const shell = await request('/');
  const script = await request('/app-upgrade.js');
  assert.match(shell.body, /setInterval\(\(\)=>\{if\(!document\.hidden&&navigator\.onLine\)/);
  assert.match(shell.body, /checkForAppUpdate\(\)/);
  assert.match(script.body, /cache: options\.cache \|\| 'no-store'/);
  assert.match(script.body, /startPublicAutoRefresh/);
  assert.match(script.body, /window\.refreshPublicSite/);
  assert.match(script.body, /navigator\.serviceWorker\.register\('\/sw\.js'/);
  assert.match(shell.body, /A new Lee Tech update is ready/);
});

test('toast feedback covers automatic updates and major user actions', async () => {
  const shell = await request('/');
  const script = await request('/app-upgrade.js');
  assert.match(shell.body, /id="toast" role="status" aria-live="polite"/);
  assert.match(shell.body, /Storefront updated automatically/);
  assert.match(shell.body, /Internet connection restored/);
  assert.match(shell.body, /A new Lee Tech update is ready/);
  assert.match(script.body, /Signed in successfully/);
  assert.match(script.body, /Opening secure Paystack checkout/);
  assert.match(script.body, /Blog saved successfully/);
  assert.match(script.body, /Product saved successfully/);
  assert.match(script.body, /Creator site updated automatically/);
  assert.match(shell.body, /Dashboard synced automatically/);
  assert.match(script.body, /Posting price saved/);
  assert.match(script.body, /notify\(error\.message, 'error'\)/);
});

test('auth upgrade includes password visibility and verification-code UX', async () => {
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /data-password-toggle/);
  assert.match(script.body, /upgradeVerifyForm/);
  assert.match(script.body, /resend-verification/);
  assert.match(script.body, /confirmPassword/);
  assert.match(script.body, /passwordField/);
  assert.match(script.body, /openAuth\('register'\)/);
  const shell = await request('/');
  assert.match(shell.body, /data-password-toggle/);
});

test('server contains branded automated email templates', () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /Powered by Lee Tech/);
  assert.match(source, /automated email\. Please do not reply/);
  assert.match(source, /randomVerificationCode/);
  assert.match(source, /emailVerificationCodeHash/);
  assert.match(source, /sendAccountUpdateEmail/);
  assert.match(source, /reply/);
  assert.match(source, /Verification code/);
});

test('creator dashboard capabilities are wired to owner-scoped routes', async () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /api\/me\/analytics/);
  assert.match(source, /ownerId: req\.user\._id/);
  assert.match(source, /api\/me\/security/);
  assert.match(source, /purchases/);
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /Visitor analytics/);
  assert.match(script.body, /Wallet & history/);
  assert.match(script.body, /Paid services/);
  assert.match(script.body, /Profile & site/);
  assert.match(script.body, /Posts & blogs/);
});

test('public username sites include customer-facing share and contact actions', async () => {
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  const script = await request('/app-upgrade.js');
  assert.match(server, /whatsappNumber/);
  assert.match(server, /whatsappGroupLink/);
  assert.match(server, /instagramUrl/);
  assert.match(server, /contactLinksForView/);
  assert.match(script.body, /data-share-site/);
  assert.match(script.body, /data-share-post/);
  assert.match(script.body, /renderPublicContactLinks/);
  assert.match(script.body, /whatsappGroupLink/);
  assert.match(script.body, /instagramUrl/);
  assert.match(script.body, /Only blogs and products published by this creator appear/);
  assert.match(script.body, /upgrade-public-nav/);
  assert.match(script.body, /upgrade-public-profile-card/);
  assert.match(script.body, /upgrade-public-contact/);
  assert.match(script.body, /upgrade-public-cta/);
  assert.match(script.body, /upgrade-public-footer/);
  assert.match(script.body, /renderPublicProductCards/);
  assert.match(script.body, /upgrade-public-product-grid/);
  assert.match(script.body, /data-share-product/);
});

test('creator publishing supports uploads, separated blogs, and typed products', async () => {
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  const script = await request('/app-upgrade.js');
  assert.match(server, /contentType/);
  assert.match(server, /productType/);
  assert.match(server, /normalizeImage/);
  assert.match(server, /normalizePostFields/);
  assert.match(server, /userSite\(user, posts, products\)/);
  assert.match(script.body, /upgradePostImageFile/);
  assert.match(script.body, /compressUserPostImage/);
  assert.match(script.body, /upgradeProductPostFields/);
  assert.match(script.body, /upgradeProductStockField/);
  assert.match(script.body, /renderUserLibrarySections/);
  assert.match(script.body, /Save product/);
});

test('Paystack initialization and verification follow the documented payment contract', async () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /LT-\$\{Date\.now\(\)\}-/);
  assert.doesNotMatch(source, /LT_\$\{Date\.now\(\)\}_/);
  assert.match(source, /metadata: JSON\.stringify/);
  assert.match(source, /amount: String\(amountMinor\)/);
  assert.match(source, /PAYSTACK_MINIMUM_MINOR/);
  assert.match(source, /PAYSTACK_CURRENCY === 'KES' \? 400 : 1/);
  assert.match(source, /PAYSTACK_CALLBACK_URL/);
  assert.match(source, /callback_url: PAYSTACK_CALLBACK_URL/);
  assert.match(source, /paymentReturnUrl/);
  assert.match(source, /destination', 'account'/);
  assert.match(source, /view', 'wallet'/);
  assert.match(source, /AbortSignal\.timeout\(15000\)/);
  assert.match(source, /PAYSTACK_UNAVAILABLE/);
  assert.match(source, /PAYSTACK_SECRET_KEY \|\| process\.env\.PAYSTACK_WEBHOOK_SECRET/);
  assert.match(source, /x-paystack-signature/);
  assert.match(source, /Payment is \$\{transaction\.status/);
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /data-verify-payment/);
  assert.match(script.body, /Check status/);
  assert.match(script.body, /Minimum deposit is KES 4\.00/);
  assert.match(script.body, /Paystack did not return a valid secure checkout link/);
  assert.match(script.body, /upgradeTopupMessage/);
  assert.match(script.body, /Paystack checkout timed out/);
  assert.match(script.body, /openDashboard\('wallet'\)/);
  assert.match(script.body, /userState\.dashboardView = view/);
  assert.match(script.body, /switchUserDashboardView\(userState\.dashboardView \|\| 'overview'\)/);
  assert.match(script.body, /name="amount" min="4"/);
});

test('creator dashboard exposes Visit my site and Log out actions', async () => {
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /Visit my site/);
  assert.match(script.body, /Log out/);
  assert.match(script.body, /data-user-action="visit-site"/);
  assert.match(script.body, /data-user-action="logout"/);
  assert.match(script.body, /logoutUser\(\)/);
  assert.match(script.body, /const siteUrl = String\(userState\.user\?\.siteUrl/);
  assert.match(script.body, /userState\.user = null/);
  assert.match(script.body, /window\.location\.assign\(destination\)/);
});

test('creator dashboard uses a functional admin-style dropdown menu', async () => {
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /upgrade-user-select-toggle/);
  assert.match(script.body, /aria-expanded/);
  assert.match(script.body, /role="menuitem"/);
  for (const label of ['Overview', 'Visitor analytics', 'Posts & blogs', 'Wallet & history', 'Paid services', 'Profile & site', 'Security']) assert.ok(script.body.includes(label), `missing dropdown label: ${label}`);
  assert.match(script.body, /classList\.remove\('open'\)/);
});

test('admin control center exposes working quick actions and management views', async () => {
  const shell = await request('/');
  const script = await request('/app-upgrade.js');
  for (const label of ['Review users', 'Review payments', 'Add product', 'Write journal', 'Manage pricing', 'View analytics', 'Secure note', 'Check security']) assert.match(shell.body, new RegExp(label));
  for (const view of ['users', 'finance', 'pricing']) assert.match(shell.body, new RegExp('id="view-' + view + '"'));
  for (const route of ['/api/admin/users', '/api/admin/finance', '/api/admin/settings', '/api/admin/services']) assert.match(shell.body, new RegExp(route.replaceAll('/', '\\/')));
  for (const fn of ['loadAdminUsers', 'loadAdminFinance', 'loadAdminSettings', 'loadAdminServices', 'saveAdminSettings', 'saveAdminService', 'adjustAdminWallet']) assert.match(shell.body, new RegExp('function ' + fn));
  assert.match(shell.body, /admin-quick-grid/);
  assert.match(shell.body, /data-view="users"/);
  assert.match(shell.body, /data-view="finance"/);
  assert.match(shell.body, /data-view="pricing"/);
});

test('shared links receive dynamic social metadata and a generated PNG card', async () => {
  const page = await request('/leetech?shareTitle=My%20new%20post&shareText=Ideas%20for%20better%20days');
  assert.equal(page.status, 200);
  assert.match(page.body, /property="og:image"/);
  assert.match(page.body, /twitter:card/);
  assert.match(page.body, /share-card\.png/);
  assert.match(page.body, /My%20new%20post|My new post/);
  const card = await request('/share-card.png?title=My%20new%20post&subtitle=Ideas%20for%20better%20days');
  assert.equal(card.status, 200);
  assert.match(card.headers['content-type'], /image\/png/);
  assert.ok(Number(card.headers['content-length'] || 0) > 1000);
});
