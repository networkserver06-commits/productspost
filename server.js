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

const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
const MIN_SECRET_LENGTH = 32;
const htmlTemplate = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
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
  const missing = ['JWT_SECRET', 'NOTE_ENCRYPTION_KEY', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'].filter(name => !String(process.env[name] || '').trim());
  if (isProduction && !String(process.env.MONGODB_URI || '').trim()) missing.push('MONGODB_URI');
  if (isProduction && !String(process.env.CORS_ORIGINS || '').trim()) missing.push('CORS_ORIGINS');
  const weak = ['JWT_SECRET', 'NOTE_ENCRYPTION_KEY'].filter(name => {
    const value = String(process.env[name] || '').trim();
    return value && (value.length < MIN_SECRET_LENGTH || /change[-_ ]this|secret|password|example|lee-tech/i.test(value));
  });
  if (process.env.JWT_SECRET && process.env.NOTE_ENCRYPTION_KEY && process.env.JWT_SECRET === process.env.NOTE_ENCRYPTION_KEY) weak.push('JWT_SECRET and NOTE_ENCRYPTION_KEY must be different');
  if (process.env.ADMIN_PASSWORD && String(process.env.ADMIN_PASSWORD).length < 12) weak.push('ADMIN_PASSWORD must be at least 12 characters');
  const problems = [...new Set([...missing.map(name => `${name} is missing`), ...weak.map(name => `${name} is weak or invalid`)])];
  if (problems.length) {
    const message = `Environment validation failed: ${problems.join('; ')}`;
    if (isProduction) throw new Error(message);
    console.warn(`[config] ${message}. Admin authentication and encrypted notes will remain unavailable until corrected.`);
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
app.use(cors({ origin(origin, callback) { if (!origin || corsOrigins.has(origin)) return callback(null, true); return callback(new Error('CORS origin is not allowed')); }, credentials: false }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(morgan('dev'));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, validate: { xForwardedForHeader: false } }));
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Admin request limit reached. Please try again later.' }, validate: { xForwardedForHeader: false } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please wait 15 minutes.' }, validate: { xForwardedForHeader: false } });

let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  cachedDb = await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, maxPoolSize: 10 });
  return cachedDb;
}
connectToDatabase().then(() => console.log('Connected to MongoDB')).catch(err => console.error('MongoDB connection error:', err.message));
mongoose.connection.on('error', err => console.error('MongoDB runtime error:', err));

const productSchema = new mongoose.Schema({ name: { type: String, required: true }, description: { type: String, required: true }, price: { type: Number, required: true, min: 0 }, category: { type: String, default: 'General' }, image: { type: String, default: '' }, featured: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }, expiresAt: { type: Date, default: null } });
productSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const postSchema = new mongoose.Schema({ title: { type: String, required: true }, content: { type: String, required: true }, excerpt: { type: String, default: '' }, image: { type: String, default: '' }, author: { type: String, default: 'Lee Tech' }, published: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now }, expiresAt: { type: Date, default: null } });
postSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const visitorSchema = new mongoose.Schema({ path: { type: String, default: '/' }, referrer: { type: String, default: 'direct' }, device: { type: String, default: 'desktop' }, country: { type: String, default: 'unknown' }, sessionHash: String, createdAt: { type: Date, default: Date.now } });
visitorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });
const noteSchema = new mongoose.Schema({ ciphertext: { type: String, required: true }, iv: { type: String, required: true }, tag: { type: String, required: true }, createdBy: { type: String, default: 'admin' }, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now } });
const auditSchema = new mongoose.Schema({ event: { type: String, required: true }, username: { type: String, default: '' }, device: { type: String, default: 'unknown' }, userAgent: { type: String, default: '' }, ipHash: { type: String, default: '' }, success: { type: Boolean, default: true }, createdAt: { type: Date, default: Date.now } });
auditSchema.index({ createdAt: -1 });
auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });
const Product = mongoose.model('Product', productSchema);
const Post = mongoose.model('Post', postSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);
const AdminNote = mongoose.model('AdminNote', noteSchema);
const SecurityAudit = mongoose.model('SecurityAudit', auditSchema);

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.admin = jwt.verify(token, requiredEnv('JWT_SECRET')); next(); } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
};
const noteKey = () => crypto.createHash('sha256').update(requiredEnv('NOTE_ENCRYPTION_KEY')).digest();
function encryptNote(text) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', noteKey(), iv); const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]); return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }; }
function decryptNote(note) { const decipher = crypto.createDecipheriv('aes-256-gcm', noteKey(), Buffer.from(note.iv, 'base64')); decipher.setAuthTag(Buffer.from(note.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(note.ciphertext, 'base64')), decipher.final()]).toString('utf8'); }
function deviceFromAgent(agent = '') { if (/mobile|android|iphone/i.test(agent)) return 'mobile'; if (/tablet|ipad/i.test(agent)) return 'tablet'; return 'desktop'; }
function sessionHash(req) { return crypto.createHash('sha256').update(`${req.ip}|${req.headers['user-agent'] || ''}`).digest('hex').slice(0, 24); }
function ipHash(req) { return crypto.createHash('sha256').update(`${req.ip}|${requiredEnv('JWT_SECRET')}`).digest('hex').slice(0, 16); }
function recordAudit(req, event, success, username = '') { return SecurityAudit.create({ event, success, username: String(username || '').slice(0, 80), device: deviceFromAgent(req.headers['user-agent']), userAgent: String(req.headers['user-agent'] || '').slice(0, 240), ipHash: ipHash(req) }).catch(() => {}); }

app.get('/api/config', (req, res) => res.json({ whatsappNumber: process.env.WHATSAPP_NUMBER || '', whatsappGroupLink: process.env.WHATSAPP_GROUP_LINK || '', brand: 'Lee Tech' }));
app.get('/api/products', async (req, res) => { try { const products = await Product.find().sort({ featured: -1, createdAt: -1 }).limit(24).lean(); res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); res.json(products); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/posts', async (req, res) => { try { const posts = await Post.find({ published: true }).sort({ createdAt: -1 }).limit(12).lean(); res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); res.json(posts); } catch { res.status(500).json({ error: 'Server error' }); } });
app.post('/api/analytics/visit', async (req, res) => { try { await connectToDatabase(); await Visitor.create({ path: String(req.body.path || '/').slice(0, 200), referrer: String(req.body.referrer || 'direct').slice(0, 200), device: deviceFromAgent(req.headers['user-agent']), sessionHash: sessionHash(req) }); res.status(204).end(); } catch { res.status(204).end(); } });

app.post('/api/auth/login', loginLimiter, async (req, res) => { const { username, password } = req.body; const valid = username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD; recordAudit(req, 'sign_in', valid, username); if (valid) return res.json({ token: jwt.sign({ username }, requiredEnv('JWT_SECRET'), { expiresIn: '12h' }), message: 'Login successful', device: deviceFromAgent(req.headers['user-agent']) }); res.status(401).json({ error: 'Invalid credentials' }); });
app.use('/api/admin', adminLimiter);
app.get('/api/admin/stats', authMiddleware, async (req, res) => { try { const recent = await SecurityAudit.find().sort({ createdAt: -1 }).limit(8).lean(); res.json({ products: await Product.countDocuments(), posts: await Post.countDocuments(), featured: await Product.countDocuments({ featured: true }), visitors: await Visitor.countDocuments(), notes: await AdminNote.countDocuments(), currentDevice: deviceFromAgent(req.headers['user-agent']), recentActivity: recent.map(x => ({ event: x.event, username: x.username, device: x.device, success: x.success, createdAt: x.createdAt })) }); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/admin/security', authMiddleware, async (req, res) => { try { const rows = await SecurityAudit.find().sort({ createdAt: -1 }).limit(40).lean(); res.json(rows.map(x => ({ event: x.event, username: x.username, device: x.device, success: x.success, createdAt: x.createdAt }))); } catch { res.status(500).json({ error: 'Unable to read security activity' }); } });
app.get('/api/admin/analytics', authMiddleware, async (req, res) => { try { const since = new Date(Date.now() - 30 * 86400000); const rows = await Visitor.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, visits: { $sum: 1 }, sessions: { $addToSet: '$sessionHash' } } }, { $project: { _id: 0, date: '$_id', visits: 1, sessions: { $size: '$sessions' } } }, { $sort: { date: 1 } }]); const devices = await Visitor.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$device', value: { $sum: 1 } } }, { $sort: { value: -1 } }]); const pages = await Visitor.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$path', value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 5 }]); res.json({ daily: rows, devices, pages }); } catch { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/admin/notes', authMiddleware, async (req, res) => { try { const notes = await AdminNote.find().sort({ updatedAt: -1 }); res.json(notes.map(n => ({ _id: n._id, text: decryptNote(n), createdBy: n.createdBy, createdAt: n.createdAt, updatedAt: n.updatedAt }))); } catch { res.status(500).json({ error: 'Unable to read secure notes' }); } });
app.post('/api/admin/notes', authMiddleware, async (req, res) => { try { const text = String(req.body.text || '').trim(); if (!text) return res.status(400).json({ error: 'Note text is required' }); const note = await AdminNote.create({ ...encryptNote(text), createdBy: req.admin.username }); res.status(201).json({ _id: note._id, text, createdBy: note.createdBy, createdAt: note.createdAt, updatedAt: note.updatedAt }); } catch (err) { res.status(400).json({ error: err.message }); } });
app.put('/api/admin/notes/:id', authMiddleware, async (req, res) => { try { const note = await AdminNote.findByIdAndUpdate(req.params.id, { ...encryptNote(String(req.body.text || '')), updatedAt: new Date() }, { new: true }); if (!note) return res.status(404).json({ error: 'Note not found' }); res.json({ _id: note._id, text: decryptNote(note), createdBy: note.createdBy, createdAt: note.createdAt, updatedAt: note.updatedAt }); } catch { res.status(400).json({ error: 'Unable to update note' }); } });
app.delete('/api/admin/notes/:id', authMiddleware, async (req, res) => { try { await AdminNote.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); } catch { res.status(400).json({ error: 'Unable to delete note' }); } });

async function crud(model, req, res, action) { try { if (action === 'list') return res.json(await model.find().sort({ createdAt: -1 })); if (action === 'create') { const body = req.body || {}; const isProduct = model === Product; const clean = isProduct ? { name: String(body.name || '').trim(), description: String(body.description || '').trim(), price: Number(body.price), category: String(body.category || 'General').trim(), image: String(body.image || '').trim(), featured: Boolean(body.featured) } : { title: String(body.title || '').trim(), content: String(body.content || '').trim(), excerpt: String(body.excerpt || '').trim(), author: String(body.author || 'Lee Tech').trim(), image: String(body.image || '').trim(), published: body.published !== false }; if (isProduct && (!clean.name || !clean.description || !Number.isFinite(clean.price))) return res.status(400).json({ error: 'Name, description, and a valid price are required' }); if (!isProduct && (!clean.title || !clean.content)) return res.status(400).json({ error: 'Title and content are required' }); const duplicateQuery = isProduct ? { name: clean.name } : { title: clean.title }; const duplicate = await model.findOne(duplicateQuery).lean(); if (duplicate) return res.status(409).json({ error: isProduct ? 'A product with this name already exists' : 'A journal post with this title already exists', existingId: duplicate._id }); const doc = await model.create(clean); return res.status(201).json(doc); } if (action === 'update') { const body = req.body || {}; const clean = model === Product ? { name: String(body.name || '').trim(), description: String(body.description || '').trim(), price: Number(body.price), category: String(body.category || 'General').trim(), image: String(body.image || '').trim(), featured: Boolean(body.featured) } : { title: String(body.title || '').trim(), content: String(body.content || '').trim(), excerpt: String(body.excerpt || '').trim(), author: String(body.author || 'Lee Tech').trim(), image: String(body.image || '').trim(), published: body.published !== false }; const duplicateQuery = model === Product ? { name: clean.name, _id: { $ne: req.params.id } } : { title: clean.title, _id: { $ne: req.params.id } }; if (await model.findOne(duplicateQuery).lean()) return res.status(409).json({ error: 'Another item with the same name or title already exists' }); const doc = await model.findByIdAndUpdate(req.params.id, clean, { new: true, runValidators: true }); if (!doc) return res.status(404).json({ error: 'Not found' }); return res.json(doc); } if (action === 'delete') { await model.findByIdAndDelete(req.params.id); return res.json({ message: 'Deleted' }); } } catch (err) { res.status(400).json({ error: err.message }); } }
app.get('/api/admin/products', authMiddleware, (req, res) => crud(Product, req, res, 'list'));
app.post('/api/admin/products', authMiddleware, (req, res) => crud(Product, req, res, 'create'));
app.put('/api/admin/products/:id', authMiddleware, (req, res) => crud(Product, req, res, 'update'));
app.delete('/api/admin/products/:id', authMiddleware, (req, res) => crud(Product, req, res, 'delete'));
app.get('/api/admin/posts', authMiddleware, (req, res) => crud(Post, req, res, 'list'));
app.post('/api/admin/posts', authMiddleware, (req, res) => crud(Post, req, res, 'create'));
app.put('/api/admin/posts/:id', authMiddleware, (req, res) => crud(Post, req, res, 'update'));
app.delete('/api/admin/posts/:id', authMiddleware, (req, res) => crud(Post, req, res, 'delete'));
app.use((err, req, res, next) => { if (err?.message === 'CORS origin is not allowed') return res.status(403).json({ error: 'CORS origin is not allowed' }); next(err); });
app.get('*', (req, res) => res.type('html').send(htmlTemplate.replaceAll('__CSP_NONCE__', res.locals.cspNonce)));
if (process.env.NODE_ENV !== 'production') app.listen(process.env.PORT || 3000, () => console.log(`Lee Tech running on http://localhost:${process.env.PORT || 3000}`));
module.exports = app;
