import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPortfolioServer } from '../server.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PASSWORD = 'A test owner password 2026!';
const SETUP_TOKEN = 'test-only-bootstrap-token-with-at-least-32-characters';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrL8AAAAASUVORK5CYII=', 'base64');
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

function seedPortfolio() {
  return {
    revision: 1,
    profile: {
      name: 'Test Chef', role: 'Professional chef', tagline: 'Seasonal cooking',
      introduction: 'A test portfolio.', location: 'Colombo',
      email: 'chef@example.com', phone: '+94 77 123 4567',
      availability: 'Available for private dining', portrait: '/img/profile.png',
      resume: '/resume.pdf',
      socials: { instagram: '', linkedin: '', facebook: '', whatsapp: '' },
    },
    specialties: ['Private dining', 'Pastry'],
    experience: [{ role: 'Chef', workplace: 'Test Kitchen', period: '2024–present', description: 'Seasonal menus.' }],
    projects: [
      { id: 'published-project', title: 'Seasonal menu', category: 'Private dining', description: 'A tasting menu.', date: '2026-10-01', image: '/img/profile.png', featured: true, published: true },
      { id: 'draft-project', title: 'Private draft project', category: 'Private dining', description: 'Not published.', date: '2026-10-02', image: '/img/profile.png', featured: false, published: false },
    ],
    thoughts: [
      { id: 'published-thought', title: 'Kitchen notes', body: 'Seasonal ingredients.', date: '2026-10-01', published: true },
      { id: 'draft-thought', title: 'Private draft thought', body: 'Not published.', date: '2026-10-02', published: false },
    ],
    reviews: [
      { id: 'published-review', name: 'Test Customer', context: 'Private dinner', quote: 'A lovely meal.', rating: 5, published: true },
      { id: 'draft-review', name: 'Private draft customer', context: 'Unapproved review', quote: 'Not published.', rating: 4, published: false },
    ],
  };
}

async function closeServer(server) {
  if (!server.listening) return;
  const closing = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closing;
}

async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'chef-portfolio-test-'));
  const staticDir = path.join(folder, 'site');
  const dataDir = path.join(folder, 'private');
  const seedPath = path.join(folder, 'seed.json');
  await mkdir(path.join(staticDir, 'img'), { recursive: true });
  await mkdir(path.join(staticDir, 'css'), { recursive: true });
  await mkdir(path.join(staticDir, 'server'), { recursive: true });
  await mkdir(path.join(staticDir, '.git'), { recursive: true });
  await Promise.all([
    writeFile(seedPath, JSON.stringify(seedPortfolio())),
    writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Public test site</title>'),
    writeFile(path.join(staticDir, 'admin.html'), '<!doctype html><title>Owner test page</title>'),
    writeFile(path.join(staticDir, 'css', 'style.css'), 'body { color: black; }'),
    writeFile(path.join(staticDir, 'img', 'profile.png'), PNG),
    writeFile(path.join(staticDir, 'resume.pdf'), '%PDF-1.4\nTest only'),
    writeFile(path.join(staticDir, '.env'), 'TEST_PRIVATE_MARKER=never-public'),
    writeFile(path.join(staticDir, 'server.mjs'), 'const TEST_PRIVATE_MARKER = "never-public";'),
    writeFile(path.join(staticDir, 'server', 'seed.json'), '{"TEST_PRIVATE_MARKER":"never-public"}'),
    writeFile(path.join(staticDir, '.git', 'config'), 'TEST_PRIVATE_MARKER=never-public'),
    writeFile(path.join(folder, 'outside-secret.txt'), 'TEST_PRIVATE_MARKER=never-public'),
  ]);
  const servers = [];
  t.after(async () => {
    for (const server of servers) await closeServer(server);
    await rm(folder, { recursive: true, force: true });
  });
  async function start() {
    const server = await createPortfolioServer({ staticDir, dataDir, seedPath, setupToken: SETUP_TOKEN, cookieSecure: false });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.push(server);
    const address = server.address();
    const baseURL = `http://127.0.0.1:${address.port}`;
    return { server, baseURL, request: (route, options) => fetch(`${baseURL}${route}`, options) };
  }
  return { ...(await start()), folder, staticDir, dataDir, start };
}

function jsonOptions(method, body, session, extraHeaders = {}) {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...extraHeaders },
    body: JSON.stringify(body),
  };
}

async function authenticatedSession(response) {
  assert.equal(response.status, 200);
  const cookieHeader = response.headers.get('set-cookie');
  assert.ok(cookieHeader, 'Authentication must issue a session cookie');
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=(Strict|Lax)/i);
  assert.match(cookieHeader, /Path=\//i);
  const session = await response.json();
  assert.equal(session.authenticated, true);
  assert.equal(typeof session.csrfToken, 'string');
  assert.ok(session.csrfToken.length >= 24);
  return { ...session, cookie: cookieHeader.split(';', 1)[0] };
}

async function setup(site) {
  return authenticatedSession(await site.request('/api/setup', jsonOptions('POST', { token: SETUP_TOKEN, password: PASSWORD })));
}

async function adminPortfolio(site, session) {
  const response = await site.request('/api/admin/portfolio', { headers: { Cookie: session.cookie } });
  assert.equal(response.status, 200);
  return response.json();
}

function rawRequest(baseURL, pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseURL);
    const request = http.get({ hostname: url.hostname, port: url.port, path: pathname }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
  });
}

test('visitors receive only published content and cannot edit or upload', async (t) => {
  const site = await fixture(t);
  const response = await site.request('/api/portfolio');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  const publicPortfolio = await response.json();
  for (const collection of ['projects', 'thoughts', 'reviews']) {
    assert.equal(publicPortfolio[collection].length, 1);
    assert.equal(publicPortfolio[collection][0].published, true);
    assert.doesNotMatch(JSON.stringify(publicPortfolio[collection]), /draft/i);
  }
  assert.equal((await site.request('/api/admin/portfolio')).status, 401);
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', seedPortfolio()))).status, 401);
  assert.equal((await site.request('/api/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG })).status, 401);
});

test('first-time owner setup requires the setup token and a strong password', async (t) => {
  const site = await fixture(t);
  const initial = await (await site.request('/api/session')).json();
  assert.equal(initial.setupRequired, true);
  assert.equal(initial.authenticated, false);
  assert.equal(initial.csrfToken, undefined);
  assert.equal((await site.request('/api/setup', jsonOptions('POST', { token: SETUP_TOKEN, password: PASSWORD }, undefined, { Origin: 'https://attacker.example' }))).status, 403);
  const wrongToken = await site.request('/api/setup', jsonOptions('POST', { token: 'wrong-token', password: PASSWORD }));
  assert.equal(wrongToken.status, 403);
  assert.equal(wrongToken.headers.get('set-cookie'), null);
  assert.equal((await site.request('/api/setup', jsonOptions('POST', { token: SETUP_TOKEN, password: 'short' }))).status, 400);
  const session = await setup(site);
  const state = await (await site.request('/api/session', { headers: { Cookie: session.cookie } })).json();
  assert.equal(state.setupRequired, false);
  assert.equal(state.authenticated, true);
  assert.equal(state.csrfToken, session.csrfToken);
  assert.equal((await site.request('/api/setup', jsonOptions('POST', { token: SETUP_TOKEN, password: 'A different owner password!' }))).status, 403);
  assert.equal((await site.request('/api/login', jsonOptions('POST', { password: PASSWORD }))).status, 200);
});

test('login, CSRF, browser-origin protection and logout enforce owner access', async (t) => {
  const site = await fixture(t);
  const initialSession = await setup(site);
  assert.equal((await site.request('/api/login', jsonOptions('POST', { password: 'an incorrect password' }))).status, 401);
  const crossOriginLogin = await site.request('/api/login', jsonOptions('POST', { password: PASSWORD }, undefined, { Origin: 'https://attacker.example' }));
  assert.equal(crossOriginLogin.status, 403);
  assert.equal(crossOriginLogin.headers.get('set-cookie'), null);
  const session = await authenticatedSession(await site.request('/api/login', jsonOptions('POST', { password: PASSWORD })));
  const portfolio = await adminPortfolio(site, session);
  assert.equal(portfolio.projects.length, 2);
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', portfolio, session, { 'X-CSRF-Token': '' }))).status, 403);
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', portfolio, session, { 'X-CSRF-Token': 'wrong' }))).status, 403);
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', portfolio, session, { Origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', portfolio, session, { 'Sec-Fetch-Site': 'cross-site' }))).status, 403);
  assert.equal((await site.request('/api/logout', { method: 'POST', headers: { Cookie: session.cookie } })).status, 403);
  assert.equal((await site.request('/api/logout', jsonOptions('POST', {}, session))).status, 200);
  assert.equal((await site.request('/api/admin/portfolio', { headers: { Cookie: session.cookie } })).status, 401);
  const loggedOut = await (await site.request('/api/session', { headers: { Cookie: session.cookie } })).json();
  assert.equal(loggedOut.authenticated, false);
  assert.equal((await site.request('/api/admin/portfolio', { headers: { Cookie: initialSession.cookie } })).status, 200);
});

test('owner changes persist, drafts stay private, and stale writes cannot overwrite changes', async (t) => {
  const site = await fixture(t);
  const session = await setup(site);
  const original = await adminPortfolio(site, session);
  const update = structuredClone(original);
  update.profile.tagline = 'A newly saved chef profile';
  update.projects[1].title = 'Private new dish';
  update.thoughts[1].title = 'Private kitchen idea';
  update.reviews[1].quote = 'A private pending customer review.';
  const response = await site.request('/api/portfolio', jsonOptions('PUT', update, session));
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.revision, original.revision + 1);
  assert.equal(saved.profile.tagline, update.profile.tagline);
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', original, session))).status, 409);
  const publicResponse = await (await site.request('/api/portfolio')).json();
  assert.equal(publicResponse.profile.tagline, update.profile.tagline);
  assert.doesNotMatch(JSON.stringify(publicResponse), /Private new dish|Private kitchen idea|private pending customer/);
  await closeServer(site.server);
  const restarted = await site.start();
  assert.equal((await (await restarted.request('/api/session')).json()).setupRequired, false);
  assert.equal((await restarted.request('/api/admin/portfolio', { headers: { Cookie: session.cookie } })).status, 401);
  const newSession = await authenticatedSession(await restarted.request('/api/login', jsonOptions('POST', { password: PASSWORD })));
  const persisted = await adminPortfolio(restarted, newSession);
  assert.equal(persisted.revision, saved.revision);
  assert.equal(persisted.profile.tagline, update.profile.tagline);
  assert.equal(persisted.projects[1].title, 'Private new dish');
  assert.equal(persisted.thoughts[1].published, false);
  assert.equal(persisted.reviews[1].quote, 'A private pending customer review.');
});

test('invalid portfolio input is rejected without changing stored content', async (t) => {
  const site = await fixture(t);
  const session = await setup(site);
  const original = await adminPortfolio(site, session);
  const mutations = [
    (value) => { value.profile.portrait = 'javascript:alert(1)'; },
    (value) => { value.profile.portrait = 'data:image/svg+xml,<svg onload="alert(1)"/>'; },
    (value) => { value.profile.portrait = '/img/../../.env'; },
    (value) => { value.profile.resume = '/server/seed.json'; },
    (value) => { value.profile.socials.instagram = 'javascript:alert(1)'; },
    (value) => { value.projects[0].image = '//attacker.example/tracker.png'; },
    (value) => { value.projects[0].id = '../unsafe-id'; },
    (value) => { value.projects[0].date = '2026-02-30'; },
    (value) => { value.projects[0].published = 'true'; },
    (value) => { value.reviews[0].rating = 6; },
    (value) => { value.projects.push(structuredClone(value.projects[0])); },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(original);
    mutate(value);
    assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', value, session))).status, 400);
  }
  const malformed = await site.request('/api/portfolio', { method: 'PUT', headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, body: '{invalid-json' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await adminPortfolio(site, session), original);
});

test('draft projects can wait for a photograph, and unrated reviews remain publishable', async (t) => {
  const site = await fixture(t);
  const session = await setup(site);
  const original = await adminPortfolio(site, session);
  const missingPublishedImage = structuredClone(original);
  missingPublishedImage.projects[0].image = '';
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', missingPublishedImage, session))).status, 400);
  const missingCategory = structuredClone(original);
  missingCategory.projects[1].category = '';
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', missingCategory, session))).status, 400);
  const valid = structuredClone(original);
  valid.projects[1].image = '';
  valid.reviews[0].rating = 0;
  const response = await site.request('/api/portfolio', jsonOptions('PUT', valid, session));
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.projects[1].published, false);
  assert.equal(saved.projects[1].image, '');
  const publicPortfolio = await (await site.request('/api/portfolio')).json();
  assert.equal(publicPortfolio.projects.length, 1);
  assert.equal(publicPortfolio.reviews[0].rating, 0);
});

test('PNG, JPEG and WebP uploads stay private until published and survive restart', async (t) => {
  const site = await fixture(t);
  const session = await setup(site);
  const jpeg = await readFile(path.join(ROOT, 'img', 'f10.jpg'));
  const uploaded = [];
  for (const [mime, bytes, extension] of [['image/png', PNG, 'png'], ['image/jpeg', jpeg, 'jpg'], ['image/webp', WEBP, 'webp']]) {
    const response = await site.request('/api/upload', { method: 'POST', headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': mime }, body: bytes });
    assert.equal(response.status, 201);
    const { url } = await response.json();
    assert.match(url, new RegExp(`^/uploads/[a-f0-9]{24}\\.${extension}$`));
    assert.equal((await site.request(url)).status, 404, 'Unattached uploads must remain private');
    const ownerPreview = await site.request(url, { headers: { Cookie: session.cookie } });
    assert.equal(ownerPreview.status, 200);
    assert.match(ownerPreview.headers.get('cache-control'), /no-store/);
    assert.equal(ownerPreview.headers.get('content-type'), mime);
    assert.equal(ownerPreview.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await ownerPreview.arrayBuffer()), bytes);
    uploaded.push([url, bytes, mime]);
  }
  const update = await adminPortfolio(site, session);
  update.profile.portrait = uploaded[0][0];
  uploaded.slice(1).forEach(([url], index) => {
    update.projects.push({ ...update.projects[0], id: `uploaded-photo-${index}`, image: url });
  });
  assert.equal((await site.request('/api/portfolio', jsonOptions('PUT', update, session))).status, 200);
  for (const [url, bytes, mime] of uploaded) {
    const publicImage = await site.request(url);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get('content-type'), mime);
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), bytes);
  }
  await closeServer(site.server);
  const restarted = await site.start();
  for (const [url, bytes] of uploaded) {
    const response = await restarted.request(url);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
});

test('draft, unpublished and removed project uploads are visible only to the owner', async (t) => {
  const site = await fixture(t);
  const session = await setup(site);
  const uploadResponse = await site.request('/api/upload', { method: 'POST', headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'image/png' }, body: PNG });
  assert.equal(uploadResponse.status, 201);
  const { url } = await uploadResponse.json();
  let update = await adminPortfolio(site, session);
  update.projects[1].image = url;
  const save = async () => {
    const response = await site.request('/api/portfolio', jsonOptions('PUT', update, session));
    assert.equal(response.status, 200);
    update = await response.json();
  };
  await save();
  assert.equal((await site.request(url)).status, 404);
  const preview = await site.request(url, { headers: { Cookie: session.cookie } });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('cache-control'), /no-store/);
  update.projects[1].published = true;
  await save();
  assert.equal((await site.request(url)).status, 200);
  update.projects[1].published = false;
  await save();
  assert.equal((await site.request(url)).status, 404);
  update.projects = update.projects.filter((entry) => entry.id !== 'draft-project');
  await save();
  assert.equal((await site.request(url)).status, 404);
  assert.equal((await site.request(url, { headers: { Cookie: session.cookie } })).status, 200);
  await closeServer(site.server);
  const restarted = await site.start();
  assert.equal((await restarted.request(url)).status, 404);
  const newSession = await authenticatedSession(await restarted.request('/api/login', jsonOptions('POST', { password: PASSWORD })));
  assert.equal((await restarted.request(url, { headers: { Cookie: newSession.cookie } })).status, 200);
});

test('uploads reject missing CSRF, spoofed images, truncation, unsupported types and oversized files', async (t) => {
  const site = await fixture(t);
  const session = await setup(site);
  const upload = (type, body, csrfToken = session.csrfToken) => site.request('/api/upload', { method: 'POST', headers: { Cookie: session.cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': type }, body });
  assert.equal((await upload('image/png', PNG, '')).status, 403);
  assert.equal((await upload('image/png', Buffer.from('<script>alert(1)</script>'))).status, 400);
  assert.equal((await upload('image/png', PNG.subarray(0, 24))).status, 400);
  assert.equal((await upload('image/jpeg', PNG)).status, 400);
  assert.equal((await upload('image/svg+xml', Buffer.from('<svg/>'))).status, 415);
  assert.equal((await upload('image/png', Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
  const stillAvailable = await site.request('/api/portfolio');
  assert.equal(stillAvailable.status, 200);
});

test('static files use an allowlist and encoded paths cannot disclose source or private state', async (t) => {
  const site = await fixture(t);
  await setup(site);
  for (const route of ['/', '/admin.html', '/css/style.css', '/img/profile.png', '/resume.pdf']) {
    assert.equal((await site.request(route)).status, 200, route);
  }
  const privateRoutes = [
    '/.env', '/server.mjs', '/server/seed.json', '/.git/config', '/package.json',
    '/data/account.json', '/data/portfolio.json', '/uploads/../account.json',
    '/%2e%2e/outside-secret.txt', '/img/%2e%2e/.env',
    '/img/%2e%2e/%2e%2e/outside-secret.txt', '/img/..%5c..%5coutside-secret.txt',
    '/uploads/%2e%2e/account.json', '/uploads/%2e%2e/portfolio.json',
  ];
  for (const route of privateRoutes) {
    const response = await rawRequest(site.baseURL, route);
    assert.ok(response.status >= 400 && response.status < 500, route);
    assert.doesNotMatch(response.body, /TEST_PRIVATE_MARKER|passwordHash|passwordSalt|sessionSecret/, route);
  }
});

test('public asset directories cannot expose files through directory junctions or symlinks', async (t) => {
  const site = await fixture(t);
  const outsideDir = path.join(site.folder, 'outside-assets');
  await mkdir(outsideDir);
  await writeFile(path.join(outsideDir, 'private.css'), '/* TEST_PRIVATE_MARKER=never-public */');
  try {
    await symlink(outsideDir, path.join(site.staticDir, 'css', 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('Operating system does not permit temporary symlink fixtures.');
      return;
    }
    throw error;
  }
  const response = await site.request('/css/escaped/private.css');
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /TEST_PRIVATE_MARKER/);
});
