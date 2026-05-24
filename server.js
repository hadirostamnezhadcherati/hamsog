const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'leads.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.createHash('sha256').update(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}:hamsog-online-v7`).digest('hex');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ leads: [] }, null, 2), 'utf8');
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
  cardNumber: '',
  amount: '',
  template: 'سلام {{name}} عزیز، برای تکمیل رزرو جلسه همسوگ لطفاً مبلغ {{amount}} را به شماره کارت {{cardNumber}} واریز کنید و رسید را ارسال بفرمایید. با احترام، همسوگ'
}, null, 2), 'utf8');

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};
const writeQueue = { current: Promise.resolve() };
const rateMap = new Map();

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function readDb() { const parsed = readJson(DB_FILE, { leads: [] }); return { leads: Array.isArray(parsed.leads) ? parsed.leads : [] }; }
function readSettings() {
  const defaults = { cardNumber: '', amount: '', template: 'سلام {{name}} عزیز، برای تکمیل رزرو جلسه همسوگ لطفاً مبلغ {{amount}} را به شماره کارت {{cardNumber}} واریز کنید و رسید را ارسال بفرمایید. با احترام، همسوگ' };
  return { ...defaults, ...readJson(SETTINGS_FILE, defaults) };
}
function atomicWrite(file, data) { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8'); fs.renameSync(tmp, file); }
function queueWrite(fn) { writeQueue.current = writeQueue.current.then(fn, fn); return writeQueue.current; }
function sanitizeText(value, max = 1000) { return String(value || '').trim().replace(/[<>]/g, '').slice(0, max); }
function normalizePhone(value) {
  return String(value || '')
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[^0-9+]/g, '')
    .slice(0, 25);
}
function clientIp(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(); }
function rateLimit(req, limit = 30, windowMs = 10 * 60 * 1000) {
  const key = `${clientIp(req)}:${req.url.split('?')[0]}`; const now = Date.now();
  const item = rateMap.get(key) || { count: 0, reset: now + windowMs };
  if (now > item.reset) { item.count = 0; item.reset = now + windowMs; }
  item.count++; rateMap.set(key, item);
  return item.count <= limit;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of rateMap) if (now > v.reset) rateMap.delete(k); }, 15 * 60 * 1000).unref();
function securityHeaders(type='application/json; charset=utf-8') {
  return {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}
function send(res, status, data, type = 'application/json; charset=utf-8') { res.writeHead(status, securityHeaders(type)); res.end(type.includes('json') ? JSON.stringify(data) : data); }
function isAdmin(req) { const header = req.headers.authorization || ''; return header.startsWith('Bearer ') && header.slice(7) === ADMIN_TOKEN; }
function parseBody(req) { return new Promise((resolve, reject) => { let body=''; req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) { req.destroy(); reject(new Error('درخواست بیش از حد بزرگ است.')); } }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('فرمت داده نامعتبر است.')); } }); req.on('error', reject); }); }
function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const ext = path.extname(filePath);
    const cache = ext === '.html' ? 'no-store' : (['.png','.jpg','.jpeg'].includes(ext) ? 'public, max-age=86400' : 'no-cache');
    res.writeHead(200, { ...securityHeaders(mime[ext] || 'application/octet-stream'), 'Cache-Control': cache });
    res.end(content);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/health') return send(res, 200, { ok: true, app: 'همسوگ', version: '7-online' });

  if (req.method === 'POST' && pathname === '/api/leads') {
    if (!rateLimit(req, 8, 15 * 60 * 1000)) return send(res, 429, { ok:false, message:'تعداد ثبت درخواست زیاد است. چند دقیقه بعد دوباره تلاش کنید.' });
    const body = await parseBody(req);
    const fullName = sanitizeText(body.fullName, 120);
    const phone = normalizePhone(body.phone);
    const city = sanitizeText(body.city, 80);
    const griefType = sanitizeText(body.griefType, 80);
    const preferredTime = sanitizeText(body.preferredTime, 40);
    const urgency = sanitizeText(body.urgency, 40);
    const description = sanitizeText(body.description, 1500);
    const consent = Boolean(body.consent);
    if (!fullName || !phone || !griefType || !description || !consent) return send(res, 400, { ok: false, message: 'لطفاً فیلدهای ضروری را کامل کنید و رضایت تماس را بپذیرید.' });
    if (phone.length < 8) return send(res, 400, { ok: false, message: 'شماره موبایل معتبر وارد کنید.' });
    const now = new Date().toISOString();
    const lead = { id: crypto.randomUUID(), fullName, phone, city, griefType, preferredTime, urgency, description, status: 'جدید', adminNote: '', createdAt: now, updatedAt: now, ipHash: crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0,12) };
    await queueWrite(() => { const db = readDb(); db.leads.unshift(lead); atomicWrite(DB_FILE, db); });
    return send(res, 200, { ok: true, message: 'درخواست شما با موفقیت ثبت شد. به‌زودی برای هماهنگی تماس گرفته می‌شود.', leadId: lead.id });
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    if (!rateLimit(req, 12, 15 * 60 * 1000)) return send(res, 429, { ok:false, message:'تلاش ورود زیاد است. چند دقیقه بعد دوباره تلاش کنید.' });
    const body = await parseBody(req);
    if (String(body.username || '') === ADMIN_USERNAME && String(body.password || '') === ADMIN_PASSWORD) return send(res, 200, { ok: true, token: ADMIN_TOKEN, username: ADMIN_USERNAME });
    return send(res, 401, { ok: false, message: 'نام کاربری یا رمز عبور اشتباه است.' });
  }

  if (pathname.startsWith('/api/admin/') && !isAdmin(req)) return send(res, 401, { ok: false, message: 'دسترسی غیرمجاز است.' });

  if (req.method === 'GET' && pathname === '/api/admin/leads') return send(res, 200, { ok: true, leads: readDb().leads });
  if (req.method === 'GET' && pathname === '/api/admin/settings') return send(res, 200, { ok: true, settings: readSettings() });
  if (req.method === 'PUT' && pathname === '/api/admin/settings') {
    const body = await parseBody(req);
    const settings = { cardNumber: sanitizeText(body.cardNumber, 80), amount: sanitizeText(body.amount, 80), template: sanitizeText(body.template, 1000) || readSettings().template };
    await queueWrite(() => atomicWrite(SETTINGS_FILE, settings));
    return send(res, 200, { ok: true, settings });
  }

  const leadMatch = pathname.match(/^\/api\/admin\/leads\/([^/]+)$/);
  if (leadMatch && req.method === 'PATCH') {
    const body = await parseBody(req);
    let updated = null;
    await queueWrite(() => { const db = readDb(); const lead = db.leads.find(item => item.id === leadMatch[1]); if (!lead) return; const allowed = ['جدید', 'تماس گرفته شد', 'نیاز به تماس مجدد', 'خرید انجام شد', 'عدم پاسخ', 'لغو شد']; if (body.status && allowed.includes(body.status)) lead.status = body.status; if (typeof body.adminNote === 'string') lead.adminNote = sanitizeText(body.adminNote, 1500); lead.updatedAt = new Date().toISOString(); updated = lead; atomicWrite(DB_FILE, db); });
    if (!updated) return send(res, 404, { ok: false, message: 'درخواست پیدا نشد.' });
    return send(res, 200, { ok: true, lead: updated });
  }
  if (leadMatch && req.method === 'DELETE') {
    let deleted = false;
    await queueWrite(() => { const db = readDb(); const before = db.leads.length; db.leads = db.leads.filter(item => item.id !== leadMatch[1]); deleted = before !== db.leads.length; atomicWrite(DB_FILE, db); });
    return send(res, 200, { ok: true, deleted });
  }
  if (req.method === 'GET' && pathname === '/api/admin/export.csv') {
    const headers = ['نام', 'موبایل', 'شهر', 'نوع سوگ', 'زمان تماس', 'فوریت', 'توضیحات', 'وضعیت', 'یادداشت مدیر', 'تاریخ ثبت'];
    const escape = value => `"${String(value || '').replace(/"/g, '""')}"`;
    const rows = readDb().leads.map(lead => [lead.fullName, lead.phone, lead.city, lead.griefType, lead.preferredTime, lead.urgency, lead.description, lead.status, lead.adminNote, lead.createdAt].map(escape).join(','));
    const csv = '\ufeff' + headers.map(escape).join(',') + '\n' + rows.join('\n');
    res.writeHead(200, { ...securityHeaders('text/csv; charset=utf-8'), 'Content-Disposition': 'attachment; filename="hamsog-leads.csv"' });
    return res.end(csv);
  }
  return send(res, 404, { ok: false, message: 'مسیر پیدا نشد.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') return await handleApi(req, res, url.pathname);
    return serveStatic(req, res, url.pathname);
  } catch (err) { return send(res, 500, { ok: false, message: err.message || 'خطای سرور رخ داد.' }); }
});
function getLocalIPs() { const nets = os.networkInterfaces(); const ips=[]; for (const name of Object.keys(nets)) for (const net of nets[name] || []) if (net.family === 'IPv4' && !net.internal) ips.push(net.address); return ips; }
server.listen(PORT, '0.0.0.0', () => {
  console.log(`همسوگ آنلاین آماده است: http://localhost:${PORT}`);
  console.log(`پنل مدیریت: http://localhost:${PORT}/admin-v4.html`);
  console.log(`نام کاربری مدیر: ${ADMIN_USERNAME}`);
  console.log('برای انتشار اینترنتی، README-FA.md را ببینید.');
  const ips = getLocalIPs(); if (ips.length) { console.log('تست روی موبایل در وای‌فای مشترک:'); ips.forEach(ip => console.log(`مشتری: http://${ip}:${PORT} | مدیر: http://${ip}:${PORT}/admin-v4.html`)); }
});
