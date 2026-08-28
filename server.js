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
const compression = require('compression');
const crypto = require('crypto');
const sharp = require('sharp');

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
const MIN_SECRET_LENGTH = 32;
const ACTIVITY_RETENTION_SECONDS = 24 * 60 * 60;
function normalizeBaseUrl(value, fallback) { const raw = String(value || fallback).trim(); const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`; try { return new URL(withScheme).toString().replace(/\/$/, ''); } catch { return fallback; } }
function paymentReturnUrl(value, fallback) { try { const url = new URL(normalizeBaseUrl(value, fallback)); url.searchParams.set('payment', 'complete'); url.searchParams.set('destination', 'account'); url.searchParams.set('view', 'wallet'); return url.toString(); } catch { return `${fallback}/?payment=complete&destination=account&view=wallet`; } }
const APP_URL = normalizeBaseUrl(process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL, 'http://localhost:3000');
const PUBLIC_SITE_BASE_URL = normalizeBaseUrl(process.env.PUBLIC_SITE_BASE_URL || APP_URL, APP_URL);
const PAYSTACK_CALLBACK_URL = paymentReturnUrl(process.env.PAYSTACK_CALLBACK_URL || PUBLIC_SITE_BASE_URL, PUBLIC_SITE_BASE_URL);
const PAYSTACK_CURRENCY = String(process.env.PAYSTACK_CURRENCY || 'KES').toUpperCase();
const PAYSTACK_SUPPORTED_CHANNELS = new Set(['card', 'bank', 'apple_pay', 'ussd', 'qr', 'mobile_money', 'bank_transfer', 'eft', 'capitec_pay', 'payattitude']);
const PAYSTACK_CHANNELS = String(process.env.PAYSTACK_CHANNELS || '').split(',').map(x => x.trim()).filter(x => PAYSTACK_SUPPORTED_CHANNELS.has(x));
const PAYSTACK_MINIMUM_MINOR = PAYSTACK_CURRENCY === 'KES' ? 400 : 1;
const WELCOME_CREDIT_MINOR = 1000;
const htmlPath = path.join(process.cwd(), 'index.html');
const upgradeScriptPath = path.join(process.cwd(), 'app-upgrade.js');
const serviceWorkerPath = path.join(process.cwd(), 'sw.js');
const offlinePagePath = path.join(process.cwd(), 'offline.html');
const htmlTemplate = fs.readFileSync(htmlPath, 'utf8');
const upgradeScript = fs.existsSync(upgradeScriptPath) ? fs.readFileSync(upgradeScriptPath, 'utf8') : '';
const serviceWorkerScript = fs.existsSync(serviceWorkerPath) ? fs.readFileSync(serviceWorkerPath, 'utf8') : '';
const offlinePage = fs.existsSync(offlinePagePath) ? fs.readFileSync(offlinePagePath, 'utf8') : '<!doctype html><title>Offline</title><p>You are offline.</p>';
const packageVersion = (() => { try { return require(path.join(process.cwd(), 'package.json')).version; } catch { return 'dev'; } })();
const BUILD_VERSION = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || process.env.BUILD_VERSION || packageVersion || 'dev');
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
app.use(compression({ threshold: 1024 }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.has(origin)) return callback(null, true);
    return callback(new Error('CORS origin is not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '15mb', verify(req, res, buffer) { req.rawBody = Buffer.from(buffer); } }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
if (!isProduction) app.use(morgan('dev'));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, validate: { xForwardedForHeader: false } }));
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Admin request limit reached. Please try again later.' }, validate: { xForwardedForHeader: false } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please wait 15 minutes.' }, validate: { xForwardedForHeader: false } });
const signupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-up attempts. Please wait 15 minutes.' }, validate: { xForwardedForHeader: false } });
const emailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many automated email requests. Please try again later.' }, validate: { xForwardedForHeader: false } });

let dbPromise = null;
let activityRetentionIndexPromise = null;
async function ensureActivityRetentionIndexes(connection) {
  if (activityRetentionIndexPromise) return activityRetentionIndexPromise;
  activityRetentionIndexPromise = Promise.all([
    ['visitors', 'Visitor activity'],
    ['securityaudits', 'Security audit activity']
  ].map(async ([collectionName, label]) => {
    try {
      await connection.db.command({ collMod: collectionName, index: { keyPattern: { createdAt: 1 }, expireAfterSeconds: ACTIVITY_RETENTION_SECONDS } });
    } catch (error) {
      const message = String(error?.message || '');
      if (!/not found|cannot find|namespace/i.test(message)) throw error;
      try {
        await connection.db.collection(collectionName).createIndex({ createdAt: 1 }, { name: 'createdAt_1', expireAfterSeconds: ACTIVITY_RETENTION_SECONDS });
      } catch (createError) {
        createError.message = `${label} retention index setup failed: ${createError.message}`;
        throw createError;
      }
    }
  }))
    .catch(error => { activityRetentionIndexPromise = null; throw error; });
  return activityRetentionIndexPromise;
}
async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (dbPromise) return dbPromise;
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is not configured');
  dbPromise = mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 10, bufferCommands: false })
    .then(async connection => { await ensureActivityRetentionIndexes(connection); return connection; })
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
const productSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, maxlength: 120 }, description: { type: String, required: true, trim: true, maxlength: 4000 }, price: { type: Number, required: true, min: 0 }, priceOnRequest: { type: Boolean, default: false }, productType: { type: String, enum: ['digital', 'physical'], default: 'digital' }, stock: { type: Number, min: 0, default: null }, category: { type: String, default: 'General', trim: true, maxlength: 80 }, image: { type: String, default: '', maxlength: 2000000 }, featured: { type: Boolean, default: false }, published: { type: Boolean, default: true }, moderationStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true }, moderationNote: { type: String, default: '', trim: true, maxlength: 500 }, moderatedAt: { type: Date, default: null }, moderatedBy: { type: String, default: '' }, createdAt: { type: Date, default: Date.now }, expiresAt: { type: Date, default: null } });
productSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const postSchema = new mongoose.Schema({ title: { type: String, required: true, trim: true, maxlength: 180 }, content: { type: String, required: true, trim: true, maxlength: 50000 }, excerpt: { type: String, default: '', trim: true, maxlength: 500 }, visitorLink: { type: String, default: '', trim: true, maxlength: 500 }, image: { type: String, default: '', maxlength: 2000000 }, author: { type: String, default: 'Lee Tech', trim: true, maxlength: 120 }, contentType: { type: String, enum: ['blog', 'product'], default: 'blog' }, productType: { type: String, enum: ['digital', 'physical'], default: 'digital' }, priceMinor: { type: Number, min: 0, default: 0 }, stock: { type: Number, min: 0, default: null }, published: { type: Boolean, default: true }, moderationStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved', index: true }, moderationNote: { type: String, default: '', trim: true, maxlength: 500 }, moderatedAt: { type: Date, default: null }, moderatedBy: { type: String, default: '' }, ownerId: { type: objectId, ref: 'User', default: null, index: true }, ownerUsername: { type: String, default: '', trim: true, index: true }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }, expiresAt: { type: Date, default: null } });
postSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
postSchema.index({ ownerId: 1, published: 1, createdAt: -1 });
const visitorSchema = new mongoose.Schema({ ownerId: { type: objectId, ref: 'User', default: null, index: true }, siteUsername: { type: String, default: '', trim: true, lowercase: true, index: true }, path: { type: String, default: '/', maxlength: 200 }, referrer: { type: String, default: 'direct', maxlength: 200 }, device: { type: String, default: 'desktop', maxlength: 20 }, country: { type: String, default: 'unknown', maxlength: 80 }, sessionHash: String, createdAt: { type: Date, default: Date.now } });
visitorSchema.index({ ownerId: 1, createdAt: -1 });
visitorSchema.index({ createdAt: 1 }, { expireAfterSeconds: ACTIVITY_RETENTION_SECONDS });
const noteSchema = new mongoose.Schema({ ciphertext: { type: String, required: true }, iv: { type: String, required: true }, tag: { type: String, required: true }, createdBy: { type: String, default: 'admin' }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } });
const auditSchema = new mongoose.Schema({ event: { type: String, required: true }, username: { type: String, default: '' }, device: { type: String, default: 'unknown' }, userAgent: { type: String, default: '' }, ipHash: { type: String, default: '' }, success: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now } });
auditSchema.index({ createdAt: -1 });
auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: ACTIVITY_RETENTION_SECONDS });

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
  suspended: { type: Boolean, default: false, index: true },
  suspendedAt: { type: Date, default: null },
  suspendedBy: { type: String, default: '' },
  suspensionReason: { type: String, default: '', trim: true, maxlength: 500 },
  displayName: { type: String, default: '', trim: true, maxlength: 120 },
  bio: { type: String, default: '', trim: true, maxlength: 600 },
  contact: {
    whatsappNumber: { type: String, default: '', trim: true, maxlength: 40 },
    phoneNumber: { type: String, default: '', trim: true, maxlength: 40 },
    whatsappGroupLink: { type: String, default: '', trim: true, maxlength: 500 },
    instagramUrl: { type: String, default: '', trim: true, maxlength: 500 },
    facebookUrl: { type: String, default: '', trim: true, maxlength: 500 },
    xUrl: { type: String, default: '', trim: true, maxlength: 500 },
    linkedinUrl: { type: String, default: '', trim: true, maxlength: 500 },
    tiktokUrl: { type: String, default: '', trim: true, maxlength: 500 },
    youtubeUrl: { type: String, default: '', trim: true, maxlength: 500 },
    telegramUrl: { type: String, default: '', trim: true, maxlength: 500 },
    websiteUrl: { type: String, default: '', trim: true, maxlength: 500 }
  },
  walletBalanceMinor: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastSignedIn: { type: Date, default: null }
});
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });
const paymentSchema = new mongoose.Schema({ userId: { type: objectId, ref: 'User', required: true, index: true }, reference: { type: String, required: true, unique: true }, amountMinor: { type: Number, required: true, min: 1 }, currency: { type: String, required: true, default: 'KES' }, status: { type: String, enum: ['pending', 'credited', 'failed'], default: 'pending' }, authorizationUrl: { type: String, default: '' }, channel: { type: String, default: '' }, gatewayData: { type: mongoose.Schema.Types.Mixed, default: null }, creditedAt: { type: Date, default: null }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } });
const walletTransactionSchema = new mongoose.Schema({ userId: { type: objectId, ref: 'User', required: true, index: true }, type: { type: String, enum: ['topup', 'welcome_credit', 'post_publish', 'service_charge', 'admin_adjustment', 'refund'], required: true }, reference: { type: String, required: true, unique: true }, amountMinor: { type: Number, required: true }, balanceAfterMinor: { type: Number, required: true, min: 0 }, description: { type: String, default: '', maxlength: 240 }, metadata: { type: mongoose.Schema.Types.Mixed, default: null }, status: { type: String, enum: ['completed'], default: 'completed' }, createdAt: { type: Date, default: Date.now } });
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
const serviceSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, maxlength: 120 }, slug: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 80 }, description: { type: String, default: '', trim: true, maxlength: 1000 }, priceMinor: { type: Number, required: true, min: 0 }, active: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } });
serviceSchema.index({ slug: 1 }, { unique: true });
const purchaseSchema = new mongoose.Schema({ userId: { type: objectId, ref: 'User', required: true, index: true }, serviceId: { type: objectId, ref: 'Service', required: true }, serviceName: { type: String, required: true }, amountMinor: { type: Number, required: true, min: 0 }, status: { type: String, enum: ['completed'], default: 'completed' }, createdAt: { type: Date, default: Date.now } });
const settingsSchema = new mongoose.Schema({ key: { type: String, unique: true, default: 'main' }, postPriceMinor: { type: Number, min: 0, default: 0 }, siteMaintenance: { type: Boolean, default: false }, siteMaintenanceMessage: { type: String, default: 'Lee Tech is temporarily unavailable while we make improvements.', maxlength: 240 }, paymentsMaintenance: { type: Boolean, default: false }, paymentsMaintenanceMessage: { type: String, default: 'Payments are temporarily unavailable. Please try again later.', maxlength: 240 }, signupsRestricted: { type: Boolean, default: false }, signupRestrictionMessage: { type: String, default: 'New account registration is temporarily paused. Please try again later.', maxlength: 240 }, updatedBy: { type: String, default: 'system' }, updatedAt: { type: Date, default: Date.now } });

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
function normalizeImage(value) {
  const image = String(value ?? '').trim();
  if (!image) return '';
  if (image.length > 2000000) throw new Error('Image must be 2 MB or smaller after compression');
  if (/^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(image)) return image;
  try { const parsed = new URL(image); if (['http:', 'https:'].includes(parsed.protocol)) return parsed.toString(); } catch {}
  throw new Error('Image must be a valid http(s) URL or compressed JPG, PNG, WEBP, or GIF upload');
}
async function optimizeProductImage(value) {
  const image = normalizeImage(value);
  if (!image || !image.startsWith('data:image/')) return image;
  const match = image.match(/^data:image\/(?:jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return image;
  try {
    const optimized = await sharp(Buffer.from(match[1], 'base64'), { limitInputPixels: 40000000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer();
    const result = `data:image/webp;base64,${optimized.toString('base64')}`;
    if (result.length > 2000000) throw new Error('Image must be 2 MB or smaller after optimization');
    return result;
  } catch (error) {
    if (error.message.includes('2 MB')) throw error;
    throw new Error('Image upload could not be optimized');
  }
}
function normalizeContentType(value) { return value === 'product' ? 'product' : 'blog'; }
function normalizeProductType(value) { if (value === 'physical') return 'physical'; if (value === 'digital' || value == null || value === '') return 'digital'; throw new Error('Product type must be digital or physical'); }
function normalizeStock(value, productType) {
  if (productType !== 'physical' || value == null || String(value).trim() === '') return null;
  const stock = Number(value);
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000000) throw new Error('Physical product stock must be a whole number from 0 to 100000000');
  return stock;
}
function normalizePostFields(body = {}, current = {}) {
  const title = clean(body.title ?? current.title, 180);
  const content = clean(body.content ?? current.content, 50000);
  const excerpt = clean(body.excerpt ?? current.excerpt ?? (content ? content.slice(0, 220) : ''), 500);
  const contentType = normalizeContentType(body.contentType ?? current.contentType);
  const productType = contentType === 'product' ? normalizeProductType(body.productType ?? current.productType) : 'digital';
  let priceMinor = 0;
  if (contentType === 'product') {
    const rawPrice = body.price ?? (current.priceMinor != null ? minorToMajor(current.priceMinor) : '');
    if (String(rawPrice).trim() === '') throw new Error('Product price is required');
    priceMinor = amountToMinor(rawPrice, true);
    if (priceMinor === null) throw new Error('Enter a valid product price');
  }
  const stock = normalizeStock(body.stock ?? current.stock, productType);
  if (contentType === 'product' && productType === 'physical' && stock === null) throw new Error('Physical products require a stock quantity');
  return { title, content, excerpt, image: normalizeImage(body.image ?? current.image), contentType, productType, priceMinor, stock, published: body.published === true };
}
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
const CONTACT_URL_FIELDS = ['whatsappGroupLink', 'instagramUrl', 'facebookUrl', 'xUrl', 'linkedinUrl', 'tiktokUrl', 'youtubeUrl', 'telegramUrl', 'websiteUrl'];
function normalizeContactUrl(value, label) {
  const raw = clean(value, 500);
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('invalid protocol');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${label} must be a valid http(s) link`);
  }
}
function normalizeContactLinks(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const whatsappNumber = clean(raw.whatsappNumber, 40);
  const whatsappDigits = whatsappNumber.replace(/\D/g, '');
  if (whatsappNumber && (whatsappDigits.length < 7 || whatsappDigits.length > 15)) throw new Error('WhatsApp number must include 7–15 digits, preferably with a country code');
  const phoneNumber = clean(raw.phoneNumber, 40);
  const phoneDigits = phoneNumber.replace(/\D/g, '');
  if (phoneNumber && (phoneDigits.length < 7 || phoneDigits.length > 15)) throw new Error('Phone number must include 7–15 digits, preferably with a country code');
  const contact = { whatsappNumber, phoneNumber };
  const labels = { whatsappGroupLink: 'WhatsApp group link', instagramUrl: 'Instagram link', facebookUrl: 'Facebook link', xUrl: 'X link', linkedinUrl: 'LinkedIn link', tiktokUrl: 'TikTok link', youtubeUrl: 'YouTube link', telegramUrl: 'Telegram link', websiteUrl: 'Website link' };
  CONTACT_URL_FIELDS.forEach(field => { contact[field] = normalizeContactUrl(raw[field], labels[field]); });
  return contact;
}
function contactLinksForView(value = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const result = { whatsappNumber: clean(raw.whatsappNumber, 40), phoneNumber: clean(raw.phoneNumber, 40) };
  CONTACT_URL_FIELDS.forEach(field => { try { result[field] = normalizeContactUrl(raw[field], field); } catch { result[field] = ''; } });
  return result;
}
function publicUser(user) { return { id: user._id, username: user.username, email: user.email, emailVerified: !!user.emailVerified, role: user.role, suspended: !!user.suspended, displayName: user.displayName || user.username, bio: user.bio || '', contact: contactLinksForView(user.contact), walletBalanceMinor: user.walletBalanceMinor || 0, siteUrl: `${PUBLIC_SITE_BASE_URL}/${user.username}`, createdAt: user.createdAt, lastSignedIn: user.lastSignedIn }; }
function userSite(user, posts, products = []) { return { user: { username: user.username, displayName: user.displayName || user.username, bio: user.bio || '', contact: contactLinksForView(user.contact), siteUrl: `${PUBLIC_SITE_BASE_URL}/${user.username}` }, posts, products }; }

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
function wrapShareText(value, maxChars) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxChars) { lines.push(line); line = word; } else line = next;
  });
  if (line) lines.push(line);
  return lines.length ? lines.slice(0, 3) : ['Lee Tech'];
}
function shareCardSvg({ title = 'Lee Tech', subtitle = 'Technology with intention.', kicker = 'LEE TECH COMMUNITY' } = {}) {
  const titleLines = wrapShareText(clean(title || 'Lee Tech', 90), 32).map(escapeHtml);
  const subtitleLines = wrapShareText(clean(subtitle || 'Technology with intention.', 170), 58).map(escapeHtml);
  const safeKicker = escapeHtml(clean(kicker || 'LEE TECH COMMUNITY', 42));
  const titleSvg = titleLines.map((line, index) => `<text x="120" y="${310 + index * 52}" fill="#10203a" font-family="DejaVu Sans" font-size="42" font-weight="700">${line}</text>`).join('');
  const subtitleSvg = subtitleLines.map((line, index) => `<text x="120" y="${420 + index * 30}" fill="#60708a" font-family="DejaVu Sans" font-size="21">${line}</text>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#09152b"/><stop offset=".62" stop-color="#153b83"/><stop offset="1" stop-color="#2456d7"/></linearGradient><linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#bdebdc"/><stop offset="1" stop-color="#f1b247"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#071126" flood-opacity=".28"/></filter></defs><rect width="1200" height="630" fill="#eef2f7"/><rect x="26" y="26" width="1148" height="578" rx="42" fill="url(#bg)"/><path d="M760 26h414v240c-106 45-212 42-314-24-94-61-130-129-100-216Z" fill="#3470e8" opacity=".42"/><circle cx="1035" cy="92" r="188" fill="#5b8dff" opacity=".2"/><circle cx="92" cy="615" r="220" fill="#57c7ae" opacity=".26"/><path d="M26 470c150-78 264-66 381 32 52 44 100 78 150 102H26Z" fill="#bdebdc" opacity=".13"/><g font-family="DejaVu Sans"><rect x="86" y="82" width="62" height="62" rx="19" fill="#bdebdc"/><text x="117" y="123" text-anchor="middle" fill="#0b1830" font-size="34" font-weight="700">L</text><text x="178" y="104" fill="#bdebdc" font-size="15" font-weight="700" letter-spacing="3">${safeKicker}</text><text x="178" y="137" fill="#ffffff" font-size="26" font-weight="700">Lee Tech</text><rect x="86" y="186" width="1028" height="326" rx="34" fill="#ffffff" filter="url(#shadow)"/><rect x="120" y="232" width="76" height="6" rx="3" fill="url(#accent)"/>${titleSvg}${subtitleSvg}<text x="120" y="482" fill="#1f5eff" font-size="16" font-weight="700" letter-spacing="1">POST.LEETEC.ONLINE</text><text x="1080" y="482" text-anchor="end" fill="#7d8798" font-size="16">Powered by Lee Tech</text></g></svg>`;
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
  const shareProductId = String(req.query.shareProduct || '').trim();
  const imageUrl = mongoose.Types.ObjectId.isValid(shareProductId) ? new URL('/share-product-image.png', APP_URL) : new URL('/homepage-share-image.png', APP_URL);
  if (mongoose.Types.ObjectId.isValid(shareProductId)) imageUrl.searchParams.set('product', shareProductId);
  const imageMeta = mongoose.Types.ObjectId.isValid(shareProductId) ? '' : '<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">';
  return htmlTemplate.replace('<title>Lee Tech — Technology with intention</title>', `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:site_name" content="Lee Tech"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(pageUrl)}"><meta property="og:image" content="${escapeHtml(imageUrl.toString())}">${imageMeta}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(imageUrl.toString())}">`);
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
    if (user.suspended) return res.status(403).json({ error: 'This creator account is suspended. Contact Lee Tech support.' });
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
  const body = `<p style="color:#6d7b92">Welcome to Lee Tech, <strong>${escapeHtml(user.username)}</strong>. Verify your email to activate your creator site and start publishing.</p><p style="color:#6d7b92">Your new creator account includes a free <strong>KES 10.00 welcome credit</strong> for publishing and paid Lee Tech services.</p><div style="background:#eef3ff;border-radius:14px;padding:18px;margin:20px 0"><div style="font-size:12px;color:#6d7b92;text-transform:uppercase;letter-spacing:.12em;font-weight:700">Verification code</div><div style="font-size:32px;letter-spacing:.22em;font-weight:800;color:#12233f;margin-top:6px">${escapeHtml(code)}</div><div style="font-size:12px;color:#6d7b92;margin-top:5px">This code expires in 24 hours.</div></div>`;
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
  return row || { key: 'main', postPriceMinor: amountToMinor(process.env.POST_PRICE_KES || 0, true) || 0, siteMaintenance: false, siteMaintenanceMessage: 'Lee Tech is temporarily unavailable while we make improvements.', paymentsMaintenance: false, paymentsMaintenanceMessage: 'Payments are temporarily unavailable. Please try again later.', signupsRestricted: false, signupRestrictionMessage: 'New account registration is temporarily paused. Please try again later.', updatedBy: 'environment' };
}
async function chargeForPost(userId, postTitle, session, expectedPriceMinor = null, contentType = 'product') {
  if (contentType !== 'product') return { priceMinor: 0, balanceAfterMinor: null };
  const settings = await getSettings(session);
  const priceMinor = Number(settings.postPriceMinor || 0);
  if (expectedPriceMinor !== null && Number(expectedPriceMinor) !== priceMinor) { const error = new Error('Publishing price changed'); error.code = 'POST_PRICE_CHANGED'; error.currentPriceMinor = priceMinor; throw error; }
  if (priceMinor <= 0) return { priceMinor: 0, balanceAfterMinor: null };
  const user = await User.findById(userId).session(session);
  if (!user || user.walletBalanceMinor < priceMinor) { const error = new Error('Insufficient wallet balance for this post'); error.code = 'INSUFFICIENT_BALANCE'; throw error; }
  user.walletBalanceMinor -= priceMinor;
  user.updatedAt = new Date();
  await user.save({ session });
  await WalletTransaction.create([{ userId, type: 'post_publish', reference: `post:${new mongoose.Types.ObjectId()}`, amountMinor: -priceMinor, balanceAfterMinor: user.walletBalanceMinor, description: `Product publishing: ${clean(postTitle, 150)}` }], { session });
  return { priceMinor, balanceAfterMinor: user.walletBalanceMinor };
}
async function createWelcomeUser(userData, session) {
  const user = (await User.create([{ ...userData, walletBalanceMinor: WELCOME_CREDIT_MINOR, updatedAt: new Date() }], { session }))[0];
  await WalletTransaction.create([{ userId: user._id, type: 'welcome_credit', reference: `welcome:${user._id}`, amountMinor: WELCOME_CREDIT_MINOR, balanceAfterMinor: WELCOME_CREDIT_MINOR, description: 'Free KES 10.00 welcome credit for posting and paid services' }], { session });
  return user;
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
  // Paystack references allow alphanumeric characters plus -, ., and = only.
  const reference = `LT-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const payload = { email: user.email, amount: String(amountMinor), currency: PAYSTACK_CURRENCY, reference, callback_url: PAYSTACK_CALLBACK_URL, metadata: JSON.stringify({ userId: String(user._id), username: user.username, purpose: 'wallet_topup' }) };
  if (PAYSTACK_CHANNELS.length) payload.channels = PAYSTACK_CHANNELS;
  let response;
  try {
    response = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  } catch (error) {
    const timeoutError = new Error(error?.name === 'TimeoutError' ? 'Paystack checkout timed out. Please try again.' : 'Unable to reach Paystack. Please try again.');
    timeoutError.code = 'PAYSTACK_UNAVAILABLE';
    throw timeoutError;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status || !data.data?.authorization_url) { const message = data.message || data.data?.message || `Paystack returned ${response.status}`; throw new Error(message); }
  return { reference: data.data.reference || reference, authorizationUrl: data.data.authorization_url, accessCode: data.data.access_code };
}
async function verifyPaystackTransaction(reference) {
  const secret = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secret) { const error = new Error('Paystack is not configured'); error.code = 'PAYSTACK_NOT_CONFIGURED'; throw error; }
  const normalizedReference = clean(reference, 120);
  if (!/^[A-Za-z0-9.=-]+$/.test(normalizedReference)) throw new Error('Invalid Paystack payment reference');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(normalizedReference)}`, { headers: { Authorization: `Bearer ${secret}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status || !data.data) throw new Error(data.message || `Paystack returned ${response.status}`);
  if (String(data.data.reference || '') !== normalizedReference) throw new Error('Paystack returned a mismatched payment reference');
  return data.data;
}

async function readDatabaseHealth() {
  const startedAt = Date.now();
  try {
    const connection = await connectToDatabase();
    const stats = await connection.db.command({ dbStats: 1, scale: 1024 * 1024 });
    return { status: 'connected', database: connection.name, responseMs: Date.now() - startedAt, collections: Number(stats.collections || 0), dataSizeMb: Number(stats.dataSize || 0), storageSizeMb: Number(stats.storageSize || 0), indexSizeMb: Number(stats.indexSize || 0), objects: Number(stats.objects || 0), availableSpaceMb: null, capacityNote: 'MongoDB dbStats reports database usage. Provider-level free space is not exposed by this connection.' };
  } catch (error) {
    return { status: 'unavailable', responseMs: Date.now() - startedAt, error: 'Database connection or statistics query failed. Check MongoDB availability and Vercel environment settings.' };
  }
}
app.get('/api/admin/health', adminLimiter, adminAuth, async (req, res) => res.json(await readDatabaseHealth()));

app.get('/api/health', async (req, res) => {
  try { await connectToDatabase(); res.json({ ok: true, database: 'connected', payments: !!process.env.PAYSTACK_SECRET_KEY, email: !!process.env.RESEND_API_KEY }); }
  catch { res.status(503).json({ ok: false, database: 'unavailable', payments: !!process.env.PAYSTACK_SECRET_KEY, email: !!process.env.RESEND_API_KEY }); }
});
app.get('/api/config', async (req, res) => { let settings = null; try { await connectToDatabase(); settings = await getSettings(); } catch {} res.json({ whatsappNumber: process.env.WHATSAPP_NUMBER || '', whatsappGroupLink: process.env.WHATSAPP_GROUP_LINK || '', brand: 'Lee Tech', publicSiteBaseUrl: PUBLIC_SITE_BASE_URL, currency: PAYSTACK_CURRENCY, paymentsEnabled: !!process.env.PAYSTACK_SECRET_KEY && !settings?.paymentsMaintenance, paymentMaintenance: !!settings?.paymentsMaintenance, paymentMaintenanceMessage: settings?.paymentsMaintenanceMessage || 'Payments are temporarily unavailable. Please try again later.', siteMaintenance: !!settings?.siteMaintenance, siteMaintenanceMessage: settings?.siteMaintenanceMessage || 'Lee Tech is temporarily unavailable while we make improvements.', signupsRestricted: !!settings?.signupsRestricted, signupRestrictionMessage: settings?.signupRestrictionMessage || 'New account registration is temporarily paused. Please try again later.', emailEnabled: !!process.env.RESEND_API_KEY }); });

app.get('/api/products', requireDatabase, async (req, res) => { try { const products = await Product.find({ published: true, $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }] }).sort({ featured: -1, createdAt: -1 }).limit(24).lean(); res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); res.json(products); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/posts', requireDatabase, async (req, res) => { try { const posts = await Post.find({ published: true, ownerId: null, $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }] }).sort({ createdAt: -1 }).limit(12).lean(); res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); res.json(posts); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/public/sites/:username', requireDatabase, async (req, res) => { try { const username = normalizeUsername(req.params.username); const user = await User.findOne({ username, emailVerified: true, $or: [{ suspended: false }, { suspended: { $exists: false } }] }).lean(); if (!user) return res.status(404).json({ error: 'Public site not found' }); const content = await Post.find({ ownerId: user._id, published: true, $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }] }).sort({ createdAt: -1 }).limit(100).lean(); const posts = content.filter(item => item.contentType !== 'product'); const products = content.filter(item => item.contentType === 'product'); res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); res.json(userSite(user, posts, products)); } catch { res.status(500).json({ error: 'Unable to load public site' }); } });
app.post('/api/analytics/visit', requireDatabase, async (req, res) => { try { const pathValue = clean(req.body.path || '/', 200).startsWith('/') ? clean(req.body.path || '/', 200) : '/'; const candidate = normalizeUsername(req.body.siteUsername || pathValue.split('/').filter(Boolean)[0] || ''); const owner = validUsername(candidate) ? await User.findOne({ username: candidate, emailVerified: true }).select('_id username').lean() : null; await Visitor.create({ ownerId: owner?._id || null, siteUsername: owner?.username || '', path: pathValue, referrer: clean(req.body.referrer || 'direct', 200), device: deviceFromAgent(req.headers['user-agent']), sessionHash: sessionHash(req) }); res.status(204).end(); } catch { res.status(204).end(); } });
app.get('/api/me/analytics', requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const days = Math.min(Math.max(Number(req.query.days) || 1, 1), 1); const since = new Date(Date.now() - days * 86400000); const match = { ownerId: req.user._id, createdAt: { $gte: since } }; const [summary, daily, devices, sources, pages] = await Promise.all([Visitor.aggregate([{ $match: match }, { $group: { _id: null, visits: { $sum: 1 }, sessions: { $addToSet: '$sessionHash' } } }, { $project: { _id: 0, visits: 1, sessions: { $size: '$sessions' } } }]), Visitor.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, visits: { $sum: 1 }, sessions: { $addToSet: '$sessionHash' } } }, { $project: { _id: 0, date: '$_id', visits: 1, sessions: { $size: '$sessions' } } }, { $sort: { date: 1 } }]), Visitor.aggregate([{ $match: match }, { $group: { _id: '$device', value: { $sum: 1 } } }, { $sort: { value: -1 } }]), Visitor.aggregate([{ $match: match }, { $group: { _id: '$referrer', value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 8 }]), Visitor.aggregate([{ $match: match }, { $group: { _id: '$path', value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 8 }])]); const overview = summary[0] || { visits: 0, sessions: 0 }; res.json({ days, visits: overview.visits || 0, sessions: overview.sessions || 0, daily, devices, sources, pages }); } catch { res.status(500).json({ error: 'Unable to load your analytics' }); } });
app.get('/api/me/security', requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const rows = await SecurityAudit.find({ username: { $in: [req.user.username, req.user.email] } }).sort({ createdAt: -1 }).limit(50).lean(); res.json(rows.map(x => ({ event: x.event, success: x.success, device: x.device, createdAt: x.createdAt }))); } catch { res.status(500).json({ error: 'Unable to load security history' }); } });

app.post('/api/auth/login', loginLimiter, async (req, res) => { const username = clean(req.body.username, 80); const password = String(req.body.password || ''); const valid = username === String(process.env.ADMIN_USERNAME || '') && verifyAdminPassword(password); recordAudit(req, 'sign_in', valid, username); if (valid) { const token = signAdminToken(username); setCookie(res, 'leeAdminSession', token, 60 * 60 * 12); return res.json({ token, message: 'Login successful', device: deviceFromAgent(req.headers['user-agent']) }); } res.status(401).json({ error: 'Invalid credentials' }); });
app.post('/api/auth/user/register', signupLimiter, emailLimiter, requireDatabase, async (req, res) => {
  const availability = await getSettings();
  if (availability.signupsRestricted) return res.status(403).json({ error: availability.signupRestrictionMessage || 'New account registration is temporarily paused. Please try again later.' });
  const session = await mongoose.startSession();
  try {
    const username = normalizeUsername(req.body.username);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!validUsername(username)) return res.status(400).json({ error: 'Choose a username with 3–30 lowercase letters, numbers, or hyphens. That username is reserved or invalid.' });
    if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' });
    const passwordData = hashPassword(password);
    const verificationToken = randomToken();
    const verificationCode = randomVerificationCode();
    let user;
    await session.withTransaction(async () => {
      if (await User.exists({ $or: [{ username }, { email }] }).session(session)) { const error = new Error('That username or email is already registered'); error.code = 11000; throw error; }
      user = await createWelcomeUser({ username, email, passwordHash: passwordData.hash, passwordSalt: passwordData.salt, emailVerificationTokenHash: hashToken(verificationToken), emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), emailVerificationCodeHash: hashToken(verificationCode), emailVerificationCodeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), displayName: username }, session);
    });
    await sendVerificationEmail(user, verificationToken, verificationCode);
    recordAudit(req, 'user_register', true, username);
    res.status(201).json({ message: 'Account created. You have received a free KES 10.00 welcome credit for posting and paid services. Check your email for a verification link or six-digit code.', user: publicUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'That username or email is already registered' });
    res.status(400).json({ error: 'Unable to create account' });
  } finally { await session.endSession(); }
});
app.post('/api/auth/user/resend-verification', loginLimiter, emailLimiter, requireDatabase, async (req, res) => { try { const identifier = normalizeEmail(req.body.email || ''); const username = normalizeUsername(req.body.username || ''); const user = await User.findOne(identifier ? { email: identifier } : { username }); if (!user || user.emailVerified) return res.json({ message: 'If the account exists and still needs verification, a new email has been sent.' }); const verificationToken = randomToken(); const verificationCode = randomVerificationCode(); user.emailVerificationTokenHash = hashToken(verificationToken); user.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); user.emailVerificationCodeHash = hashToken(verificationCode); user.emailVerificationCodeExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); user.updatedAt = new Date(); await user.save(); await sendVerificationEmail(user, verificationToken, verificationCode); res.json({ message: 'If the account exists and still needs verification, a new email has been sent.' }); } catch { res.json({ message: 'If the account exists and still needs verification, a new email has been sent.' }); } });
app.get('/api/auth/user/verify-email', emailLimiter, requireDatabase, async (req, res) => { try { const token = clean(req.query.token, 200); const code = clean(req.query.code, 6); const username = normalizeUsername(req.query.username); if (!username || (!token && !/^\d{6}$/.test(code))) return res.status(400).json({ error: 'A valid verification link or six-digit code is required' }); const selector = token ? { emailVerificationTokenHash: hashToken(token), emailVerificationExpiresAt: { $gt: new Date() } } : { emailVerificationCodeHash: hashToken(code), emailVerificationCodeExpiresAt: { $gt: new Date() } }; const user = await User.findOne({ username, ...selector }); if (!user) return res.status(400).json({ error: 'Verification link or code is invalid or expired' }); user.emailVerified = true; user.emailVerificationTokenHash = ''; user.emailVerificationExpiresAt = null; user.emailVerificationCodeHash = ''; user.emailVerificationCodeExpiresAt = null; user.updatedAt = new Date(); await user.save(); await sendAccountVerifiedEmail(user); recordAudit(req, 'user_email_verified', true, username); res.json({ message: 'Email verified successfully', user: publicUser(user) }); } catch { res.status(400).json({ error: 'Unable to verify account' }); } });
app.post('/api/auth/user/login', loginLimiter, requireDatabase, async (req, res) => { try { const email = normalizeEmail(req.body.email); const password = String(req.body.password || ''); const user = await User.findOne({ email }); const valid = !!user && verifyPassword(password, user.passwordSalt, user.passwordHash); recordAudit(req, 'user_sign_in', valid, email); if (!valid) return res.status(401).json({ error: 'Invalid email or password' }); if (user.suspended) return res.status(403).json({ error: 'This creator account is suspended. Contact Lee Tech support.' }); if (!user.emailVerified) return res.status(403).json({ error: 'Please verify your email before signing in' }); user.lastSignedIn = new Date(); user.updatedAt = new Date(); await user.save(); const token = signUserToken(user); setCookie(res, 'leeSession', token, 60 * 60 * 24 * 7); res.json({ user: publicUser(user), message: 'Signed in successfully' }); } catch { res.status(400).json({ error: 'Unable to sign in' }); } });
app.post('/api/auth/user/logout', (req, res) => { clearCookie(res, 'leeSession'); res.json({ success: true }); });
app.post('/api/auth/user/forgot-password', loginLimiter, emailLimiter, requireDatabase, async (req, res) => { const email = normalizeEmail(req.body.email); const user = await User.findOne({ email }); if (user) { const token = randomToken(); user.passwordResetTokenHash = hashToken(token); user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000); await user.save(); await sendResetEmail(user, token); } res.json({ message: 'If an account exists for that email, a reset link has been sent.' }); });
app.post('/api/auth/user/reset-password', emailLimiter, requireDatabase, async (req, res) => { try { const username = normalizeUsername(req.body.username); const token = clean(req.body.token, 200); const password = String(req.body.password || ''); if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' }); const user = await User.findOne({ username, passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: { $gt: new Date() } }); if (!user) return res.status(400).json({ error: 'Reset link is invalid or expired' }); const passwordData = hashPassword(password); user.passwordHash = passwordData.hash; user.passwordSalt = passwordData.salt; user.passwordResetTokenHash = ''; user.passwordResetExpiresAt = null; user.updatedAt = new Date(); await user.save(); await sendAccountUpdateEmail(user, 'Password reset completed'); res.json({ message: 'Password reset successfully' }); } catch { res.status(400).json({ error: 'Unable to reset password' }); } });

app.use('/api/me', requireDatabase);
app.get('/api/me/posting-cost', userAuth, verifiedUser, async (req, res) => { try { const settings = await getSettings(); res.json({ priceMinor: Number(settings.postPriceMinor || 0), currency: PAYSTACK_CURRENCY }); } catch { res.status(500).json({ error: 'Unable to load posting price' }); } });
app.get('/api/me', userAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.put('/api/me/profile', userAuth, verifiedUser, emailLimiter, async (req, res) => { try { const displayName = clean(req.body.displayName || req.user.username, 120); const bio = clean(req.body.bio || '', 600); const contact = normalizeContactLinks(req.body.contact || {}); const changed = displayName !== req.user.displayName || bio !== req.user.bio || JSON.stringify(contactLinksForView(req.user.contact)) !== JSON.stringify(contact); req.user.displayName = displayName; req.user.bio = bio; req.user.contact = contact; req.user.updatedAt = new Date(); await req.user.save(); if (changed) await sendAccountUpdateEmail(req.user, 'Profile and contact details updated'); res.json({ user: publicUser(req.user) }); } catch (error) { res.status(400).json({ error: error.message || 'Unable to update profile' }); } });
app.post('/api/auth/user/change-password', emailLimiter, requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const currentPassword = String(req.body.currentPassword || ''); const newPassword = String(req.body.newPassword || ''); if (!verifyPassword(currentPassword, req.user.passwordSalt, req.user.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect' }); if (newPassword.length < 12) return res.status(400).json({ error: 'New password must be at least 12 characters' }); const passwordData = hashPassword(newPassword); req.user.passwordHash = passwordData.hash; req.user.passwordSalt = passwordData.salt; req.user.updatedAt = new Date(); await req.user.save(); await sendAccountUpdateEmail(req.user, 'Password changed'); recordAudit(req, 'user_password_changed', true, req.user.username); res.json({ message: 'Password changed successfully' }); } catch { res.status(400).json({ error: 'Unable to change password' }); } });
app.get('/api/me/posts', requireDatabase, userAuth, async (req, res) => { res.json(await Post.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).lean()); });
app.post('/api/me/posts', requireDatabase, userAuth, verifiedUser, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const normalized = normalizePostFields(req.body);
    if (!normalized.title || !normalized.content) return res.status(400).json({ error: 'Title and content are required' });
    const expectedPriceMinor = req.body.expectedPriceMinor == null || String(req.body.expectedPriceMinor).trim() === '' ? null : Number(req.body.expectedPriceMinor);
    if (expectedPriceMinor !== null && (!Number.isInteger(expectedPriceMinor) || expectedPriceMinor < 0)) return res.status(400).json({ error: 'Invalid expected posting price' });
    let post;
    let charge = 0;
    let balanceAfterMinor = null;
    await session.withTransaction(async () => {
      const chargeResult = normalized.published ? await chargeForPost(req.user._id, normalized.title, session, expectedPriceMinor, normalized.contentType) : { priceMinor: 0, balanceAfterMinor: null };
      charge = chargeResult.priceMinor;
      balanceAfterMinor = chargeResult.balanceAfterMinor;
      const created = await Post.create([{ ...normalized, moderationStatus: 'approved', author: req.user.displayName || req.user.username, ownerId: req.user._id, ownerUsername: req.user.username, updatedAt: new Date() }], { session });
      post = created[0];
    });
    if (balanceAfterMinor === null) { const latest = await User.findById(req.user._id).select('walletBalanceMinor').lean(); balanceAfterMinor = latest?.walletBalanceMinor ?? req.user.walletBalanceMinor; }
    res.status(201).json({ post, chargedMinor: charge, balanceAfterMinor });
  } catch (error) {
    if (error.code === 'POST_PRICE_CHANGED') return res.status(409).json({ error: 'The publishing price changed. Review the updated cost before confirming.', priceMinor: error.currentPriceMinor });
    if (error.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: 'Insufficient wallet balance. Top up before publishing.' });
    res.status(400).json({ error: error.message || 'Unable to save post' });
  } finally { await session.endSession(); }
});
app.put('/api/me/posts/:id', requireDatabase, userAuth, verifiedUser, async (req, res) => { const session = await mongoose.startSession(); try { let post; let charge = 0; let balanceAfterMinor = null; await session.withTransaction(async () => { const current = await Post.findOne({ _id: req.params.id, ownerId: req.user._id }).session(session); if (!current) { const error = new Error('NOT_FOUND'); error.code = 'NOT_FOUND'; throw error; } const normalized = normalizePostFields(req.body, current); if (!normalized.title || !normalized.content) { const error = new Error('INVALID'); error.code = 'INVALID'; throw error; } if (normalized.published && !current.published) { const expectedPriceMinor = req.body.expectedPriceMinor == null || String(req.body.expectedPriceMinor).trim() === '' ? null : Number(req.body.expectedPriceMinor); if (expectedPriceMinor !== null && (!Number.isInteger(expectedPriceMinor) || expectedPriceMinor < 0)) { const error = new Error('Invalid expected posting price'); error.code = 'INVALID'; throw error; } const chargeResult = await chargeForPost(req.user._id, normalized.title, session, expectedPriceMinor, normalized.contentType); charge = chargeResult.priceMinor; balanceAfterMinor = chargeResult.balanceAfterMinor; } Object.assign(current, normalized, { moderationStatus: 'approved', author: req.user.displayName || req.user.username, updatedAt: new Date() }); await current.save({ session }); post = current; }); if (balanceAfterMinor === null) { const latest = await User.findById(req.user._id).select('walletBalanceMinor').lean(); balanceAfterMinor = latest?.walletBalanceMinor ?? req.user.walletBalanceMinor; } res.json({ post, chargedMinor: charge, balanceAfterMinor }); } catch (error) { if (error.code === 'NOT_FOUND') return res.status(404).json({ error: 'Post not found' }); if (error.code === 'POST_PRICE_CHANGED') return res.status(409).json({ error: 'The publishing price changed. Review the updated cost before confirming.', priceMinor: error.currentPriceMinor }); if (error.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: 'Insufficient wallet balance. Top up before publishing.' }); res.status(400).json({ error: error.message || 'Unable to update post' }); } finally { await session.endSession(); } });
app.delete('/api/me/posts/:id', requireDatabase, userAuth, verifiedUser, async (req, res) => { const result = await Post.deleteOne({ _id: req.params.id, ownerId: req.user._id }); if (!result.deletedCount) return res.status(404).json({ error: 'Post not found' }); res.json({ message: 'Post deleted' }); });

app.get('/api/services', requireDatabase, userAuth, verifiedUser, async (req, res) => res.json(await Service.find({ active: true }).sort({ name: 1 }).lean()));
app.post('/api/services/:id/purchase', requireDatabase, userAuth, verifiedUser, async (req, res) => { const session = await mongoose.startSession(); try { let purchase; await session.withTransaction(async () => { const service = await Service.findOne({ _id: req.params.id, active: true }).session(session); const user = await User.findById(req.user._id).session(session); if (!service || !user) { const error = new Error('NOT_FOUND'); error.code = 'NOT_FOUND'; throw error; } if (user.walletBalanceMinor < service.priceMinor) { const error = new Error('INSUFFICIENT_BALANCE'); error.code = 'INSUFFICIENT_BALANCE'; throw error; } user.walletBalanceMinor -= service.priceMinor; user.updatedAt = new Date(); await user.save({ session }); await WalletTransaction.create([{ userId: user._id, type: 'service_charge', reference: `service:${new mongoose.Types.ObjectId()}`, amountMinor: -service.priceMinor, balanceAfterMinor: user.walletBalanceMinor, description: `Service: ${service.name}`, metadata: { serviceId: service._id } }], { session }); const rows = await Purchase.create([{ userId: user._id, serviceId: service._id, serviceName: service.name, amountMinor: service.priceMinor }], { session }); purchase = rows[0]; }); res.status(201).json({ purchase }); } catch (error) { if (error.code === 'NOT_FOUND') return res.status(404).json({ error: 'Service not found' }); if (error.code === 'INSUFFICIENT_BALANCE') return res.status(402).json({ error: 'Insufficient wallet balance' }); res.status(400).json({ error: 'Unable to purchase service' }); } finally { await session.endSession(); } });
app.get('/api/wallet', requireDatabase, userAuth, verifiedUser, async (req, res) => { const transactions = await WalletTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean(); const payments = await PaymentTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(); const purchases = await Purchase.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(); res.json({ balanceMinor: req.user.walletBalanceMinor, transactions, payments, purchases, currency: PAYSTACK_CURRENCY }); });
app.post('/api/wallet/paystack/initialize', requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const settings = await getSettings(); if (settings.paymentsMaintenance) return res.status(503).json({ error: settings.paymentsMaintenanceMessage || 'Payments are temporarily unavailable. Please try again later.' }); const amountMinor = amountToMinor(req.body.amount); if (!amountMinor) return res.status(400).json({ error: 'Enter a valid top-up amount' }); if (amountMinor < PAYSTACK_MINIMUM_MINOR) return res.status(400).json({ error: `The minimum ${PAYSTACK_CURRENCY} top-up is ${minorToMajor(PAYSTACK_MINIMUM_MINOR).toFixed(2)}` }); const initialized = await initializePaystackTransaction(req.user, amountMinor); await PaymentTransaction.create({ userId: req.user._id, reference: initialized.reference, amountMinor, currency: PAYSTACK_CURRENCY, authorizationUrl: initialized.authorizationUrl }); res.status(201).json(initialized);   } catch (error) { res.status(['PAYSTACK_NOT_CONFIGURED', 'PAYSTACK_UNAVAILABLE'].includes(error.code) ? 503 : 400).json({ error: error.message || 'Unable to initialize payment' }); } });
app.post('/api/wallet/paystack/verify/:reference', emailLimiter, requireDatabase, userAuth, verifiedUser, async (req, res) => { try { const reference = clean(req.params.reference, 120); if (!/^[A-Za-z0-9.=-]+$/.test(reference)) return res.status(400).json({ error: 'Invalid payment reference' }); const payment = await PaymentTransaction.findOne({ reference, userId: req.user._id }); if (!payment) return res.status(404).json({ error: 'Payment not found' }); const wasCredited = payment.status === 'credited'; const transaction = await verifyPaystackTransaction(payment.reference); if (transaction.status !== 'success') { if (['failed', 'abandoned'].includes(String(transaction.status))) { payment.status = 'failed'; payment.gatewayData = transaction; payment.updatedAt = new Date(); await payment.save(); } return res.status(400).json({ error: `Payment is ${transaction.status || 'not complete'}` }); } const user = await creditPayment(payment.reference, transaction); if (!wasCredited) await safeEmail({ to: user.email, subject: 'Lee Tech wallet top-up confirmed', text: `Your wallet was credited with ${minorToMajor(payment.amountMinor)} ${payment.currency}.`, html: `<p>Your Lee Tech wallet was credited with <strong>${minorToMajor(payment.amountMinor).toFixed(2)} ${escapeHtml(payment.currency)}</strong>.</p>` }); res.json({ message: 'Wallet credited', balanceMinor: user.walletBalanceMinor, transaction }); } catch (error) { res.status(error.code === 'PAYSTACK_NOT_CONFIGURED' ? 503 : 400).json({ error: error.message || 'Unable to verify payment' }); } });
app.post('/api/paystack/webhook', async (req, res) => { const signature = String(req.headers['x-paystack-signature'] || ''); const secret = String(process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_WEBHOOK_SECRET || '').trim(); const expected = secret && req.rawBody ? crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex') : ''; if (!secret || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(401).json({ error: 'Invalid webhook signature' }); try { const event = req.body || {}; const reference = clean(event.data?.reference, 120); if (event.event === 'charge.success' && /^[A-Za-z0-9.=-]+$/.test(reference)) { const payment = await PaymentTransaction.findOne({ reference }); if (payment && Number(event.data.amount) === payment.amountMinor && String(event.data.currency || '').toUpperCase() === String(payment.currency).toUpperCase()) await creditPayment(payment.reference, event.data); } res.status(200).json({ received: true }); } catch (error) { console.error('Paystack webhook processing error:', error.message); res.status(500).json({ error: 'Webhook processing failed' }); } });

app.use('/api/admin', requireDatabase, adminLimiter, adminAuth);
app.get('/api/admin/stats', async (req, res) => { try { const recent = await SecurityAudit.find().sort({ createdAt: -1 }).limit(8).lean(); const settings = await getSettings(); const [products, posts, featured, visitors, notes, users, verifiedUsers, wallet] = await Promise.all([Product.countDocuments(), Post.countDocuments({ ownerId: null }), Product.countDocuments({ featured: true }), Visitor.countDocuments(), AdminNote.countDocuments(), User.countDocuments(), User.countDocuments({ emailVerified: true }), User.aggregate([{ $group: { _id: null, total: { $sum: '$walletBalanceMinor' } } }])]); res.json({ products, posts, featured, visitors, notes, users, verifiedUsers, walletBalanceMinor: wallet[0]?.total || 0, postPriceMinor: settings.postPriceMinor || 0, currentDevice: deviceFromAgent(req.headers['user-agent']), recentActivity: recent.map(x => ({ event: x.event, username: x.username, device: x.device, success: x.success, createdAt: x.createdAt })) }); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/admin/users', async (req, res) => { const search = clean(req.query.search || '', 100); const query = search ? { $or: [{ username: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] } : {}; const users = await User.find(query).sort({ createdAt: -1 }).limit(200).lean(); res.json(users.map(user => ({ ...publicUser(user), passwordHash: undefined, passwordSalt: undefined }))); });
app.put('/api/admin/users/:id/suspension', async (req, res) => { if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid user id' }); const suspended = req.body.suspended === true; try { const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'user' }, { suspended, suspendedAt: suspended ? new Date() : null, suspendedBy: suspended ? req.admin.username : '', suspensionReason: suspended ? clean(req.body.reason || 'Suspended by administrator', 500) : '' }, { new: true, runValidators: true }).lean(); if (!user) return res.status(404).json({ error: 'Creator account not found' }); recordAudit(req, suspended ? 'creator_suspended' : 'creator_reinstated', true, user.username); res.json({ user: publicUser(user), message: suspended ? 'Creator suspended successfully' : 'Creator reinstated successfully' }); } catch { res.status(400).json({ error: 'Unable to update creator suspension' }); } });
app.delete('/api/admin/users/:id', async (req, res) => { if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid user id' }); const session = await mongoose.startSession(); try { let deletedUsername = ''; await session.withTransaction(async () => { const user = await User.findOne({ _id: req.params.id, role: 'user' }).session(session); if (!user) { const error = new Error('NOT_FOUND'); error.code = 'NOT_FOUND'; throw error; } deletedUsername = user.username; await Promise.all([Post.deleteMany({ ownerId: user._id }).session(session), Visitor.deleteMany({ ownerId: user._id }).session(session), WalletTransaction.deleteMany({ userId: user._id }).session(session), PaymentTransaction.deleteMany({ userId: user._id }).session(session), Purchase.deleteMany({ userId: user._id }).session(session), User.deleteOne({ _id: user._id }).session(session)]); }); recordAudit(req, 'creator_deleted', true, deletedUsername); res.json({ message: 'Creator and associated private data deleted' }); } catch (error) { if (error.code === 'NOT_FOUND') return res.status(404).json({ error: 'Creator account not found' }); res.status(400).json({ error: 'Unable to delete creator account' }); } finally { await session.endSession(); } });
app.get('/api/admin/finance', async (req, res) => { const [topups, charges, purchases, users, recentPayments, recentTransactions] = await Promise.all([PaymentTransaction.aggregate([{ $match: { status: 'credited' } }, { $group: { _id: '$currency', totalMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } }]), WalletTransaction.aggregate([{ $match: { amountMinor: { $lt: 0 } } }, { $group: { _id: '$type', totalMinor: { $sum: { $abs: '$amountMinor' } }, count: { $sum: 1 } } }]), Purchase.countDocuments(), User.countDocuments(), PaymentTransaction.find().sort({ createdAt: -1 }).limit(50).populate('userId', 'username email').lean(), WalletTransaction.find().sort({ createdAt: -1 }).limit(50).populate('userId', 'username email').lean()]); res.json({ users, topups, charges, purchases, recentPayments, recentTransactions }); });
app.get('/api/admin/settings', async (req, res) => res.json(await getSettings()));
app.put('/api/admin/settings', async (req, res) => { const body = req.body || {}; const current = await getSettings(); const postPriceMinor = body.postPrice == null || body.postPrice === '' ? Number(current.postPriceMinor || 0) : amountToMinor(body.postPrice, true); if (postPriceMinor === null) return res.status(400).json({ error: 'Enter a valid post price' }); const update = { key: 'main', postPriceMinor, siteMaintenance: body.siteMaintenance == null ? current.siteMaintenance === true : body.siteMaintenance === true, siteMaintenanceMessage: clean(body.siteMaintenanceMessage == null ? current.siteMaintenanceMessage || 'Lee Tech is temporarily unavailable while we make improvements.' : body.siteMaintenanceMessage, 240), paymentsMaintenance: body.paymentsMaintenance == null ? current.paymentsMaintenance === true : body.paymentsMaintenance === true, paymentsMaintenanceMessage: clean(body.paymentsMaintenanceMessage == null ? current.paymentsMaintenanceMessage || 'Payments are temporarily unavailable. Please try again later.' : body.paymentsMaintenanceMessage, 240), signupsRestricted: body.signupsRestricted == null ? current.signupsRestricted === true : body.signupsRestricted === true, signupRestrictionMessage: clean(body.signupRestrictionMessage == null ? current.signupRestrictionMessage || 'New account registration is temporarily paused. Please try again later.' : body.signupRestrictionMessage, 240), updatedBy: req.admin.username, updatedAt: new Date() }; const settings = await AppSettings.findOneAndUpdate({ key: 'main' }, update, { upsert: true, new: true, runValidators: true }); res.json(settings); });
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
    const body = req.body || {};
    const isProduct = model === Product;
    const isPostModel = model === Post;
    if (action === 'list') { const filter = isPostModel ? { ownerId: null } : {}; return res.json(await model.find(filter).sort({ createdAt: -1 })); }
    if (action === 'create') {
      const productType = isProduct ? normalizeProductType(body.productType) : 'digital';
      const category = isProduct ? clean(body.category || 'General', 80) : '';
      const priceOnRequest = isProduct && category.toLowerCase() === 'services' && (body.priceOnRequest === true || body.priceOnRequest === 'true');
      const cleanBody = isProduct ? { name: clean(body.name, 120), description: clean(body.description, 4000), price: priceOnRequest ? 0 : Number(body.price), priceOnRequest, productType, stock: normalizeStock(body.stock, productType), category, image: await optimizeProductImage(body.image || ''), featured: Boolean(body.featured) } : { title: clean(body.title, 180), content: clean(body.content, 50000), excerpt: clean(body.excerpt || '', 500), visitorLink: normalizeContactUrl(body.visitorLink || '', 'Visitor link'), author: clean(body.author || 'Lee Tech', 120), image: normalizeImage(body.image || ''), contentType: 'blog', productType: 'digital', priceMinor: 0, stock: null, published: body.published !== false, ownerId: null, ownerUsername: '' };
      if (isProduct && (!cleanBody.name || !cleanBody.description || !Number.isFinite(cleanBody.price) || cleanBody.price < 0)) return res.status(400).json({ error: 'Name, description, and a valid price are required' });
      if (!isProduct && (!cleanBody.title || !cleanBody.content)) return res.status(400).json({ error: 'Title and content are required' });
      const duplicate = await model.findOne(isProduct ? { name: cleanBody.name } : { title: cleanBody.title }).lean();
      if (duplicate) return res.status(409).json({ error: isProduct ? 'A product with this name already exists' : 'A Lee Tech post with this title already exists' });
      return res.status(201).json(await model.create(cleanBody));
    }
    if (action === 'update') {
      const productType = isProduct ? normalizeProductType(body.productType) : 'digital';
      const category = isProduct ? clean(body.category || 'General', 80) : '';
      const priceOnRequest = isProduct && category.toLowerCase() === 'services' && (body.priceOnRequest === true || body.priceOnRequest === 'true');
      const cleanBody = isProduct ? { name: clean(body.name, 120), description: clean(body.description, 4000), price: priceOnRequest ? 0 : Number(body.price), priceOnRequest, productType, stock: normalizeStock(body.stock, productType), category, image: await optimizeProductImage(body.image || ''), featured: Boolean(body.featured) } : { title: clean(body.title, 180), content: clean(body.content, 50000), excerpt: clean(body.excerpt || '', 500), visitorLink: normalizeContactUrl(body.visitorLink || '', 'Visitor link'), author: clean(body.author || 'Lee Tech', 120), image: normalizeImage(body.image || ''), contentType: 'blog', productType: 'digital', priceMinor: 0, stock: null, published: body.published !== false, ownerId: null, ownerUsername: '' };
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
app.get('/api/admin/moderation', async (req, res) => {
  try {
    const [posts, products] = await Promise.all([
      Post.find({ ownerId: null }).sort({ updatedAt: -1, createdAt: -1 }).limit(300).lean(),
      Product.find().sort({ createdAt: -1 }).limit(300).lean()
    ]);
    const rows = [
      ...posts.map(item => ({ ...item, itemType: 'post', managedBy: 'admin', displayTitle: item.title, owner: 'Lee Tech' })),
      ...products.map(item => ({ ...item, itemType: 'product', managedBy: 'admin', displayTitle: item.name, owner: 'Lee Tech' }))
    ].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    res.json(rows);
  } catch (error) { console.error('Moderation list error:', error.message); res.status(500).json({ error: 'Unable to load moderation queue' }); }
});
app.put('/api/admin/moderation/:type/:id', async (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  const action = String(req.body.action || '').toLowerCase();
  if (!['post', 'product'].includes(type) || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid moderation action' });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid content id' });
  try {
    const Model = type === 'post' ? Post : Product;
    const lookup = type === 'post' ? { _id: req.params.id, ownerId: null } : { _id: req.params.id };
    const item = await Model.findOneAndUpdate(lookup, { moderationStatus: action === 'approve' ? 'approved' : 'rejected', moderationNote: clean(req.body.note || '', 500), moderatedAt: new Date(), moderatedBy: req.admin.username, ...(type === 'post' || type === 'product' ? { published: action === 'approve' } : {}) }, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ error: 'Content not found' });
    recordAudit(req, `moderation_${action}`, true, req.admin.username);
    res.json({ message: action === 'approve' ? 'Content approved and published' : 'Content rejected and hidden', item });
  } catch (error) { console.error('Moderation action error:', error.message); res.status(400).json({ error: 'Unable to update moderation status' }); }
});

app.get('/api/version', (req, res) => res.set('Cache-Control', 'no-store, must-revalidate').json({ version: BUILD_VERSION }));
app.get('/app-upgrade.js', (req, res) => { res.type('application/javascript').set('Cache-Control', 'no-store, must-revalidate').send(upgradeScript); });
app.get('/sw.js', (req, res) => { res.type('application/javascript').set('Cache-Control', 'no-store, must-revalidate').send(serviceWorkerScript); });
app.get('/offline.html', (req, res) => { res.type('html').set('Cache-Control', 'no-store, must-revalidate').send(offlinePage.replaceAll('__CSP_NONCE__', res.locals.cspNonce)); });
app.get('/homepage-share-image.png', async (req, res) => { try { const image = await renderShareCard({ title: 'Make room for better possibilities.', subtitle: 'A curated technology studio and creator marketplace.', kicker: 'LEE TECH / TECHNOLOGY WITH INTENTION' }); res.type('png').set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800').send(image); } catch (error) { console.error('Homepage share image error:', error.message); res.status(500).end(); } });
app.get('/share-product-image.png', async (req, res) => { const productId = String(req.query.product || '').trim(); if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).end(); try { await connectToDatabase(); const product = await Post.findOne({ _id: productId, contentType: 'product', published: true, $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }] }).select('image ownerId').lean(); if (!product) return res.status(404).end(); if (product.ownerId) { const owner = await User.findOne({ _id: product.ownerId, emailVerified: true }).select('_id').lean(); if (!owner) return res.status(404).end(); } const stored = String(product.image || '').trim(); const dataMatch = stored.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i); if (dataMatch) { const buffer = Buffer.from(dataMatch[2].replace(/\s+/g, ''), 'base64'); return res.type(dataMatch[1].split('/')[1]).set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400').send(buffer); } try { const external = new URL(stored); if (['http:', 'https:'].includes(external.protocol) && (!isProduction || external.protocol === 'https:')) return res.redirect(302, external.toString()); } catch {} return res.redirect(302, `${APP_URL}/homepage-share-image.png`); } catch (error) { console.error('Product share image error:', error.message); return res.status(503).end(); } });
app.get('/share-card.png', async (req, res) => { try { const title = clean(req.query.title || 'Lee Tech', 90); const subtitle = clean(req.query.subtitle || 'Technology with intention.', 170); const kicker = clean(req.query.kicker || 'LEE TECH COMMUNITY', 42); const image = await renderShareCard({ title, subtitle, kicker }); res.type('png').set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400').send(image); } catch (error) { console.error('Share-card generation error:', error.message); res.status(500).end(); } });
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
app.use((err, req, res, next) => { if (err?.message === 'CORS origin is not allowed') return res.status(403).json({ error: 'CORS origin is not allowed' }); console.error(err); return res.status(500).json({ error: 'Server error' }); });
app.get('*', (req, res) => res.type('html').set('Cache-Control', 'no-store, must-revalidate').send(shareMetadata(req).replaceAll('__CSP_NONCE__', res.locals.cspNonce)));

if (!isProduction) app.listen(process.env.PORT || 3000, () => console.log(`Lee Tech running on http://localhost:${process.env.PORT || 3000}`));
module.exports = app;
