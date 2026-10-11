import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_JSON = 2 * 1024 * 1024;
const SESSION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const HASH_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const COOKIE_NAME = 'chef_owner';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function fail(message) { throw new HttpError(400, message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}
function string(value, label, max, required = false) {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const clean = value.trim();
  if (clean.length > max || (required && !clean)) fail(`${label} must be ${required ? '1–' : 'at most '}${max} characters.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(clean)) fail(`${label} contains an invalid character.`);
  return clean;
}
function array(value, label, max, map) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must contain at most ${max} entries.`);
  return value.map((item, index) => map(item, `${label} entry ${index + 1}`));
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be true or false.`);
  return value;
}
function date(value, label) {
  const clean = string(value, label, 10);
  if (clean && (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(Date.parse(`${clean}T00:00:00Z`)) || new Date(`${clean}T00:00:00Z`).toISOString().slice(0, 10) !== clean)) fail(`${label} must be a valid YYYY-MM-DD date.`);
  return clean;
}
function id(value, label) {
  const clean = string(value, label, 80, true);
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) fail(`${label} may contain only letters, numbers, underscores, and hyphens.`);
  return clean;
}
function unique(entries, label) {
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) fail(`${label} IDs must be unique.`);
  return entries;
}
function safePath(value) {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (!decoded.startsWith('/') || /[\\\u0000-\u0020?#]/.test(decoded.replace(/ /g, '')) || decoded.includes('//') || decoded.split('/').some(segment => segment === '.' || segment === '..')) return null;
  return decoded;
}
function media(value, label, isResume = false) {
  const clean = string(value, label, 512);
  if (!clean) return '';
  const decoded = safePath(clean);
  if (!decoded || (isResume
    ? !(/^\/[A-Za-z0-9 _.-]+\.pdf$/i.test(decoded) || /^\/resume\/[A-Za-z0-9 _.-]+\.pdf$/i.test(decoded))
    : !/^\/(img|uploads)\/[A-Za-z0-9 _./-]+\.(png|jpe?g|webp|gif)$/i.test(decoded))) fail(`${label} must be a safe local ${isResume ? 'PDF' : 'image'} path.`);
  return encodeURI(decoded);
}
function social(value, label) {
  const clean = string(value, label, 2048);
  if (!clean) return '';
  let parsed;
  try { parsed = new URL(clean); } catch { fail(`${label} must be an http or https URL.`); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) fail(`${label} must be an http or https URL without credentials.`);
  return parsed.href;
}

/** Validate and copy only the supported portfolio fields before saving. */
export function normalizePortfolio(value) {
  const input = object(value, 'Portfolio');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail('Portfolio revision must be a positive integer.');
  const profile = object(input.profile, 'Profile');
  const socials = object(profile.socials, 'Social links');
  const email = string(profile.email, 'Email', 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Email must be a valid email address.');
  return {
    revision: input.revision,
    profile: {
      name: string(profile.name, 'Name', 120, true), role: string(profile.role, 'Role', 120),
      tagline: string(profile.tagline, 'Tagline', 300), introduction: string(profile.introduction, 'Introduction', 5000),
      location: string(profile.location, 'Location', 160), email, phone: string(profile.phone, 'Phone', 80),
      availability: string(profile.availability, 'Availability', 200), portrait: media(profile.portrait, 'Portrait'),
      resume: media(profile.resume, 'Resume', true),
      socials: Object.fromEntries(['instagram', 'linkedin', 'facebook', 'whatsapp'].map(key => [key, social(socials[key], key)])),
    },
    specialties: array(input.specialties, 'Specialties', 16, (item, label) => string(item, label, 100, true)),
    experience: array(input.experience, 'Experience', 20, (item, label) => {
      object(item, label);
      return { role: string(item.role, `${label} role`, 120, true), workplace: string(item.workplace, `${label} workplace`, 160), period: string(item.period, `${label} period`, 120), description: string(item.description, `${label} description`, 2000) };
    }),
    projects: unique(array(input.projects, 'Projects', 100, (item, label) => {
      object(item, label);
      const image = media(item.image, `${label} image`);
      const published = boolean(item.published, `${label} published`);
      if (published && !image) fail(`${label} needs a photo before publishing.`);
      return { id: id(item.id, `${label} ID`), title: string(item.title, `${label} title`, 160, true), category: string(item.category, `${label} category`, 100, true), description: string(item.description, `${label} description`, 2000), date: date(item.date, `${label} date`), image, featured: boolean(item.featured, `${label} featured`), published };
    }), 'Project'),
    thoughts: unique(array(input.thoughts, 'Thoughts', 50, (item, label) => {
      object(item, label);
      return { id: id(item.id, `${label} ID`), title: string(item.title, `${label} title`, 160, true), body: string(item.body, `${label} body`, 12000), date: date(item.date, `${label} date`), published: boolean(item.published, `${label} published`) };
    }), 'Thought'),
    reviews: unique(array(input.reviews, 'Reviews', 100, (item, label) => {
      object(item, label);
      if (!Number.isInteger(item.rating) || item.rating < 0 || item.rating > 5) fail(`${label} rating must be between 0 and 5; use 0 for an unrated review.`);
      return { id: id(item.id, `${label} ID`), name: string(item.name, `${label} name`, 120, true), context: string(item.context, `${label} context`, 160), quote: string(item.quote, `${label} quote`, 2000, true), rating: item.rating, published: boolean(item.published, `${label} published`) };
    }), 'Review'),
  };
}

async function atomicJson(filename, data) {
  const temporary = `${filename}.${randomBytes(12).toString('hex')}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  try { await fs.rename(temporary, filename); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
async function readJson(filename) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function makeOwner(password) {
  const salt = randomBytes(32).toString('hex');
  const hash = await scrypt(password, salt, 64, HASH_OPTIONS);
  return { version: 1, salt, hash: hash.toString('hex') };
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) fail('Choose a password between 12 and 256 characters.');
}
function equalText(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  const a = Buffer.from(first); const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0; let exceeded = false;
    request.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        if (!exceeded) { exceeded = true; reject(new HttpError(413, 'This request is too large.')); }
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    request.on('error', reject);
    request.on('aborted', () => reject(new HttpError(400, 'The request was interrupted.')));
  });
}
async function jsonBody(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Send JSON using Content-Type: application/json.');
  const bytes = await readBody(request, MAX_JSON);
  try { return object(JSON.parse(bytes.toString('utf8')), 'Request'); }
  catch (error) { if (error instanceof HttpError) throw error; fail('The JSON request is invalid.'); }
}
function imageExtension(bytes, contentType) {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw new HttpError(415, 'Upload a JPEG, PNG, or WebP image.');
  let valid = false;
  if (type === 'image/png' && bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
    valid = width > 0 && height > 0 && width <= 12000 && height <= 12000 && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND';
  }
  if (type === 'image/jpeg') valid = bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (type === 'image/webp' && bytes.length >= 20) {
    valid = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16)) && bytes.readUInt32LE(16) > 0 && bytes.readUInt32LE(16) <= bytes.length - 20;
  }
  if (!valid) fail('The file does not contain a supported, complete image.');
  return type === 'image/jpeg' ? '.jpg' : type === 'image/png' ? '.png' : '.webp';
}
function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}
function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function checkOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'This action must come from this website.');
  if (!request.headers.origin) return;
  let origin;
  try { origin = new URL(request.headers.origin); } catch { throw new HttpError(403, 'This action must come from this website.'); }
  // A reverse proxy may terminate HTTPS; the original Host must be preserved.
  if (!['http:', 'https:'].includes(origin.protocol) || origin.host.toLowerCase() !== request.headers.host?.toLowerCase()) throw new HttpError(403, 'This action must come from this website.');
}
function publicPortfolio(portfolio) {
  return { ...portfolio, projects: portfolio.projects.filter(item => item.published), thoughts: portfolio.thoughts.filter(item => item.published), reviews: portfolio.reviews.filter(item => item.published) };
}

/** Create an initialized server without listening. Each instance owns its sessions. */
export async function createPortfolioServer(options = {}) {
  const staticDir = path.resolve(options.staticDir || ROOT);
  const dataDir = path.resolve(options.dataDir || process.env.PORTFOLIO_DATA_DIR || path.join(ROOT, 'data'));
  const uploadsDir = path.join(dataDir, 'uploads');
  const seedPath = path.resolve(options.seedPath || path.join(ROOT, 'server', 'seed.json'));
  const cookieSecure = options.cookieSecure ?? process.env.COOKIE_SECURE === 'true';
  await fs.mkdir(uploadsDir, { recursive: true, mode: 0o700 });
  const realStaticDir = await fs.realpath(staticDir);
  const realUploadsDir = await fs.realpath(uploadsDir);
  const portfolioPath = path.join(dataDir, 'portfolio.json');
  const ownerPath = path.join(dataDir, 'owner.json');
  let portfolio = normalizePortfolio(await readJson(portfolioPath) || await readJson(seedPath));
  if (!await readJson(portfolioPath)) await atomicJson(portfolioPath, portfolio);
  let owner = await readJson(ownerPath);
  if (owner && (owner.version !== 1 || !/^[0-9a-f]{64}$/.test(owner.salt) || !/^[0-9a-f]{128}$/.test(owner.hash))) throw new Error('Stored owner credentials are invalid. Restore a backup or reset the owner.');
  const initialPassword = options.ownerPassword ?? process.env.PORTFOLIO_OWNER_PASSWORD;
  if (!owner && initialPassword) {
    validatePassword(initialPassword);
    owner = await makeOwner(initialPassword);
    await atomicJson(ownerPath, owner);
  }
  let setupToken = owner ? null : options.setupToken || randomBytes(32).toString('base64url');
  const sessions = new Map();
  const attempts = new Map();
  let writeQueue = Promise.resolve();
  const exclusive = action => {
    const next = writeQueue.then(action);
    writeQueue = next.catch(() => {});
    return next;
  };
  function getSession(request) {
    const cookie = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`));
    const token = cookie?.slice(COOKIE_NAME.length + 1);
    if (!token || token.length > 128) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expires <= Date.now()) { sessions.delete(token); return null; }
    return { ...session, token };
  }
  function requireSession(request, withCsrf = false) {
    const session = getSession(request);
    if (!session) throw new HttpError(401, 'Sign in to edit this portfolio.');
    if (withCsrf && !equalText(request.headers['x-csrf-token'], session.csrfToken)) throw new HttpError(403, 'Your session could not verify this request. Refresh and try again.');
    return session;
  }
  function cookie(response, token, maxAge = SESSION_MS / 1000) {
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${cookieSecure ? '; Secure' : ''}`);
  }
  function signIn(request, response) {
    const old = getSession(request);
    if (old) sessions.delete(old.token);
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    sessions.set(token, { csrfToken, expires: Date.now() + SESSION_MS });
    cookie(response, token);
    return { authenticated: true, csrfToken };
  }
  function rateLimit(request) {
    const key = request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = attempts.get(key);
    if (!entry || now - entry.start >= LOGIN_WINDOW_MS) { entry = { start: now, count: 0 }; attempts.set(key, entry); }
    entry.count += 1;
    if (entry.count > 10) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  }
  async function staticFile(request, response, pathname) {
    let base; let relative; let privatePreview = false;
    if (pathname.startsWith('/uploads/')) {
      if (!/^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(pathname)) throw new HttpError(404, 'File not found.');
      const isPublished = portfolio.profile.portrait === pathname || portfolio.projects.some(project => project.published && project.image === pathname);
      if (!isPublished) {
        if (!getSession(request)) throw new HttpError(404, 'File not found.');
        privatePreview = true;
      }
      base = realUploadsDir; relative = pathname.slice('/uploads/'.length);
    } else {
      const route = pathname === '/' ? '/index.html' : pathname === '/admin' || pathname === '/admin/' ? '/admin.html' : pathname;
      const extension = path.extname(route).toLowerCase();
      const safeAsset = (/^\/css\/[A-Za-z0-9 _./-]+$/.test(route) && ['.css', '.woff', '.woff2'].includes(extension))
        || (/^\/js\/[A-Za-z0-9 _./-]+\.js$/.test(route))
        || (/^\/img\/[A-Za-z0-9 _./-]+$/.test(route) && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico'].includes(extension));
      const resumePath = portfolio.profile.resume ? decodeURIComponent(portfolio.profile.resume) : null;
      const safeRoot = ['/index.html', '/admin.html', '/favicon.ico', '/favicon.png', '/favicon.svg', '/NAAZIM SANOAF.pdf'].includes(route) || (resumePath && route === resumePath);
      if (!safeAsset && !safeRoot) throw new HttpError(404, 'File not found.');
      base = realStaticDir; relative = route.slice(1);
    }
    const candidate = path.resolve(base, relative);
    if (!candidate.startsWith(`${base}${path.sep}`)) throw new HttpError(404, 'File not found.');
    let actual;
    try { actual = await fs.realpath(candidate); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError(404, 'File not found.'); throw error; }
    if (!actual.startsWith(`${base}${path.sep}`)) throw new HttpError(404, 'File not found.');
    // Reject symlinked files even when they resolve inside the public directory.
    if (actual !== candidate) throw new HttpError(404, 'File not found.');
    const stat = await fs.stat(actual);
    if (!stat.isFile()) throw new HttpError(404, 'File not found.');
    const extension = path.extname(actual).toLowerCase();
    response.writeHead(200, { 'Content-Type': MIME[extension] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': privatePreview ? 'private, no-store' : extension === '.html' ? 'no-cache' : 'public, max-age=3600', ...(extension === '.pdf' ? { 'Content-Disposition': 'inline' } : {}) });
    if (request.method === 'HEAD') response.end();
    else response.end(await fs.readFile(actual));
  }
  const server = http.createServer(async (request, response) => {
    securityHeaders(response);
    if (cookieSecure) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const rawPath = (request.url || '/').split('?')[0];
      const pathname = safePath(rawPath);
      if (!pathname) throw new HttpError(404, 'Page not found.');
      if (pathname.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') checkOrigin(request);
        if (request.method === 'GET' && pathname === '/api/session') {
          const session = getSession(request);
          return sendJson(response, 200, { authenticated: Boolean(session), setupRequired: !owner, ...(session ? { csrfToken: session.csrfToken } : {}) });
        }
        if (request.method === 'GET' && pathname === '/api/portfolio') return sendJson(response, 200, publicPortfolio(portfolio));
        if (request.method === 'GET' && pathname === '/api/admin/portfolio') {
          requireSession(request);
          return sendJson(response, 200, portfolio);
        }
        if (request.method === 'POST' && pathname === '/api/setup') {
          rateLimit(request);
          const body = await jsonBody(request);
          const result = await exclusive(async () => {
            if (owner || !equalText(body.token, setupToken)) throw new HttpError(403, 'The setup token is incorrect or setup is already complete.');
            validatePassword(body.password);
            const nextOwner = await makeOwner(body.password);
            await atomicJson(ownerPath, nextOwner);
            owner = nextOwner; setupToken = null;
            server.portfolioSetupRequired = false; server.portfolioSetupToken = null;
            return signIn(request, response);
          });
          return sendJson(response, 200, result);
        }
        if (request.method === 'POST' && pathname === '/api/login') {
          rateLimit(request);
          const body = await jsonBody(request);
          if (!owner || typeof body.password !== 'string' || body.password.length > 256) throw new HttpError(401, 'The password is incorrect.');
          const candidate = await scrypt(body.password, owner.salt, 64, HASH_OPTIONS);
          if (!timingSafeEqual(candidate, Buffer.from(owner.hash, 'hex'))) throw new HttpError(401, 'The password is incorrect.');
          return sendJson(response, 200, signIn(request, response));
        }
        if (request.method === 'POST' && pathname === '/api/logout') {
          const session = requireSession(request, true);
          sessions.delete(session.token); cookie(response, '', 0);
          return sendJson(response, 200, { authenticated: false });
        }
        if (request.method === 'PUT' && pathname === '/api/portfolio') {
          requireSession(request, true);
          const input = normalizePortfolio(await jsonBody(request));
          const saved = await exclusive(async () => {
            if (input.revision !== portfolio.revision) throw new HttpError(409, 'This portfolio was changed in another window. Reload before saving again.');
            const next = { ...input, revision: portfolio.revision + 1 };
            await atomicJson(portfolioPath, next); portfolio = next;
            return next;
          });
          return sendJson(response, 200, saved);
        }
        if (request.method === 'POST' && pathname === '/api/upload') {
          requireSession(request, true);
          const bytes = await readBody(request, MAX_UPLOAD);
          const extension = imageExtension(bytes, request.headers['content-type']);
          const filename = `${randomBytes(12).toString('hex')}${extension}`;
          await fs.writeFile(path.join(uploadsDir, filename), bytes, { flag: 'wx', mode: 0o600 });
          return sendJson(response, 201, { url: `/uploads/${filename}` });
        }
        throw new HttpError(404, 'API endpoint not found.');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'This page supports GET and HEAD requests.');
      await staticFile(request, response, pathname);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (!(error instanceof HttpError)) console.error('Portfolio request failed:', error.code || error.name);
      sendJson(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.portfolioSetupRequired = !owner;
  server.portfolioSetupToken = setupToken;
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expires <= now) sessions.delete(token);
    for (const [key, entry] of attempts) if (now - entry.start >= LOGIN_WINDOW_MS) attempts.delete(key);
  }, 60_000);
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); sessions.clear(); attempts.clear(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = path.resolve(process.env.PORTFOLIO_DATA_DIR || path.join(ROOT, 'data'));
  try {
    if (process.argv.includes('--reset-owner')) {
      await fs.rm(path.join(dataDir, 'owner.json'), { force: true });
      console.log('Owner password reset. Existing sessions end when the old server is stopped.');
    }
    const server = await createPortfolioServer({ dataDir });
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid port number.');
    server.on('error', error => { console.error(`Could not start the portfolio server: ${error.message}`); process.exitCode = 1; });
    server.listen(port, host, () => {
      const address = server.address();
      console.log(`Chef portfolio: http://${host}:${address.port}`);
      console.log(`Owner editor: http://${host}:${address.port}/admin`);
      if (server.portfolioSetupRequired) console.log(`One-time owner setup token (keep private): ${server.portfolioSetupToken}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { process.exitCode = 0; }));
  } catch (error) {
    console.error(`Could not start the portfolio server: ${error.message}`);
    process.exitCode = 1;
  }
}
