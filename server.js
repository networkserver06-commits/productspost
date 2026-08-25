require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const crypto = require('crypto');
const sharp = require('sharp');

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
const MIN_SECRET_LENGTH = 32;
function normalizeBaseUrl(value, fallback) { const raw = String(value || fallback).trim(); const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`; try { return new URL(withScheme).toString().replace(/\/$/, ''); } catch { return fallback; } }
const APP_URL = normalizeBaseUrl(process.env.APP_URL, 'http://localhost:3000');
const PUBLIC_SITE_BASE_URL = normalizeBaseUrl(process.env.PUBLIC_SITE_BASE_URL || APP_URL, APP_URL);
const PAYSTACK_CURRENCY = String(process.env.PAYSTACK_CURRENCY || 'KES').toUpperCase();
const PAYSTACK_CHANNELS = String(process.env.PAYSTACK_CHANNELS || '').split(',').map(x => x.trim()).filter(Boolean);
const htmlPath = path.join(process.cwd(), 'index.html');
const upgradeScriptPath = path.join(process.cwd(), 'app-upgrade.js');
const htmlTemplate = fs.readFileSync(htmlPath, 'utf8');
const upgradeScript = fs.existsSync(upgradeScriptPath) ? fs.readFileSync(upgradeScriptPath, 'utf8') : '';
const hashDirective = value => `'sha256-${crypto.createHash('sha256').update(value).digest('base64')}'`;
const inlineHandlerHashes = [...htmlTemplate.matchAll(/\bon[a-z]+\s*=\s*["']([^"']*)["']/gi)].map(match => hashDirective(match[1]));
const inlineStyleHashes = [...htmlTemplate.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)].map(match => hashDirective(match[1]));

function buildCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `script-src-attr 'unsafe-hashes' ${inlineHandlerHashes.join(' ')}`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    `style-src-attr 'unsafe-hashes' ${inlineStyleHashes.join(' ')}`,
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'"
  ].join('; ');
}

function allowedCorsOrigins() {
  const configured = String(process.env.CORS_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
  if (configured.length) return new Set(configured);
  if (isProduction) return new Set();
  return new Set(['http://localhost:3000', 'http://localhost:3200', 'http://localhost:5173']);
}

const corsOrigins = allowedCorsOrigins();
function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function validateEnvironment() {
  const missing = ['JWT_SECRET', 'ADMIN_USERNAME'].filter(name => !String(process.env[name] || '').trim());
  if (!String(process.env.ADMIN_PASSWORD || '').trim() && !String(process.env.ADMIN_PASSWORD_HASH || '').trim()) missing.push('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH');
  if (isProduction && !String(process.env.MONGODB_URI || '').trim()) missing.push('MONGODB_URI');
  if (isProduction && !String(process.env.CORS_ORIGINS || '').trim()) missing.push('CORS_ORIGINS');
  const weak = ['JWT_SECRET'].filter(name => {
    const value = String(process.env[name] || '').trim();
    return value && (value.length < MIN_SECRET_LENGTH || /change[-_ ]this|secret|password|example|lee-tech/i.test(value));
  });
  if (process.env.JWT_SECRET && process.env.NOTE_ENCRYPTION_KEY && process.env.JWT_SECRET === process.env.NOTE_ENCRYPTION_KEY) weak.push('JWT_SECRET and NOTE_ENCRYPTION_KEY must be different');
  if (process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD).length < 12) weak.push('ADMIN_PASSWORD must be at least 12 characters');
  const problems = [...new Set([...missing.map(name => `${name} is missing`), ...weak.map(name => `${name} is weak or invalid`)])];
  if (problems.length) {
    const message = `Environment validation failed: ${problems.join('; ')}`;
    if (isProduction) throw new Error(message);
    console.warn(`[config] ${message}. Optional email and payment features stay disabled until configured.`);
  }
}
validateEnvironment();

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  res.setHeader('Content-Security-Policy', buildCsp(nonce));
  next();
});
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.has(origin)) return callback(null, true);
    return callback(new Error('CORS origin is not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '15mb', verify(req, res, buffer) { req.rawBody = Buffer.from(buffer); } }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(morgan('dev'));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, validate: { xForwardedForHeader: false } }));
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Admin request limit reached. Please try again later.' }, validate: { xForwardedForHeader: false } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please wait 15 minutes.' }, validate: { xForwardedForHeader: false } });

let dbPromise = null;
async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (dbPromise) return dbPromise;
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is not configured');
  dbPromise = mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 10, bufferCommands: false })
    .then(() => mongoose.connection)
    .catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}
function requireDatabase(req, res, next) {
  connectToDatabase().then(() => next()).catch(error => {
    console.error('Database unavailable:', error.message);
    res.status(503).json({ error: 'Database temporarily unavailable' });
  });
}

const objectId = mongoose.Schema.Types.ObjectId;
const productSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, maxlength: 120 }, description: { type: String, required: true, trim: true, maxlength: 4000 }, price: { type: Number, required: true, min: 0 }, category: { type: String, default: 'General', trim: true, maxlength: 80 }, image: { type: String, default: '', maxlength: 2000000 }, featured: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }, expiresAt: { type: Date, default: null } });
productSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const postSchema = new mongoose.Schema({ title: { type: String, required: true, trim: true, maxlength: 180 }, content: { type: String, required: true, trim: true, maxlength: 50000 }, excerpt: { type: String, default: '', trim: true, maxlength: 500 }, image: { type: String, default: '', maxlength: 2000000 }, author: { type: String, default: 'Lee Tech', trim: true, maxlength: 120 }, published: { type: Boolean, default: true }, ownerId: { type: objectId, ref: 'User', default: null, index: true }, ownerUsername: { type: String, default: '', trim: true, index: true }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }, expiresAt: { type: Date, default: null } });
postSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
postSchema.index({ ownerId: 1, published: 1, createdAt: -1 });
const visitorSchema = new mongoose.Schema({ ownerId: { type: objectId, ref: 'User', default: null, index: true }, siteUsername: { type: String, default: '', trim: true, lowercase: true, index: true }, path: { type: String, default: '/', maxlength: 200 }, referrer: { type: String, default: 'direct', maxlength: 200 }, device: { type: String, default: 'desktop', maxlength: 20 }, country: { type: String, default: 'unknown', maxlength: 80 }, sessionHash: String, createdAt: { type: Date, default: Date.now } });
visitorSchema.index({ ownerId: 1, createdAt: -1 });
visitorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });
const noteSchema = new mongoose.Schema({ ciphertext: { type: String, required: true }, iv: { type: String, required: true }, tag: { type: String, required: true }, createdBy: { type: String, default: 'admin' }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } });
const auditSchema = new mongoose.Schema({ event: { type: String, required: true }, username: { type: String, default: '' }, device: { type: String, default: 'unknown' }, userAgent: { type: String, default: '' }, ipHash: { type: String, default: '' }, success: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now } });
auditSchema.index({ createdAt: -1 });
auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, minlength: 3, maxlength: 30, match: /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/ },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 320 },
  passwordHash: { type: String, required: true },
  passwordSalt: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  emailVerificationTokenHash: { type: String, default: '' },
  emailVerificationExpiresAt: { type: Date, default: null },
  emailVerificationCodeHash: { type: String, default: '' },
  emailVerificationCodeExpiresAt: { type: Date, default: null },
  passwordResetTokenHash: { type: String, default: '' },
  passwordResetExpiresAt: { type: Date, default: null },
  emailUpdateTokenHash: { type: String, default: '' },
  emailUpdateExpiresAt: { type: Date, default: null },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  displayName: { type: String, default: '', trim: true, maxlength: 120 },
  bio: { type: String, default: '', trim: true, maxlength: 600 },
  walletBalanceMinor: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastSignedIn: { type: Date, default: null }
});
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });
const paymentSchema = new mongoose.Schema({ userId: { type: objectId, ref: 'User', required: true, index: true }, reference: { type: String, required: true, unique: true }, amountMinor: { type: Number, required: true, min: 1 }, currency: { type: String, required: true, default: 'KES' }, status: { type: String, enum: ['pending', 'credited', 'failed'], default: 'pending' }, authorizationUrl: { type: String, default: '' }, channel: { type: String, default: '' }, gatewayData: { type: mongoose.Schema.Types.Mixed, default: null }, creditedAt: { type: Date, default: null }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } });
const walletTransactionSchema = new mongoose.Schema({ userId: { type: objectId, ref: 'User', required: true, index: true }, type: { type: String, enum: ['topup', 'post_publish', 'service_charge', 'admin_adjustment', 'refund'], required: true }, reference: { type: String, required: true, unique: true }, amountMinor: { type: Number, required: true }, balanceAfterMinor: { type: Number, required: true, min: 0 }, description: { type: String, default: '', maxlength: 240 }, metadata: { type: mongoose.Schema.Types.Mixed, default: null }, status: { type: String, enum: ['completed'], default: 'completed' }, createdAt: { type: Date, default: Date.now } });
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
const serviceSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, maxlength: 120 }, slug: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 80 }, description: { type: String, default: '', trim: true, maxlength: 1000 }, priceMinor: { type: Number, required: true, min: 0 }, active: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } });
serviceSchema.index({ slug: 1 }, { unique: true });
const purchaseSchema = new mongoose.Schema({ userId: { type: objectId, ref: 'User', required: true, index: true }, serviceId: { type: objectId, ref: 'Service', required: true }, serviceName: { type: String, required: true }, amountMinor: { type: Number, required: true, min: 0 }, status: { type: String, enum: ['completed'], default: 'completed' }, createdAt: { type: Date, default: Date.now } });
const settingsSchema = new mongoose.Schema({ key: { type: String, unique: true, default: 'main' }, postPriceMinor: { type: Number, min: 0, default: 0 }, updatedBy: { type: String, default: 'system' }, updatedAt: { type: Date, default: Date.now } });

const Product = mongoose.model('Product', productSchema);
const Post = mongoose.model('Post', postSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);
const AdminNote = mongoose.model('AdminNote', noteSchema);
const SecurityAudit = mongoose.model('SecurityAudit', auditSchema);
const User = mongoose.model('User', userSchema);
const PaymentTransaction = mongoose.model('PaymentTransaction', paymentSchema);
const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);
const Service = mongoose.model('Service', serviceSchema);
const Purchase = mongoose.model('Purchase', purchaseSchema);
const AppSettings = mongoose.model('AppSettings', settingsSchema);

function clean(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function normalizeUsername(value) { return clean(value, 30).toLowerCase(); }
function normalizeEmail(value) { return clean(value, 320).toLowerCase(); }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validUsername(value) { return /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/.test(value) && !RESERVED_USERNAMES.has(value); }
const RESERVED_USERNAMES = new Set(['admin', 'api', 'www', 'post', 'login', 'signup', 'account', 'dashboard', 'support', 'help', 'about', 'contact', 'security', 'settings', 'static', 'assets', 'favicon']);
function amountToMinor(value, allowZero = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < (allowZero ? 0 : 1) || amount > 100000000) return null;
  return Math.round(amount * 100);
}
function minorToMajor(value) { return Number(value || 0) / 100; }
function publicUser(user) { return { id: user._id, username: user.username, email: user.email, emailVerified: !!user.emailVerified, role: user.role, displayName: user.displayName || user.username, bio: user.bio || '', walletBalanceMinor: user.walletBalanceMinor || 0, siteUrl: `${PUBLIC_SITE_BASE_URL}/${user.username}`, createdAt: user.createdAt, lastSignedIn: user.lastSignedIn }; }
function userSite(user, posts) { return { user: { username: user.username, displayName: user.displayName || user.username, bio: user.bio || '', siteUrl: `${PUBLIC_SITE_BASE_URL}/${user.username}` }, posts }; }

function randomToken() { return crypto.randomBytes(32).toString('hex'); }
function randomVerificationCode() { return String(crypto.randomInt(100000, 1000000)); }
function hashToken(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function verifyPassword(password, salt, expectedHash) { try { const actual = crypto.scryptSync(password, salt, 64); const expected = Buffer.from(expectedHash, 'hex'); return expected.length === actual.length && crypto.timingSafeEqual(actual, expected); } catch { return false; } }
function verifyAdminPassword(password) {
  const hash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  if (hash.includes(':')) { const [salt, expected] = hash.split(':'); return verifyPassword(password, salt, expected); }
  return String(password || '') === String(process.env.ADMIN_PASSWORD || '');
}
function ipHash(req) { return crypto.createHash('sha256').update(`${req.ip}|${requiredEnv('JWT_SECRET')}`).digest('hex').slice(0, 16); }
function deviceFromAgent(agent = '') { if (/mobile|android|iphone/i.test(agent)) return 'mobile'; if (/tablet|ipad/i.test(agent)) return 'tablet'; return 'desktop'; }
function sessionHash(req) { return crypto.createHash('sha256').update(`${req.ip}|${req.headers['user-agent'] || ''}`).digest('hex').slice(0, 24); }
function recordAudit(req, event, success, username = '') { return SecurityAudit.create({ event, success, username: clean(username, 80), device: deviceFromAgent(req.headers['user-agent']), userAgent: clean(req.headers['user-agent'], 240), ipHash: ipHash(req) }).catch(() => {}); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function shareCardSvg({ title = 'Lee Tech', subtitle = 'Technology with intention.', kicker = 'LEE TECH COMMUNITY' } = {}) {
  const safeTitle = escapeHtml(clean(title || 'Lee Tech', 90));
  const safeSubtitle = escapeHtml(clean(subtitle || 'Technology with intention.', 170));
  const safeKicker = escapeHtml(clean(kicker || 'LEE TECH COMMUNITY', 42));
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0e1b32"/><stop offset="1" stop-color="#1f5eff"/></linearGradient><linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#bdebdc"/><stop offset="1" stop-color="#f1b247"/></linearGradient></defs><rect width="1200" height="630" fill="#f7f8fb"/><rect x="26" y="26" width="1148" height="578" rx="38" fill="url(#bg)"/><circle cx="1050" cy="70" r="230" fill="#1f5eff" opacity=".55"/><circle cx="110" cy="590" r="210" fill="#57c7ae" opacity=".35"/><circle cx="960" cy="520" r="130" fill="#f1b247" opacity=".18"/><rect x="86" y="84" width="68" height="68" rx="20" fill="#bdebdc"/><text x="120" y="132" text-anchor="middle" fill="#0e1b32" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="800">L</text><text x="184" y="111" fill="#bdebdc" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="700" letter-spacing="4">${safeKicker}</text><text x="184" y="146" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="27" font-weight="700">Lee Tech</text><rect x="86" y="226" width="1028" height="276" rx="30" fill="#ffffff" opacity=".97"/><rect x="122" y="270" width="56" height="5" rx="3" fill="url(#accent)"/><text x="122" y="334" fill="#12233f" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="800">${safeTitle}</text><text x="122" y="391" fill="#6d7b92" font-family="Arial,Helvetica,sans-serif" font-size="24">${safeSubtitle}</text><text x="122" y="454" fill="#1f5eff" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="700">post.leetec.online</text><text x="1078" y="454" text-anchor="end" fill="#7d8798" font-family="Arial,Helvetica,sans-serif" font-size="18">Powered by Lee Tech</text></svg>`;
}
async function renderShareCard(options) { return sharp(Buffer.from(shareCardSvg(options))).png().toBuffer(); }
function publicPathUsername(req) { const candidate = normalizeUsername(String(req.path || '').split('/').filter(Boolean)[0] || ''); return validUsername(candidate) ? candidate : ''; }
function shareMetadata(req) {
  const username = publicPathUsername(req);
  const shareTitle = clean(req.query.shareTitle || '', 90);
  const shareText = clean(req.query.shareText || '', 170);
  const pageUrl = `${APP_URL}${req.originalUrl || req.path}`;
  const title = shareTitle ? `${shareTitle} — Lee Tech` : username ? `@${username} — Lee Tech creator site` : 'Lee Tech — Technology with intention';
  const description = shareText || (username ? `Published posts from @${username} on Lee Tech.` : 'Thoughtful products, practical systems, and clear ideas from Lee Tech.');
  const imageUrl = new URL('/share-card.png', APP_URL);
  imageUrl.searchParams.set('title', shareTitle || (username ? `@${username}` : 'Lee Tech'));
  imageUrl.searchParams.set('subtitle', shareText || (username ? 'Published posts from a Lee Tech creator site.' : 'Technology with intention.'));
  return htmlTemplate.replace('<title>Lee Tech — Technology with intention</title>', `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:site_name" content="Lee Tech"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(pageUrl)}"><meta property="og:image" content="${escapeHtml(imageUrl.toString())}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(imageUrl.toString())}">`);
}

function parseCookies(req) { return String(req.headers.cookie || '').split(';').reduce((out, part) => { const index = part.indexOf('='); if (index < 0) return out; out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); return out; }, {}); }
function setCookie(res, name, value, maxAge) { const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAge))}`]; if (isProduction) parts.push('Secure'); res.append('Set-Cookie', parts.join('; ')); }
function clearCookie(res, name) { setCookie(res, name, '', 0); }
function bearerToken(req) { const header = req.header('Authorization') || ''; return header.startsWith('Bearer ') ? header.slice(7).trim() : ''; }
function tokenFromRequest(req, cookieName = 'leeSession') { return bearerToken(req) || parseCookies(req)[cookieName] || ''; }
function signAdminToken(username) { return jwt.sign({ username, role: 'admin', kind: 'admin' }, requiredEnv('JWT_SECRET'), { expiresIn: '12h', issuer: 'lee-tech-admin', audience: 'lee-tech-admin' }); }
function signUserToken(user) { return jwt.sign({ sub: String(user._id), username: user.username, role: user.role, kind: 'user' }, requiredEnv('JWT_SECRET'), { expiresIn: '7d', issuer: 'lee-tech-user', audience: 'lee-tech-user' }); }
function verifyToken(token, kind) { return jwt.verify(token, requiredEnv('JWT_SECRET'), { issuer: kind === 'admin' ? 'lee-tech-admin' : 'lee-tech-user', audience: kind === 'admin' ? 'lee-tech-admin' : 'lee-tech-user' }); }

function adminAuth(req, res, next) {
  const token = bearerToken(req) || parseCookies(req).leeAdminSession;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { const payload = verifyToken(token, 'admin'); req.admin = payload; return next(); } catch { return res.status(401).json({ error: 'Invalid or expired admin session' }); }
}
async function userAuth(req, res, next) {
  const token = tokenFromRequest(req, 'leeSession');
  if (!token) return res.status(401).json({ error: 'User authentication required' });
  try {
    const payload = verifyToken(token, 'user');
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User account not found' });
    req.user = user;
    return next();
  } catch { return res.status(401).json({ error: 'Invalid or expired user session' }); }
}
function verifiedUser(req, res, next) { if (!req.user.emailVerified) return res.status(403).json({ error: 'Please verify your email before using this feature' }); return next(); }

const EMAIL_BRAND_NAME = 'Lee Tech';
function emailFromValue() {
  const address = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!address) return '';
  return address.includes('<') ? address : `${EMAIL_BRAND_NAME} <${address}>`;
}
function emailLayout({ eyebrow = 'LEE TECH COMMUNITY', title, intro = '', body = '', ctaLabel = '', ctaUrl = '' }) {
  const button = ctaLabel && ctaUrl ? `<p style="margin:28px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#1f5eff;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">${escapeHtml(ctaLabel)}</a></p>` : '';
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f9;color:#12233f;font-family:Arial,Helvetica,sans-serif;line-height:1.6"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#0e1b32;border-radius:22px 22px 0 0;padding:26px 30px;color:#fff"><div style="font-size:12px;letter-spacing:.16em;font-weight:700;color:#bdebdc">${escapeHtml(eyebrow)}</div><div style="font-size:22px;font-weight:700;margin-top:12px">L&nbsp;&nbsp;Lee Tech</div></div><div style="background:#fff;border:1px solid #e5eaf1;border-top:0;border-radius:0 0 22px 22px;padding:34px 30px"><h1 style="font-size:32px;line-height:1.15;margin:0 0 14px;color:#12233f">${escapeHtml(title)}</h1>${intro ? `<p style="font-size:16px;color:#6d7b92;margin:0 0 18px">${escapeHtml(intro)}</p>` : ''}${body}${button}<div style="margin-top:28px;padding-top:20px;border-top:1px solid #e5eaf1;color:#7a8799;font-size:12px"><strong style="color:#12233f">Lee Tech</strong><br>Powered by Lee Tech<br>This is an automated email. Please do not reply.</div></div></div></body></html>`;
}
async function sendEmail({ to, subject, html, text }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = emailFromValue();
  if (!apiKey || !from) { console.warn(`[email] Skipped email to ${to}: RESEND_API_KEY or RESEND_FROM_EMAIL is not configured`); return { skipped: true }; }
  const payload = { from, to: [to], subject, html, text };
  const replyTo = String(process.env.RESEND_REPLY_TO || '').trim();
  if (replyTo) payload.reply_to = replyTo;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Resend returned ${response.status}`);
  return data;
}
async function safeEmail(payload) { try { return await sendEmail(payload); } catch (error) { console.error('[email] Resend error:', error.message); return { error: error.message }; } }
async function sendVerificationEmail(user, token, code) {
  const link = `${APP_URL}/?verify=${encodeURIComponent(token)}&username=${encodeURIComponent(user.username)}`;
  const body = `<p style="color:#6d7b92">Welcome to Lee Tech, <strong>${escapeHtml(user.username)}</strong>. Verify your email to activate your creator site and start publishing.</p><div style="background:#eef3ff;border-radius:14px;padding:18px;margin:20px 0"><div style="font-size:12px;color:#6d7b92;text-transform:uppercase;letter-spacing:.12em;font-weight:700">Verification code</div><div style="font-size:32px;letter-spacing:.22em;font-weight:800;color:#12233f;margin-top:6px">${escapeHtml(code)}</div><div style="font-size:12px;color:#6d7b92;margin-top:5px">This code expires in 24 hours.</div></div>`;
  return safeEmail({ to: user.email, subject: 'Verify your Lee Tech account', text: `Verify your Lee Tech account here: ${link}\n\nOr enter this verification code: ${code}\n\nThis is an automated email. Please do not reply.`, html: emailLayout({ title: 'Verify your email.', intro: 'One quick step before your Lee Tech site goes live.', body, ctaLabel: 'Verify email address', ctaUrl: link }) });
}
async function sendResetEmail(user, token) {
  const link = `${APP_URL}/?reset=${encodeURIComponent(token)}&username=${encodeURIComponent(user.username)}`;
  return safeEmail({ to: user.email, subject: 'Reset your Lee Tech password', text: `Reset your Lee Tech password here: ${link}\n\nThis link expires in one hour. This is an automated email. Please do not reply.`, html: emailLayout({ eyebrow: 'ACCOUNT SECURITY', title: 'Reset your password.', intro: `A password reset was requested for @${user.username}.`, body: '<p style="color:#6d7b92">If you did not request this, you can safely ignore this email. Your password will not change.</p>', ctaLabel: 'Choose a new password', ctaUrl: link }) });
}
async function sendAccountVerifiedEmail(user) {
  const siteUrl = `${PUBLIC_SITE_BASE_URL}/${user.username}`;
  return safeEmail({ to: user.email, subject: 'Your Lee Tech account is verified', text: `Your Lee Tech account is verified. Your creator site is ${siteUrl}. This is an automated email. Please do not reply.`, html: emailLayout({ title: 'Your account is verified.', intro: 'Your Lee Tech creator account is ready.', body: `<p style="color:#6d7b92">Your public creator site is <a href="${escapeHtml(siteUrl)}" style="color:#1f5eff;font-weight:700">${escapeHtml(siteUrl)}</a>.</p>`, ctaLabel: 'Open your site', ctaUrl: siteUrl }) });
}
async function sendAccountUpdateEmail(user, updateLabel) {
  return safeEmail({ to: user.email, subject: `Lee Tech account update: ${updateLabel}`, text: `Your Lee Tech account was updated: ${updateLabel}. If you did not make this change, please reset your password. This is an automated email. Please do not reply.`, html: emailLayout({ eyebrow: 'ACCOUNT UPDATE', title: 'Your account was updated.', intro: `Lee Tech recorded this change: ${updateLabel}.`, body: '<p style="color:#6d7b92">If you did not make this change, sign in and reset your password immediately.</p>', ctaLabel: 'Open Lee Tech', ctaUrl: APP_URL }) });
}

async function getSettings(session = null) {
  const query = AppSettings.findOne({ key: 'main' });
  if (session) query.session(session);
  const row = await query.lean();
  return row || { key: 'main', postPriceMinor: amountToMinor(process.env.POST_PRICE_KES || 0, true) || 0, updatedBy: 'environment' };
}
async function chargeForPost(userId, postTitle, session) {
  const settings = await getSettings(session);
  const priceMinor = Number(settings.postPriceMinor || 0);
  if (priceMinor <= 0) return { priceMinor: 0 };
  const user = await User.findById(userId).session(session);
  if (!user || user.walletBalanceMinor < priceMinor) { const error = new Error('Insufficient wallet balance for this post'); error.code = 'INSUFFICIENT_BALANCE'; throw error; }
  user.walletBalanceMinor -= priceMinor;
  user.updatedAt = new Date();
  await user.save({ session });
  await WalletTransaction.create([{ userId, type: 'post_publish', reference: `post:${new mongoose.Types.ObjectId()}`, amountMinor: -priceMinor, balanceAfterMinor: user.walletBalanceMinor, description: `Publishing: ${clean(postTitle, 150)}` }], { session });
  return { priceMinor };
}
async function creditPayment(reference, gatewayData) {
  const session = await mongoose.startSession();
  try {
    let creditedUser = null;
    await session.withTransaction(async () => {
      const payment = await PaymentTransaction.findOne({ reference }).session(session);
      if (!payment) throw new Error('Payment reference not found');
      if (payment.status === 'credited') { creditedUser = await User.findById(payment.userId).session(session); return; }
      if (gatewayData && (Number(gatewayData.amount) !== Number(payment.amountMinor) || String(gatewayData.currency || '').toUpperCase() !== String(payment.currency).toUpperCase())) throw new Error('Payment amount or currency mismatch');
      const user = await User.findById(payment.userId).session(session);
      if (!user) throw new Error('Payment user not found');
      user.walletBalanceMinor += payment.amountMinor;
      user.updatedAt = new Date();
      await user.save({ session });
      await WalletTransaction.create([{ userId: user._id, type: 'topup', reference: `paystack:${reference}`, amountMinor: payment.amountMinor, balanceAfterMinor: user.walletBalanceMinor, description: `Paystack top-up ${reference}`, metadata: { channel: gatewayData?.channel || '', gatewayId: gatewayData?.id || '' } }], { session });
      payment.status = 'credited';
      payment.channel = clean(gatewayData?.channel, 40);
      payment.gatewayData = gatewayData || null;
      payment.creditedAt = new Date();
      payment.updatedAt = new Date();
      await payment.save({ session });
      creditedUser = user;
    });
    return creditedUser;
  } finally { await session.endSession(); }
}
async function initializePaystackTransaction(user, amountMinor) {
  const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secret) { const error = new Error('Paystack is not configured'); error.code = 'PAYSTACK_NOT_CONFIGURED'; throw error; }
  const reference = `LT_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const payload = { email: user.email, amount: amountMinor, currency: PAYSTACK_CURRENCY, reference, callback_url: `${APP_URL}/?payment=complete`, metadata: { userId: String(user._id), username: user.username, purpose: 'wallet_topup' } };
  if (PAYSTACK_CHANNELS.length) payload.channels = PAYSTACK_CHANNELS;
  const response = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status || !data.data?.authorization_url) throw new Error(data.message || `Paystack returned ${response.status}`);
  return { reference, authorizationUrl: data.data.authorization_url, accessCode: data.data.access_code };
}
async function verifyPaystackTransaction(reference) {
  const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secret) { const error = new Error('Paystack is not configured'); error.code = 'PAYSTACK_NOT_CONFIGURED'; throw error; }
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status) throw new Error(data.message || `Paystack returned ${response.status}`);
  return data.data;
}

app.get('/api/health', async (req, res) => {
  try { await connectToDatabase(); res.json({ ok: true, database: 'connected', payments: !!process.env.PAYSTACK_SECRET_KEY, email: !!process.env.RESEND_API_KEY }); }
  catch { res.status(503).json({ ok: false, database: 'unavailable', payments: !!process.env.PAYSTACK_SECRET_KEY, email: !!process.env.RESEND_API_KEY }); }
});
app.get('/api/config', (req, res) => res.json({ whatsappNumber: process.env.WHATSAPP_NUMBER || '', whatsappGroupLink: process.env.WHATSAPP_GROUP_LINK || '', brand: 'Lee Tech', publicSiteBaseUrl: PUBLIC_SITE_BASE_URL, currency: PAYSTACK_CURRENCY, paymentsEnabled: !!process.env.PAYSTACK_SECRET_KEY, emailEnabled: !!process.env.RESEND_API_KEY }));

app.get('/api/products', requireDatabase, async (req, res) => { try { const products = await Product.find().sort({ featured: -1, createdAt: -1 }).limit(24).lean(); res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); res.json(products); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/posts', requireDatabase, async (req, res) => { try { const posts = await Post.find({ published: true, ownerId: null }).sort({ createdAt: -1 }).limit(12).lean(); res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); res.json(posts); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/public/sites/:username', requireDatabase, async (req, res) => { try { const username = normalizeUsername(req.params.username); const user = await User.findOne({ username, emailVerified: true }).lean(); if (!user) return res.status(404).json({ error: 'Public site not found' }); const posts = await Post.find({ ownerId: user._id, published: true }).sort({ createdAt: -1 }).limit(100).lean(); res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); res.json(userSite(user, posts)); } catch { res.status(500).json({ error: 'Unable to load public site' }); } });
app.post('/api/analytics/visit', requireDatabase, async (req, res) => { try { const pathValue = clean(req.body.path || '/', 200).startsWith('/') ? clean(req.body.path || '/', 200) : '/'; const candidate = normalizeUsername(req.body.siteUsername || pathValue.split('/').filter(Boolean)[0] || ''); const owner = validUsername(candidate) ? await User.findOne({ username: candidate, emailVerified: true }).select('_id username').lean() : null; await Visitor.create({ ownerId: owner?._id || null, siteUsername: owner?.username || '', path: pathValue, referrer: clean(req.body.referrer || 'direct', 200), device: deviceFromAgent(req.headers['user-agent']), sessionHash: sessionHash(req) }); res.status(204).end(); } catch { res.status(204).end(); } });
app.get('/api/me/analytics', requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90); const since = new Date(Date.now() - days * 86400000); const match = { ownerId: req.user._id, createdAt: { $gte: since } }; const [summary, daily, devices, sources, pages] = await Promise.all([Visitor.aggregate([{ $match: match }, { $group: { _id: null, visits: { $sum: 1 }, sessions: { $addToSet: '$sessionHash' } } }, { $project: { _id: 0, visits: 1, sessions: { $size: '$sessions' } } }]), Visitor.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, visits: { $sum: 1 }, sessions: { $addToSet: '$sessionHash' } } }, { $project: { _id: 0, date: '$_id', visits: 1, sessions: { $size: '$sessions' } } }, { $sort: { date: 1 } }]), Visitor.aggregate([{ $match: match }, { $group: { _id: '$device', value: { $sum: 1 } } }, { $sort: { value: -1 } }]), Visitor.aggregate([{ $match: match }, { $group: { _id: '$referrer', value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 8 }]), Visitor.aggregate([{ $match: match }, { $group: { _id: '$path', value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 8 }])]); const overview = summary[0] || { visits: 0, sessions: 0 }; res.json({ days, visits: overview.visits || 0, sessions: overview.sessions || 0, daily, devices, sources, pages }); } catch { res.status(500).json({ error: 'Unable to load your analytics' }); } });
app.get('/api/me/security', requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const rows = await SecurityAudit.find({ username: { $in: [req.user.username, req.user.email] } }).sort({ createdAt: -1 }).limit(50).lean(); res.json(rows.map(x => ({ event: x.event, success: x.success, device: x.device, createdAt: x.createdAt }))); } catch { res.status(500).json({ error: 'Unable to load security history' }); } });

app.post('/api/auth/login', loginLimiter, async (req, res) => { const username = clean(req.body.username, 80); const password = String(req.body.password || ''); const valid = username === String(process.env.ADMIN_USERNAME || '') && verifyAdminPassword(password); recordAudit(req, 'sign_in', valid, username); if (valid) { const token = signAdminToken(username); setCookie(res, 'leeAdminSession', token, 60 * 60 * 12); return res.json({ token, message: 'Login successful', device: deviceFromAgent(req.headers['user-agent']) }); } res.status(401).json({ error: 'Invalid credentials' }); });
app.post('/api/auth/user/register', requireDatabase, loginLimiter, async (req, res) => { try { const username = normalizeUsername(req.body.username); const email = normalizeEmail(req.body.email); const password = String(req.body.password || ''); if (!validUsername(username)) return res.status(400).json({ error: 'Choose a username with 3–30 lowercase letters, numbers, or hyphens. That username is reserved or invalid.' }); if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' }); if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' }); if (await User.exists({ $or: [{ username }, { email }] })) return res.status(409).json({ error: 'That username or email is already registered' }); const passwordData = hashPassword(password); const verificationToken = randomToken(); const verificationCode = randomVerificationCode(); const user = await User.create({ username, email, passwordHash: passwordData.hash, passwordSalt: passwordData.salt, emailVerificationTokenHash: hashToken(verificationToken), emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), emailVerificationCodeHash: hashToken(verificationCode), emailVerificationCodeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), displayName: username }); await sendVerificationEmail(user, verificationToken, verificationCode); recordAudit(req, 'user_register', true, username); res.status(201).json({ message: 'Account created. Check your email for a verification link or six-digit code.', user: publicUser(user) }); } catch (error) { if (error?.code === 11000) return res.status(409).json({ error: 'That username or email is already registered' }); res.status(400).json({ error: 'Unable to create account' }); } });
app.post('/api/auth/user/resend-verification', requireDatabase, loginLimiter, async (req, res) => { try { const identifier = normalizeEmail(req.body.email || ''); const username = normalizeUsername(req.body.username || ''); const user = await User.findOne(identifier ? { email: identifier } : { username }); if (!user || user.emailVerified) return res.json({ message: 'If the account exists and still needs verification, a new email has been sent.' }); const verificationToken = randomToken(); const verificationCode = randomVerificationCode(); user.emailVerificationTokenHash = hashToken(verificationToken); user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); user.emailVerificationCodeHash = hashToken(verificationCode); user.emailVerificationCodeExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); user.updatedAt = new Date(); await user.save(); await sendVerificationEmail(user, verificationToken, verificationCode); res.json({ message: 'If the account exists and still needs verification, a new email has been sent.' }); } catch { res.json({ message: 'If the account exists and still needs verification, a new email has been sent.' }); } });
app.get('/api/auth/user/verify-email', requireDatabase, async (req, res) => { try { const token = clean(req.query.token, 200); const code = clean(req.query.code, 6); const username = normalizeUsername(req.query.username); if (!username || (!token && !/^\d{6}$/.test(code))) return res.status(400).json({ error: 'A valid verification link or six-digit code is required' }); const selector = token ? { emailVerificationTokenHash: hashToken(token), emailVerificationExpiresAt: { $gt: new Date() } } : { emailVerificationCodeHash: hashToken(code), emailVerificationCodeExpiresAt: { $gt: new Date() } }; const user = await User.findOne({ username, ...selector }); if (!user) return res.status(400).json({ error: 'Verification link or code is invalid or expired' }); user.emailVerified = true; user.emailVerificationTokenHash = ''; user.emailVerificationExpiresAt = null; user.emailVerificationCodeHash = ''; user.emailVerificationCodeExpiresAt = null; user.updatedAt = new Date(); await user.save(); await sendAccountVerifiedEmail(user); recordAudit(req, 'user_email_verified', true, username); res.json({ message: 'Email verified successfully', user: publicUser(user) }); } catch { res.status(400).json({ error: 'Unable to verify account' }); } });
app.post('/api/auth/user/login', requireDatabase, loginLimiter, async (req, res) => { try { const email = normalizeEmail(req.body.email); const password = String(req.body.password || ''); const user = await User.findOne({ email }); const valid = !!user && verifyPassword(password, user.passwordSalt, user.passwordHash); recordAudit(req, 'user_sign_in', valid, email); if (!valid) return res.status(401).json({ error: 'Invalid email or password' }); if (!user.emailVerified) return res.status(403).json({ error: 'Please verify your email before signing in' }); user.lastSignedIn = new Date(); user.updatedAt = new Date(); await user.save(); const token = signUserToken(user); setCookie(res, 'leeSession', token, 60 * 60 * 24 * 7); res.json({ user: publicUser(user), message: 'Signed in successfully' }); } catch { res.status(400).json({ error: 'Unable to sign in' }); } });
app.post('/api/auth/user/logout', (req, res) => { clearCookie(res, 'leeSession'); res.json({ success: true }); });
app.post('/api/auth/user/forgot-password', requireDatabase, loginLimiter, async (req, res) => { const email = normalizeEmail(req.body.email); const user = await User.findOne({ email }); if (user) { const token = randomToken(); user.passwordResetTokenHash = hashToken(token); user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000); await user.save(); await sendResetEmail(user, token); } res.json({ message: 'If an account exists for that email, a reset link has been sent.' }); });
app.post('/api/auth/user/reset-password', requireDatabase, async (req, res) => { try { const username = normalizeUsername(req.body.username); const token = clean(req.body.token, 200); const password = String(req.body.password || ''); if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' }); const user = await User.findOne({ username, passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: { $gt: new Date() } }); if (!user) return res.status(400).json({ error: 'Reset link is invalid or expired' }); const passwordData = hashPassword(password); user.passwordHash = passwordData.hash; user.passwordSalt = passwordData.salt; user.passwordResetTokenHash = ''; user.passwordResetExpiresAt = null; user.updatedAt = new Date(); await user.save(); await sendAccountUpdateEmail(user, 'Password reset completed'); res.json({ message: 'Password reset successfully' }); } catch { res.status(400).json({ error: 'Unable to reset password' }); } });

app.use('/api/me', requireDatabase);
app.get('/api/me', userAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.put('/api/me/profile', userAuth, verifiedUser, async (req, res) => { const displayName = clean(req.body.displayName || req.user.username, 120); const bio = clean(req.body.bio || '', 600); const changed = displayName !== req.user.displayName || bio !== req.user.bio; req.user.displayName = displayName; req.user.bio = bio; req.user.updatedAt = new Date(); await req.user.save(); if (changed) await sendAccountUpdateEmail(req.user, 'Profile details updated'); res.json({ user: publicUser(req.user) }); });
app.post('/api/auth/user/change-password', requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const currentPassword = String(req.body.currentPassword || ''); const newPassword = String(req.body.newPassword || ''); if (!verifyPassword(currentPassword, req.user.passwordSalt, req.user.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect' }); if (newPassword.length < 12) return res.status(400).json({ error: 'New password must be at least 12 characters' }); const passwordData = hashPassword(newPassword); req.user.passwordHash = passwordData.hash; req.user.passwordSalt = passwordData.salt; req.user.updatedAt = new Date(); await req.user.save(); await sendAccountUpdateEmail(req.user, 'Password changed'); recordAudit(req, 'user_password_changed', true, req.user.username); res.json({ message: 'Password changed successfully' }); } catch { res.status(400).json({ error: 'Unable to change password' }); } });
app.get('/api/me/posts', userAuth, async (req, res) => { res.json(await Post.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).lean()); });
app.post('/api/me/posts', userAuth, verifiedUser, async (req, res) => { const title = clean(req.body.title, 180); const content = clean(req.body.content, 50000); const excerpt = clean(req.body.excerpt || content.slice(0, 220), 500); const image = clean(req.body.image || '', 2000000); const published = req.body.published === true; if (!title || !content) return res.status(400).json({ error: 'Title and content are required' }); const session = await mongoose.startSession(); try { let post; let charge = 0; await session.withTransaction(async () => { const chargeResult = published ? await chargeForPost(req.user._id, title, session) : { priceMinor: 0 }; charge = chargeResult.priceMinor; const created = await Post.create([{ title, content, excerpt, image, author: req.user.displayName || req.user.username, published, ownerId: req.user._id, ownerUsername: req.user.username, updatedAt: new Date() }], { session }); post = created[0]; }); res.status(201).json({ post, chargedMinor: charge }); } catch (error) { if (error.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: 'Insufficient wallet balance. Top up before publishing.' }); res.status(400).json({ error: 'Unable to save post' }); } finally { await session.endSession(); } });
app.put('/api/me/posts/:id', userAuth, verifiedUser, async (req, res) => { const session = await mongoose.startSession(); try { let post; let charge = 0; await session.withTransaction(async () => { const current = await Post.findOne({ _id: req.params.id, ownerId: req.user._id }).session(session); if (!current) { const error = new Error('NOT_FOUND'); error.code = 'NOT_FOUND'; throw error; } const published = req.body.published === true; const title = clean(req.body.title ?? current.title, 180); const content = clean(req.body.content ?? current.content, 50000); if (!title || !content) { const error = new Error('INVALID'); error.code = 'INVALID'; throw error; } if (published && !current.published) charge = (await chargeForPost(req.user._id, title, session)).priceMinor; current.title = title; current.content = content; current.excerpt = clean(req.body.excerpt ?? current.excerpt, 500); current.image = clean(req.body.image ?? current.image, 2000000); current.published = published; current.author = req.user.displayName || req.user.username; current.updatedAt = new Date(); await current.save({ session }); post = current; }); res.json({ post, chargedMinor: charge }); } catch (error) { if (error.code === 'NOT_FOUND') return res.status(404).json({ error: 'Post not found' }); if (error.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: 'Insufficient wallet balance. Top up before publishing.' }); res.status(400).json({ error: 'Unable to update post' }); } finally { await session.endSession(); } });
app.delete('/api/me/posts/:id', userAuth, verifiedUser, async (req, res) => { const result = await Post.deleteOne({ _id: req.params.id, ownerId: req.user._id }); if (!result.deletedCount) return res.status(404).json({ error: 'Post not found' }); res.json({ message: 'Post deleted' }); });

app.get('/api/services', requireDatabase, userAuth, verifiedUser, async (req, res) => res.json(await Service.find({ active: true }).sort({ name: 1 }).lean()));
app.post('/api/services/:id/purchase', requireDatabase, userAuth, verifiedUser, async (req, res) => { const session = await mongoose.startSession(); try { let purchase; await session.withTransaction(async () => { const service = await Service.findOne({ _id: req.params.id, active: true }).session(session); const user = await User.findById(req.user._id).session(session); if (!service || !user) { const error = new Error('NOT_FOUND'); error.code = 'NOT_FOUND'; throw error; } if (user.walletBalanceMinor < service.priceMinor) { const error = new Error('INSUFFICIENT_BALANCE'); error.code = 'INSUFFICIENT_BALANCE'; throw error; } user.walletBalanceMinor -= service.priceMinor; user.updatedAt = new Date(); await user.save({ session }); await WalletTransaction.create([{ userId: user._id, type: 'service_charge', reference: `service:${new mongoose.Types.ObjectId()}`, amountMinor: -service.priceMinor, balanceAfterMinor: user.walletBalanceMinor, description: `Service: ${service.name}`, metadata: { serviceId: service._id } }], { session }); const rows = await Purchase.create([{ userId: user._id, serviceId: service._id, serviceName: service.name, amountMinor: service.priceMinor }], { session }); purchase = rows[0]; }); res.status(201).json({ purchase }); } catch (error) { if (error.code === 'NOT_FOUND') return res.status(404).json({ error: 'Service not found' }); if (error.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: 'Insufficient wallet balance' }); res.status(400).json({ error: 'Unable to purchase service' }); } finally { await session.endSession(); } });
app.get('/api/wallet', requireDatabase, userAuth, verifiedUser, async (req, res) => { const transactions = await WalletTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean(); const payments = await PaymentTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(); const purchases = await Purchase.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(); res.json({ balanceMinor: req.user.walletBalanceMinor, transactions, payments, purchases, currency: PAYSTACK_CURRENCY }); });
app.post('/api/wallet/paystack/initialize', requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const amountMinor = amountToMinor(req.body.amount); if (!amountMinor) return res.status(400).json({ error: 'Enter a valid top-up amount' }); const initialized = await initializePaystackTransaction(req.user, amountMinor); await PaymentTransaction.create({ userId: req.user._id, reference: initialized.reference, amountMinor, currency: PAYSTACK_CURRENCY, authorizationUrl: initialized.authorizationUrl }); res.status(201).json(initialized); } catch (error) { res.status(error.code === 'PAYSTACK_NOT_CONFIGURED' ? 503 : 400).json({ error: error.message || 'Unable to initialize payment' }); } });
app.post('/api/wallet/paystack/verify/:reference', requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const payment = await PaymentTransaction.findOne({ reference: clean(req.params.reference, 120), userId: req.user._id }); if (!payment) return res.status(404).json({ error: 'Payment not found' }); const transaction = await verifyPaystackTransaction(payment.reference); if (transaction.status !== 'success') return res.status(400).json({ error: `Payment is ${transaction.status}` }); const user = await creditPayment(payment.reference, transaction); await safeEmail({ to: user.email, subject: 'Lee Tech wallet top-up confirmed', text: `Your wallet was credited with ${minorToMajor(payment.amountMinor)} ${payment.currency}.`, html: `<p>Your Lee Tech wallet was credited with <strong>${minorToMajor(payment.amountMinor).toFixed(2)} ${escapeHtml(payment.currency)}</strong>.</p>` }); res.json({ message: 'Wallet credited', balanceMinor: user.walletBalanceMinor, transaction }); } catch (error) { res.status(error.code === 'PAYSTACK_NOT_CONFIGURED' ? 503 : 400).json({ error: error.message || 'Unable to verify payment' }); } });
app.post('/api/paystack/webhook', async (req, res) => { const signature = String(req.headers['x-paystack-signature'] || ''); const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim(); const expected = secret && req.rawBody ? crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex') : ''; if (!secret || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(401).json({ error: 'Invalid webhook signature' }); try { const event = req.body || {}; if (event.event === 'charge.success' && event.data?.reference) { const payment = await PaymentTransaction.findOne({ reference: event.data.reference }); if (payment && Number(event.data.amount) === payment.amountMinor && String(event.data.currency || '').toUpperCase() === payment.currency) await creditPayment(payment.reference, event.data); } res.status(200).json({ received: true }); } catch (error) { console.error('Paystack webhook processing error:', error.message); res.status(500).json({ error: 'Webhook processing failed' }); } });

app.use('/api/admin', requireDatabase, adminLimiter, adminAuth);
app.get('/api/admin/stats', async (req, res) => { try { const recent = await SecurityAudit.find().sort({ createdAt: -1 }).limit(8).lean(); const settings = await getSettings(); const [products, posts, featured, visitors, notes, users, verifiedUsers, wallet] = await Promise.all([Product.countDocuments(), Post.countDocuments(), Product.countDocuments({ featured: true }), Visitor.countDocuments(), AdminNote.countDocuments(), User.countDocuments(), User.countDocuments({ emailVerified: true }), User.aggregate([{ $group: { _id: null, total: { $sum: '$walletBalanceMinor' } } }])]); res.json({ products, posts, featured, visitors, notes, users, verifiedUsers, walletBalanceMinor: wallet[0]?.total || 0, postPriceMinor: settings.postPriceMinor || 0, currentDevice: deviceFromAgent(req.headers['user-agent']), recentActivity: recent.map(x => ({ event: x.event, username: x.username, device: x.device, success: x.success, createdAt: x.createdAt })) }); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/admin/users', async (req, res) => { const search = clean(req.query.search || '', 100); const query = search ? { $or: [{ username: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] } : {}; const users = await User.find(query).sort({ createdAt: -1 }).limit(200).lean(); res.json(users.map(user => ({ ...publicUser(user), passwordHash: undefined, passwordSalt: undefined }))); });
app.get('/api/admin/finance', async (req, res) => { const [topups, charges, purchases, users, recentPayments, recentTransactions] = await Promise.all([PaymentTransaction.aggregate([{ $match: { status: 'credited' } }, { $group: { _id: '$currency', totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } }]), WalletTransaction.aggregate([{ $match: { amountMinor: { $lt: 0 } } }, { $group: { _id: '$type', totalMinor: { $sum: { $abs: '$amountMinor' } }, count: { $sum: 1 } } }]), Purchase.countDocuments(), User.countDocuments(), PaymentTransaction.find().sort({ createdAt: -1 }).limit(50).populate('userId', 'username email').lean(), WalletTransaction.find().sort({ createdAt: -1 }).limit(50).populate('userId', 'username email').lean()]); res.json({ users, topups, charges, purchases, recentPayments, recentTransactions }); });
app.get('/api/admin/settings', async (req, res) => res.json(await getSettings()));
app.put('/api/admin/settings', async (req, res) => { const postPriceMinor = amountToMinor(req.body.postPrice, true); if (postPriceMinor === null) return res.status(400).json({ error: 'Enter a valid post price' }); const settings = await AppSettings.findOneAndUpdate({ key: 'main' }, { key: 'main', postPriceMinor, updatedBy: req.admin.username, updatedAt: new Date() }, { upsert: true, new: true, runValidators: true }); res.json(settings); });
app.get('/api/admin/services', async (req, res) => res.json(await Service.find().sort({ createdAt: -1 }).lean()));
app.post('/api/admin/services', async (req, res) => { try { const name = clean(req.body.name, 120); const slug = normalizeUsername(req.body.slug || name.replace(/[^a-z0-9]+/gi, '-')); const priceMinor = amountToMinor(req.body.price, true); if (!name || !validUsername(slug) || priceMinor === null) return res.status(400).json({ error: 'Name, valid slug, and price are required' }); const service = await Service.create({ name, slug, description: clean(req.body.description, 1000), priceMinor, active: req.body.active !== false }); res.status(201).json(service); } catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ error: 'Unable to create service' }); } });
app.put('/api/admin/services/:id', async (req, res) => { try { const priceMinor = amountToMinor(req.body.price, true); if (priceMinor === null) return res.status(400).json({ error: 'Enter a valid price' }); const service = await Service.findByIdAndUpdate(req.params.id, { name: clean(req.body.name, 120), slug: normalizeUsername(req.body.slug), description: clean(req.body.description, 1000), priceMinor, active: req.body.active !== false, updatedAt: new Date() }, { new: true, runValidators: true }); if (!service) return res.status(404).json({ error: 'Service not found' }); res.json(service); } catch { res.status(400).json({ error: 'Unable to update service' }); } });
app.delete('/api/admin/services/:id', async (req, res) => { const result = await Service.findByIdAndDelete(req.params.id); if (!result) return res.status(404).json({ error: 'Service not found' }); res.json({ message: 'Service deleted' }); });
app.post('/api/admin/users/:id/adjust-wallet', async (req, res) => { const rawAmount = Number(req.body.amount); if (!Number.isFinite(rawAmount) || Math.abs(rawAmount) > 100000000 || rawAmount === 0) return res.status(400).json({ error: 'Enter a non-zero valid adjustment amount' }); const amountMinor = Math.round(rawAmount * 100); const session = await mongoose.startSession(); try { let user; await session.withTransaction(async () => { user = await User.findById(req.params.id).session(session); if (!user) { const error = new Error('NOT_FOUND'); error.code = 'NOT_FOUND'; throw error; } if (user.walletBalanceMinor + amountMinor < 0) { const error = new Error('NEGATIVE_BALANCE'); error.code = 'NEGATIVE_BALANCE'; throw error; } user.walletBalanceMinor += amountMinor; await user.save({ session }); await WalletTransaction.create([{ userId: user._id, type: 'admin_adjustment', reference: `admin:${new mongoose.Types.ObjectId()}`, amountMinor, balanceAfterMinor: user.walletBalanceMinor, description: clean(req.body.reason || `Admin adjustment by ${req.admin.username}`, 240), metadata: { admin: req.admin.username } }], { session }); }); res.json({ user: publicUser(user) }); } catch (error) { if (error.code === 'NOT_FOUND') return res.status(404).json({ error: 'User not found' }); if (error.code === 'NEGATIVE_BALANCE') return res.status(400).json({ error: 'Adjustment would create a negative balance' }); res.status(400).json({ error: 'Unable to adjust wallet' }); } finally { await session.endSession(); } });
app.get('/api/admin/security', async (req, res) => { try { const rows = await SecurityAudit.find().sort({ createdAt: -1 }).limit(40).lean(); res.json(rows.map(x => ({ event: x.event, username: x.username, device: x.device, success: x.success, createdAt: x.createdAt }))); } catch { res.status(500).json({ error: 'Unable to read security activity' }); } });
app.get('/api/admin/analytics', async (req, res) => { try { const since = new Date(Date.now() - 30 * 86400000); const rows = await Visitor.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, visits: { $sum: 1 }, sessions: { $addToSet: '$sessionHash' } } }, { $project: { _id: 0, date: '$_id', visits: 1, sessions: { $size: '$sessions' } } }, { $sort: { date: 1 } }]); const devices = await Visitor.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$device', value: { $sum: 1 } } }, { $sort: { value: -1 } }]); const pages = await Visitor.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$path', value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 5 }]); res.json({ daily: rows, devices, pages }); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/admin/notes', async (req, res) => { try { const notes = await AdminNote.find().sort({ updatedAt: -1 }); res.json(notes.map(n => ({ _id: n._id, text: decryptNote(n), createdBy: n.createdBy, createdAt: n.createdAt, updatedAt: n.updatedAt }))); } catch { res.status(500).json({ error: 'Unable to read secure notes' }); } });
app.post('/api/admin/notes', async (req, res) => { try { const text = clean(req.body.text, 10000); if (!text) return res.status(400).json({ error: 'Note text is required' }); const note = await AdminNote.create({ ...encryptNote(text), createdBy: req.admin.username }); res.status(201).json({ _id: note._id, text, createdBy: note.createdBy, createdAt: note.createdAt, updatedAt: note.updatedAt }); } catch { res.status(400).json({ error: 'Unable to save secure note' }); } });
app.put('/api/admin/notes/:id', async (req, res) => { try { const note = await AdminNote.findByIdAndUpdate(req.params.id, { ...encryptNote(clean(req.body.text, 10000)), updatedAt: new Date() }, { new: true }); if (!note) return res.status(404).json({ error: 'Note not found' }); res.json({ _id: note._id, text: decryptNote(note), createdBy: note.createdBy, createdAt: note.createdAt, updatedAt: note.updatedAt }); } catch { res.status(400).json({ error: 'Unable to update note' }); } });
app.delete('/api/admin/notes/:id', async (req, res) => { await AdminNote.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); });

function encryptNote(text) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(requiredEnv('NOTE_ENCRYPTION_KEY')).digest(), iv); const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]); return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }; }
function decryptNote(note) { const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(requiredEnv('NOTE_ENCRYPTION_KEY')).digest(), Buffer.from(note.iv, 'base64')); decipher.setAuthTag(Buffer.from(note.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(note.ciphertext, 'base64')), decipher.final()]).toString('utf8'); }

async function crud(model, req, res, action) {
  try {
    if (action === 'list') return res.json(await model.find().sort({ createdAt: -1 }));
    const body = req.body || {};
    const isProduct = model === Product;
    if (action === 'create') {
      const cleanBody = isProduct ? { name: clean(body.name, 120), description: clean(body.description, 4000), price: Number(body.price), category: clean(body.category || 'General', 80), image: clean(body.image || '', 2000000), featured: Boolean(body.featured) } : { title: clean(body.title, 180), content: clean(body.content, 50000), excerpt: clean(body.excerpt || '', 500), author: clean(body.author || 'Lee Tech', 120), image: clean(body.image || '', 2000000), published: body.published !== false, ownerId: null, ownerUsername: '' };
      if (isProduct && (!cleanBody.name || !cleanBody.description || !Number.isFinite(cleanBody.price) || cleanBody.price < 0)) return res.status(400).json({ error: 'Name, description, and a valid price are required' });
      if (!isProduct && (!cleanBody.title || !cleanBody.content)) return res.status(400).json({ error: 'Title and content are required' });
      const duplicate = await model.findOne(isProduct ? { name: cleanBody.name } : { title: cleanBody.title }).lean();
      if (duplicate) return res.status(409).json({ error: isProduct ? 'A product with this name already exists' : 'A Lee Tech post with this title already exists' });
      return res.status(201).json(await model.create(cleanBody));
    }
    if (action === 'update') {
      const cleanBody = isProduct ? { name: clean(body.name, 120), description: clean(body.description, 4000), price: Number(body.price), category: clean(body.category || 'General', 80), image: clean(body.image || '', 2000000), featured: Boolean(body.featured) } : { title: clean(body.title, 180), content: clean(body.content, 50000), excerpt: clean(body.excerpt || '', 500), author: clean(body.author || 'Lee Tech', 120), image: clean(body.image || '', 2000000), published: body.published !== false, ownerId: null, ownerUsername: '' };
      if (isProduct && (!cleanBody.name || !cleanBody.description || !Number.isFinite(cleanBody.price) || cleanBody.price < 0)) return res.status(400).json({ error: 'Invalid product fields' });
      if (!isProduct && (!cleanBody.title || !cleanBody.content)) return res.status(400).json({ error: 'Invalid post fields' });
      const duplicate = await model.findOne({ ...(isProduct ? { name: cleanBody.name } : { title: cleanBody.title }), _id: { $ne: req.params.id }, ownerId: isProduct ? undefined : null }).lean();
      if (duplicate) return res.status(409).json({ error: 'Another item with the same name or title already exists' });
      const doc = await model.findOneAndUpdate(isProduct ? { _id: req.params.id } : { _id: req.params.id, ownerId: null }, cleanBody, { new: true, runValidators: true });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      return res.json(doc);
    }
    if (action === 'delete') { const doc = await model.findOneAndDelete(isProduct ? { _id: req.params.id } : { _id: req.params.id, ownerId: null }); if (!doc) return res.status(404).json({ error: 'Not found' }); return res.json({ message: 'Deleted' }); }
  } catch { res.status(400).json({ error: 'Unable to process request' }); }
}
app.get('/api/admin/products', (req, res) => crud(Product, req, res, 'list'));
app.post('/api/admin/products', (req, res) => crud(Product, req, res, 'create'));
app.put('/api/admin/products/:id', (req, res) => crud(Product, req, res, 'update'));
app.delete('/api/admin/products/:id', (req, res) => crud(Product, req, res, 'delete'));
app.get('/api/admin/posts', (req, res) => crud(Post, req, res, 'list'));
app.post('/api/admin/posts', (req, res) => crud(Post, req, res, 'create'));
app.put('/api/admin/posts/:id', (req, res) => crud(Post, req, res, 'update'));
app.delete('/api/admin/posts/:id', (req, res) => crud(Post, req, res, 'delete'));

app.get('/app-upgrade.js', (req, res) => { res.type('application/javascript').set('Cache-Control', 'no-store').send(upgradeScript); });
app.get('/share-card.png', async (req, res) => { try { const title = clean(req.query.title || 'Lee Tech', 90); const subtitle = clean(req.query.subtitle || 'Technology with intention.', 170); const kicker = clean(req.query.kicker || 'LEE TECH COMMUNITY', 42); const image = await renderShareCard({ title, subtitle, kicker }); res.type('png').set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400').send(image); } catch (error) { console.error('Share-card generation error:', error.message); res.status(500).end(); } });
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
app.use((err, req, res, next) => { if (err?.message === 'CORS origin is not allowed') return res.status(403).json({ error: 'CORS origin is not allowed' }); console.error(err); return res.status(500).json({ error: 'Server error' }); });
app.get('*', (req, res) => res.type('html').send(shareMetadata(req).replaceAll('__CSP_NONCE__', res.locals.cspNonce)));

if (!isProduction) app.listen(process.env.PORT || 3000, () => console.log(`Lee Tech running on http://localhost:${process.env.PORT || 3000}`));
module.exports = app;
