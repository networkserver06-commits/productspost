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

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const body = options.body ? JSON.stringify(options.body) : null;
      const req = http.request({ host: '127.0.0.1', port, path, method: options.method || 'GET', headers: { ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, response => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { responseBody += chunk; });
        response.on('end', () => server.close(() => resolve({ status: response.statusCode, headers: response.headers, body: responseBody })));
      });
      req.on('error', error => server.close(() => reject(error)));
      if (body) req.write(body);
      req.end();
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
  const shell = await request('/?admin=1');
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
  const shell = await request('/?admin=1');
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
  const response = await request('/leetech?admin=1');
  assert.equal(response.status, 200);
  assert.match(response.body, /Content-Security-Policy|Lee Tech/);
  assert.doesNotMatch(response.body, /__CSP_NONCE__/);
  assert.match(response.body, /\.upgrade-overlay\{position:fixed/);
});

test('homepage uses the generated Lee Tech hero image asset', async () => {
  const shell = await request('/');
  assert.equal(shell.status, 200);
  assert.match(shell.body, /has-generated-image/);
  assert.match(shell.body, /lee-tech-hero\.webp/);
  const image = await request('/lee-tech-hero.webp');
  assert.equal(image.status, 200);
  assert.match(image.headers['content-type'], /image\/webp/);
  assert.match(image.headers['cache-control'], /immutable/);
  assert.ok(Buffer.byteLength(image.body) > 1000);
});

test('automatic refresh and reconnect hooks are wired without private data caching', async () => {
  const shell = await request('/?admin=1');
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
  const shell = await request('/?admin=1');
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
  assert.match(script.body, /window\.openCreatorSignup = openCreatorSignup/);
  const shell = await request('/?admin=1');
  assert.match(shell.body, /data-password-toggle/);
});

test('create-account panel advertises the free KES 10 welcome credit', async () => {
  const response = await request('/app-upgrade.js');
  assert.equal(response.status, 200);
  assert.match(response.body, /upgrade-signup-offer/);
  assert.match(response.body, /Start with a free KES 10\.00 welcome credit/);
  assert.match(response.body, /Use it for publishing and paid Lee Tech services/);
  assert.match(response.body, /It is added to your wallet when your account is created/);
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

test('auth and automated email routes have dedicated abuse limits', () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /const signupLimiter = rateLimit/);
  assert.match(source, /const emailLimiter = rateLimit/);
  assert.match(source, /max: 5/);
  assert.match(source, /app\.post\('\/api\/auth\/user\/register', signupLimiter, emailLimiter, requireDatabase/);
  assert.match(source, /app\.post\('\/api\/auth\/user\/login', loginLimiter, requireDatabase/);
  assert.match(source, /app\.post\('\/api\/auth\/user\/forgot-password', loginLimiter, emailLimiter, requireDatabase/);
  assert.match(source, /app\.post\('\/api\/auth\/user\/resend-verification', loginLimiter, emailLimiter, requireDatabase/);
  assert.match(source, /app\.post\('\/api\/auth\/user\/change-password', emailLimiter, requireDatabase, userAuth/);
});

test('invalid admin sign-in attempts are rate limited', async () => {
  const responses = [];
  for (let attempt = 0; attempt < 9; attempt += 1) responses.push(await request('/api/auth/login', { method: 'POST', body: { username: 'not-the-admin', password: 'x' } }));
  assert.equal(responses.slice(0, 8).every(response => response.status === 401), true);
  assert.equal(responses[8].status, 429);
  assert.match(responses[8].body, /Too many sign-in attempts/);
});

test('new accounts receive an auditable KES 10 welcome credit', () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /WELCOME_CREDIT_MINOR = 1000/);
  assert.match(source, /type: 'welcome_credit'/);
  assert.match(source, /reference: `welcome:\$\{user\._id\}`/);
  assert.match(source, /walletBalanceMinor: WELCOME_CREDIT_MINOR/);
  assert.match(source, /free KES 10\.00 welcome credit for posting and paid services/);
  assert.match(source, /Your new creator account includes a free <strong>KES 10\.00 welcome credit<\/strong>/);
});

test('activity retention expires only non-essential operational records after 24 hours', async () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /const ACTIVITY_RETENTION_SECONDS = 24 \* 60 \* 60/);
  assert.match(source, /visitorSchema\.index\(\{ createdAt: 1 \}, \{ expireAfterSeconds: ACTIVITY_RETENTION_SECONDS \}\)/);
  assert.match(source, /auditSchema\.index\(\{ createdAt: 1 \}, \{ expireAfterSeconds: ACTIVITY_RETENTION_SECONDS \}\)/);
  assert.match(source, /createIndex\(\{ createdAt: 1 \}, \{ name: 'createdAt_1', expireAfterSeconds: ACTIVITY_RETENTION_SECONDS \}\)/);
  assert.match(source, /activityRetentionIndexPromise/);
  assert.match(source, /TTL index could not be verified/);
  for (const modelDeclaration of ['const paymentSchema', 'const walletTransactionSchema', 'const purchaseSchema', 'const noteSchema', 'const userSchema', 'const postSchema', 'const productSchema']) {
    const start = source.indexOf(modelDeclaration);
    const end = source.indexOf(');', start) + 2;
    assert.ok(start >= 0 && end > start, `missing model declaration: ${modelDeclaration}`);
    assert.doesNotMatch(source.slice(start, end), /expireAfterSeconds/);
  }
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /Last 24 hours · privacy-safe retention/);
  assert.match(script.body, /Kept for 24 hours/);
});

test('posting exposes authoritative pricing, secure validation, and wallet receipts', async () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  const script = await request('/app-upgrade.js');
  assert.match(source, /app\.get\('\/api\/me\/posting-cost'/);
  assert.match(source, /expectedPriceMinor/);
  assert.match(source, /POST_PRICE_CHANGED/);
  assert.match(source, /balanceAfterMinor/);
  assert.match(source, /contentType = 'product'/);
  assert.match(source, /contentType\);/);
  assert.match(source, /Product publishing:/);
  assert.match(script.body, /Blogs and journal posts are free to publish/);
  assert.match(script.body, /Product publishing fee/);
  assert.match(script.body, /Product fee is shown before you confirm · Blogs are free/);
  assert.match(source, /normalized\.contentType/);
  assert.match(source, /chargedMinor/);
  assert.match(source, /balanceAfterMinor/);
  assert.match(source, /Physical products require a stock quantity/);
  assert.match(script.body, /upgradePostCostBox/);
  assert.match(script.body, /confirm\(review\)/);
  assert.match(script.body, /expectedPriceMinor: userState\.postingCostMinor/);
  assert.match(script.body, /balanceAfterMinor/);
  assert.match(script.body, /Edit product/);
  assert.match(script.body, /Cancel edit/);
  assert.match(source, /app\.delete\('\/api\/me\/posts\/:id', requireDatabase, userAuth, verifiedUser/);
  assert.match(script.body, /data-upgrade-delete-post/);
  assert.match(script.body, /data-upgrade-delete-kind/);
  assert.match(script.body, /Wallet charges are not refunded/);
  assert.match(script.body, /This action cannot be undone/);
  assert.match(script.body, /upgrade-danger-action/);
  assert.match(script.body, /deletePost\(button\.dataset\.upgradeDeletePost/);
  assert.match(script.body, /postSaveInFlight/);
  assert.match(script.body, /already being saved/);
  assert.match(script.body, /clientSubmissionId: createPostSubmissionId\(\)/);
  assert.match(script.body, /Idempotency-Key/);
  assert.match(source, /clientSubmissionId: \{ type: String/);
  assert.match(source, /partialFilterExpression: \{ clientSubmissionId: \{ \$type: 'string' \} \}/);
  assert.match(source, /idempotent: true/);
  assert.match(source, /app\.delete\('\/api\/me\/posts\/:id'/);
});

test('admin pricing labels the product fee and keeps blogs free', async () => {
  const page = await request('/?admin=1');
  assert.equal(page.status, 200);
  assert.match(page.body, /Product publishing price/);
  assert.match(page.body, /Product publishing fee \(KES\)/);
  assert.match(page.body, /Blogs and journal posts are free/);
  assert.match(page.body, /Current product fee/);
  assert.match(page.body, /Database & health/);
  assert.match(page.body, /Site maintenance/);
  assert.match(page.body, /Payment availability/);
  assert.match(page.body, /Signup controls/);
  assert.match(page.body, /data-admin-action="maintenance"/);
  assert.match(page.body, /data-admin-action="payments-control"/);
  assert.match(page.body, /data-admin-action="signups-control"/);
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(server, /app\.get\('\/api\/products',[\s\S]*published: \{ \$ne: false \}/);
  assert.match(server, /app\.get\('\/api\/posts',[\s\S]*ownerId: null,[\s\S]*moderationStatus: \{ \$nin: \['pending', 'rejected'\] \}/);
});

test('admin health and availability controls are protected and server-enforced', async () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /app\.get\('\/api\/admin\/health', adminLimiter, adminAuth/);
  assert.match(source, /dbStats/);
  assert.match(source, /siteMaintenance/);
  assert.match(source, /function isAdminEntryRequest\(req\)/);
  assert.match(source, /function maintenanceHtml\(message\)/);
  assert.match(source, /res\.status\(503\)\.type\('html'\)/);
  assert.match(source, /if \(!isAdminEntryRequest\(req\)\)/);
  assert.match(source, /Maintenance check unavailable:/);
  assert.match(source, /res\.status\(503\)\.type\('html'\)/);
  assert.doesNotMatch(source, /reconnect our services/);
  assert.match(source, /Site maintenance in progress/);
  assert.doesNotMatch(source, /siteMaintenance.*window\.location/);
  assert.match(source, /paymentsMaintenance/);
  assert.match(source, /signupsRestricted/);
  assert.match(source, /signupRestrictionMessage/);
  assert.match(source, /paymentsMaintenanceMessage/);
  assert.match(source, /Admin settings update failed:/);
  assert.match(source, /Settings are temporarily unavailable\. Your admin session remains active/);
  const shell = await request('/?admin=1');
  assert.match(shell.body, /Database & health/);
  assert.match(shell.body, /maintenanceBanner/);
  assert.match(shell.body, /adminSiteMaintenance/);
  assert.match(shell.body, /adminPaymentsMaintenance/);
  assert.match(shell.body, /adminSignupsRestricted/);
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /leePublicConfig/);
  assert.match(script.body, /New sign-ups are paused/);
  assert.match(script.body, /Sign-ups paused/);
  assert.match(script.body, /\.maintenance-banner\[hidden\]\{display:none!important\}/);
  const shellWithControls = await request('/?admin=1');
  assert.match(shellWithControls.body, /saveAvailabilitySetting/);
  assert.match(shellWithControls.body, /credentials:'include'/);
  assert.match(shellWithControls.body, /cache:'no-store'/);
  assert.match(shellWithControls.body, /event\.preventDefault\(\); saveAvailabilitySetting\(event,'site'\); return false/);
  assert.doesNotMatch(shellWithControls.body, /saveAvailabilitySetting[\\s\\S]{0,2200}window\\.location/);
  assert.match(shellWithControls.body, /Site maintenance.*enabled/);
  assert.match(shellWithControls.body, /Payment availability.*enabled/);
  assert.match(shellWithControls.body, /Signup controls.*enabled/);
});

test('database settings outages do not incorrectly activate public maintenance mode', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.body, /Lee Tech — Technology with intention/);
  assert.doesNotMatch(response.body, /Site maintenance in progress/);
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
  assert.match(script.body, /upgrade-dashboard-menu-anchor/);
  assert.match(script.body, /upgrade-user-menu\" id=\"upgradeUserMenu\" role=\"menu/);
  assert.match(script.body, /aria-haspopup=\"menu\"/);
  assert.match(script.body, /upgrade-dashboard-side-footer\{display:none\}/);
  assert.equal((script.body.match(/class=\"upgrade-user-menu\"/g) || []).length, 1);
});

test('public username sites include customer-facing share and contact actions', async () => {
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  const script = await request('/app-upgrade.js');
  assert.match(server, /whatsappNumber/);
  assert.match(server, /phoneNumber/);
  assert.match(server, /Phone number must include 7–15 digits/);
  assert.match(server, /whatsappGroupLink/);
  assert.match(server, /instagramUrl/);
  assert.match(server, /contactLinksForView/);
  assert.match(script.body, /data-share-site/);
  assert.match(script.body, /data-share-post/);
  assert.match(script.body, /renderPublicContactLinks/);
  assert.match(script.body, /phoneNumber/);
  assert.match(script.body, /label: 'Call'/);
  assert.match(script.body, /tel:\$\{phone\.startsWith/);
  assert.match(script.body, /Optional direct calls/);
  assert.match(script.body, /Visitors will see a Call button/);
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
  assert.match(script.body, /upgrade-product-buy/);
  assert.match(script.body, /upgrade-product-buy,\.upgrade-product-share\{display:flex;width:100%/);
  assert.match(script.body, /flex-wrap:wrap;border-top:1px solid #e7ebf0/);
  assert.match(script.body, /upgrade-public-empty \.upgrade-public-text-link\{color:#1f5eff/);
  assert.match(script.body, /upgrade-public-cta \.upgrade-public-eyebrow\{color:#20735b/);
  assert.match(script.body, /box-sizing:border-box/);
});

test('creator analytics clearly reflects privacy-safe 24-hour retention', async () => {
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /Last 24 hours · privacy-safe retention/);
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(server, /Number\(req\.query\.days\) \|\| 1, 1\), 1/);
  assert.match(server, /ACTIVITY_RETENTION_SECONDS = 24 \* 60 \* 60/);
});

test('public creator pages receive indexable profile metadata when available', () => {
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(server, /ProfilePage/);
  assert.match(server, /rel="canonical"/);
  assert.match(server, /name="robots" content="index,follow/);
  assert.match(server, /creator\.displayName/);
  assert.match(server, /application\/ld\+json/);
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

test('product uploads optimize to WebP and admin blogs expose safe visitor links', async () => {
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  const shell = await request('/?admin=1');
  const script = await request('/app-upgrade.js');
  assert.match(server, /async function optimizeProductImage\(/);
  assert.match(server, /\.webp\(\{ quality: 82, effort: 4 \}\)/);
  assert.match(server, /image: await optimizeProductImage\(body\.image \|\| ''\)/);
  assert.match(server, /visitorLink: \{ type: String, default: ''/);
  assert.match(server, /normalizeContactUrl\(body\.visitorLink \|\| '', 'Visitor link'\)/);
  assert.match(shell.body, /id="pImageFile"/);
  assert.match(shell.body, /saved as WebP automatically/);
  assert.match(shell.body, /id="postVisitorLink"/);
  assert.match(shell.body, /visitorLink:\$\('#postVisitorLink'\)\.value/);
  assert.match(shell.body, /function safePostLink\(/);
  assert.match(shell.body, /post-follow-link/);
  assert.match(script.body, /function safePublicUrl\(/);
  assert.match(script.body, /function publicPostLink\(/);
  assert.match(script.body, /upgrade-post-link/);
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
  const shell = await request('/?admin=1');
  const script = await request('/app-upgrade.js');
  for (const label of ['Review users', 'Review payments', 'Add product', 'Write journal', 'Manage pricing', 'View analytics', 'Secure note', 'Check security']) assert.match(shell.body, new RegExp(label));
  for (const view of ['users', 'finance', 'pricing']) assert.match(shell.body, new RegExp('id="view-' + view + '"'));
  for (const route of ['/api/admin/users', '/api/admin/finance', '/api/admin/settings', '/api/admin/services']) assert.match(shell.body, new RegExp(route.replaceAll('/', '\\/')));
  for (const fn of ['loadAdminUsers', 'loadAdminFinance', 'loadAdminSettings', 'loadAdminServices', 'saveAdminSettings', 'saveAdminService', 'adjustAdminWallet']) assert.match(shell.body, new RegExp('function ' + fn));
  assert.match(shell.body, /admin-quick-grid/);
  for (const action of ['users', 'finance', 'add-product', 'write-journal', 'pricing', 'analytics', 'new-note', 'security']) assert.match(shell.body, new RegExp('data-admin-action="' + action + '"'));
  assert.doesNotMatch(shell.body, /admin-quick-action" onclick=/);
  assert.match(shell.body, /function handleAdminQuickAction/);
  assert.match(shell.body, /function updateAdminPostBadge/);
  assert.match(shell.body, /updateAdminPostBadge\(s\.posts\)/);
  assert.match(shell.body, /updateAdminPostBadge\(posts\.length\)/);
  assert.match(shell.body, /data-admin-post-count/);
  assert.match(shell.body, /badge\.hidden=total===0/);
  assert.match(shell.body, /data-view="users"/);
  assert.match(shell.body, /data-view="finance"/);
  assert.match(shell.body, /data-view="pricing"/);
  assert.doesNotMatch(shell.body, /<span>Messages<\/span>/);
  assert.match(script.body, /view-users.*view-finance.*view-pricing/);
  assert.match(script.body, /if \(document\.getElementById\('view-users'\)/);
  assert.match(shell.body, /id==='users'\)await loadAdminUsers/);
  assert.match(shell.body, /id==='finance'\)await loadAdminFinance/);
  assert.match(shell.body, /id==='pricing'\)await Promise\.all/);
});

test('admin products support service-only price-on-request mode without changing fixed products', async () => {
  const page = await request('/?admin=1');
  assert.equal(page.status, 200);
  assert.match(page.body, /id="pPriceOnRequestField"/);
  assert.match(page.body, /Price on request/);
  assert.match(page.body, /Contact for pricing/);
  assert.match(page.body, /priceOnRequest/);
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(server, /priceOnRequest: \{ type: Boolean, default: false \}/);
  assert.match(server, /category\.toLowerCase\(\) === 'services'/);
  assert.match(server, /price: priceOnRequest \? 0 : Number\(body\.price\)/);
});

test('request-priced services use the customer inquiry popup before WhatsApp', async () => {
  const page = await request('/?admin=1');
  assert.equal(page.status, 200);
  assert.match(page.body, /id="inquiryModal"/);
  assert.match(page.body, /id="inquiryName"/);
  assert.match(page.body, /id="inquiryContact"/);
  assert.match(page.body, /id="inquiryMessage"/);
  assert.match(page.body, /submitInquiry\(event\)/);
  assert.match(page.body, /openInquiry\(contact\.dataset\.contactName,contact\)/);
  assert.match(page.body, /Please complete your name, contact, and request details/);
  assert.match(page.body, /request pricing for \$\{inquiryTargetName\}/);
  assert.match(page.body, /Continue to WhatsApp/);
});

test('admin journal listing matches its owner-scoped edit and delete handlers', () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /const isPostModel = model === Post/);
  assert.match(source, /const filter = isPostModel \? \{ ownerId: null \} : \{\}/);
  assert.match(source, /app\.get\('\/api\/admin\/posts', \(req, res\) => crud\(Post, req, res, 'list'\)\)/);
  assert.match(source, /findOneAndUpdate\(isProduct \? \{ _id: req\.params\.id \} : \{ _id: req\.params\.id, ownerId: null \}/);
  assert.match(source, /findOneAndDelete\(isProduct \? \{ _id: req\.params\.id \} : \{ _id: req\.params\.id, ownerId: null \}/);
});

test('admin journal overview count matches the owner-scoped journal list', () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(source, /Post\.countDocuments\(\{ ownerId: null \}\)/);
  assert.match(source, /app\.get\('\/api\/admin\/posts', \(req, res\) => crud\(Post, req, res, 'list'\)/);
  assert.match(source, /const filter = isPostModel \? \{ ownerId: null \} : \{\}/);
  const page = require('node:fs').readFileSync('index.html', 'utf8');
  assert.match(page, /updateAdminPostBadge\(s\.posts\)/);
  assert.match(page, /updateAdminPostBadge\(posts\.length\)/);
});

test('mobile storefront and journal editor use a focused responsive layout', async () => {
  const page = await request('/?admin=1');
  assert.equal(page.status, 200);
  assert.match(page.body, /@media\(max-width:760px\)\{\.grid\{grid-template-columns:1fr\}/);
  assert.match(page.body, /\.card-actions\{width:100%\}/);
  assert.match(page.body, /position:sticky;bottom:0/);
  assert.match(page.body, /Title and content are required\. Excerpt and cover image are optional/);
  assert.doesNotMatch(page.body, /id="postAuthor"/);
  assert.match(page.body, /author:'Lee Tech'/);
  assert.match(page.body, /upgrade-public-nav\{position:sticky/);
});

test('homepage clearly explains the Lee Tech ecosystem and value proposition', async () => {
  const page = await request('/?admin=1');
  assert.equal(page.status, 200);
  for (const phrase of ['creator platform', 'What Lee Tech really is', 'Publish your work', 'Share one clear link', 'Grow with useful tools', 'Your Lee Tech creator journey', 'Create your identity', 'Publish what you do', 'Share and understand your reach']) assert.match(page.body, new RegExp(phrase));
  for (const anchor of ['id="about"', 'id="creator-path"', 'id="products"', 'id="studio"', 'id="journal"', 'id="community"']) assert.match(page.body, new RegExp(anchor));
  assert.match(page.body, /Create your free creator site/);
  assert.doesNotMatch(page.body, /EST\. 2024/);
  assert.match(page.body, /onclick="window\.openCreatorSignup\(\)"/);
  assert.match(page.body, /From your idea to a site people can visit/);
  assert.match(page.body, /Find your next tool/);
  assert.match(page.body, /A calmer way to stay in the loop/);
});

test('share dialog provides an accessible Cancel action and polished controls', async () => {
  const page = await request('/?admin=1');
  assert.equal(page.status, 200);
  assert.match(page.body, /id="shareModal" role="dialog" aria-modal="true"/);
  assert.match(page.body, /id="shareCancelButton"/);
  assert.match(page.body, /share-modal-footer/);
  assert.match(page.body, /Choose a channel or copy the link/);
  assert.match(page.body, /if\(event\.target\.closest\('#shareCancelButton'\)\)return closeModal\('shareModal'\)/);
  assert.match(page.body, /share-modal-cancel/);
  assert.match(page.body, /share-list button/);
});

test('shared links receive dynamic metadata and the Lee Tech homepage PNG visual', async () => {
  const page = await request('/leetech?admin=1&shareTitle=My%20new%20post&shareText=Ideas%20for%20better%20days');
  assert.equal(page.status, 200);
  assert.match(page.body, /property="og:image"/);
  assert.match(page.body, /twitter:card/);
  assert.match(page.body, /property="og:description"/);
  assert.match(page.body, /og:image[^>]+share-card\.png/);
  assert.match(page.body, /My%20new%20post|My new post/);
  const homepageImage = await request('/homepage-share-image.png');
  assert.equal(homepageImage.status, 200);
  assert.match(homepageImage.headers['content-type'], /image\/png/);
  assert.ok(Number(homepageImage.headers['content-length'] || 0) > 1000);
  const legacyCard = await request('/share-card.png?title=My%20new%20post&subtitle=Ideas%20for%20better%20days');
  assert.equal(legacyCard.status, 200);
  assert.match(legacyCard.headers['content-type'], /image\/png/);
  const server = require('node:fs').readFileSync('server.js', 'utf8');
  assert.match(server, /function wrapShareText\(/);
  assert.match(server, /font-family="DejaVu Sans"/);
  assert.match(server, /Powered by Lee Tech/);
});

test('shared product links use the product image with a homepage fallback', async () => {
  const productId = '507f1f77bcf86cd799439011';
  const page = await request(`/leetech?admin=1&shareTitle=Product%20launch&shareText=See%20the%20product&shareProduct=${productId}`);
  assert.equal(page.status, 200);
  assert.match(page.body, new RegExp(`/share-product-image\\.png\\?product=${productId}`));
  assert.doesNotMatch(page.body, /og:image[^>]+homepage-share-image\.png/);
  const fallbackPage = await request('/leetech?admin=1&shareTitle=Product%20launch&shareProduct=not-an-object-id');
  assert.equal(fallbackPage.status, 200);
  assert.match(fallbackPage.body, /share-card\.png/);
  const invalidImage = await request('/share-product-image.png?product=not-an-object-id');
  assert.equal(invalidImage.status, 400);
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /data-share-product-id/);
  const shell = await request('/?admin=1');
  assert.match(shell.body, /share-product-image\.png/);
  assert.match(shell.body, /shareProduct/);
  assert.match(shell.body, /Product image/);
  const server = require('fs').readFileSync('server.js', 'utf8');
  assert.match(server, /contentType: 'product', published: true/);
  assert.match(server, /data:image/);
  assert.match(server, /external\.protocol === 'https:/);
});

test('moderation is protected and preserves admin login and direct access contracts', async () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  const shell = await request('/?admin=1');
  assert.match(shell.body, /data-view="moderation"/);
  assert.match(shell.body, /id="view-moderation"/);
  assert.match(shell.body, /api\/admin\/moderation/);
  assert.match(source, /app\.use\('\/api\/admin', requireDatabase, adminLimiter, adminAuth\)/);
  assert.match(source, /app\.get\('\/api\/admin\/moderation'/);
  assert.match(source, /app\.put\('\/api\/admin\/moderation\/:type\/:id'/);
  assert.match(source, /moderationStatus: 'approved'/);
  assert.match(source, /Post\.find\(\{ ownerId: null \}\)/);
  assert.match(source, /const lookup = type === 'post' \? \{ _id: req\.params\.id, ownerId: null \}/);
  assert.match(source, /moderationStatus: action === 'approve' \? 'approved' : 'rejected'/);
  assert.match(source, /moderation_\$\{action\}/);
  assert.match(source, /published: action === 'approve'/);
  assert.match(source, /moderationStatus: \{ \$exists: false \}/);
  assert.match(source, /app\.post\('\/api\/auth\/login', loginLimiter/);
});

test('moderation UI provides review actions, toast feedback, and public refresh', async () => {
  const source = require('node:fs').readFileSync('index.html', 'utf8');
  const shell = await request('/?admin=1');
  assert.match(shell.body, /Approve/);
  assert.match(shell.body, /Reject/);
  assert.match(shell.body, /Content approved and published/);
  assert.match(shell.body, /Content rejected and hidden/);
  assert.match(shell.body, /Creator-owned content is published and managed directly by its creator/);
  assert.match(shell.body, /loadSite\(true\)/);
  assert.match(shell.body, /if\(view==='moderation'\)loadModeration\(\)/);
  assert.match(source, /\$\$\('\[data-moderation-action\]'\)\.forEach/);
});

test('admin creator security controls are protected with suspend and delete', async () => {
  const source = require('node:fs').readFileSync('server.js', 'utf8');
  const script = await request('/app-upgrade.js');
  assert.match(source, /suspended: \{ type: Boolean, default: false/);
  assert.match(source, /if \(user\.suspended\) return res\.status\(403\)/);
  assert.match(source, /app\.put\('\/api\/admin\/users\/:id\/suspension'/);
  assert.match(source, /app\.delete\('\/api\/admin\/users\/:id'/);
  assert.match(source, /role: 'user'/);
  assert.match(source, /Post\.deleteMany\(\{ ownerId: user\._id \}\)/);
  assert.match(source, /Visitor\.deleteMany\(\{ ownerId: user\._id \}\)/);
  assert.match(source, /WalletTransaction\.deleteMany\(\{ userId: user\._id \}\)/);
  assert.match(source, /PaymentTransaction\.deleteMany\(\{ userId: user\._id \}\)/);
  assert.match(source, /Purchase\.deleteMany\(\{ userId: user\._id \}\)/);
  assert.match(source, /app\.post\('\/api\/auth\/login', loginLimiter/);
  assert.match(script.body, /adminDeleteUser/);
  assert.match(script.body, /Permanently delete @/);
  assert.match(script.body, /data-admin-delete-user/);
  assert.match(script.body, /adminSuspendUser/);
  assert.match(script.body, /data-admin-suspend/);
  assert.match(script.body, /Creator suspended successfully/);
  assert.match(script.body, /Reinstate/);
});
