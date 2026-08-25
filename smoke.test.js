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
  assert.match(response.body, /renderPublicUserSite/);
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
  assert.match(script.body, /Only posts and blogs published by this creator appear/);
  assert.match(script.body, /upgrade-public-nav/);
  assert.match(script.body, /upgrade-public-profile-card/);
  assert.match(script.body, /upgrade-public-contact/);
  assert.match(script.body, /upgrade-public-cta/);
  assert.match(script.body, /upgrade-public-footer/);
});

test('creator dashboard uses a functional admin-style dropdown menu', async () => {
  const script = await request('/app-upgrade.js');
  assert.match(script.body, /upgrade-user-select-toggle/);
  assert.match(script.body, /aria-expanded/);
  assert.match(script.body, /role="menuitem"/);
  for (const label of ['Overview', 'Visitor analytics', 'Posts & blogs', 'Wallet & history', 'Paid services', 'Profile & site', 'Security']) assert.ok(script.body.includes(label), `missing dropdown label: ${label}`);
  assert.match(script.body, /classList\.remove\('open'\)/);
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
