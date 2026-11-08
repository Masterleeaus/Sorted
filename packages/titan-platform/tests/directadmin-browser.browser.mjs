import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { fixture, csrf } from './fixtures/directadmin-bridge-fixture.mjs';
import { createDirectAdminGateway } from '../.test-dist/directadmin-plugin.js';

// Explicit browser suite. Ephemeral loopback TLS material is deleted after the
// test; no system trust store, user server, production key or setting is changed.
test('Chromium: real consumers, cookie flags, browser CSRF headers, safe rendering and cross-tab company invalidation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'titan-da-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const observed = []; const serverErrors = [];
  let origin, gateway;
  let nonceCounter = 0;
  const entry = `import { DirectAdminCockpitSession } from '/packages/titan-platform/src/directadmin-plugin.js';
    import { mountZeroCore } from '/apps/directadmin/zero-core/cockpit.mjs';
    import { mountOperationsHub } from '/apps/directadmin/operations-hub/cockpit.mjs';
    import { mountBrandStudio } from '/apps/directadmin/brand-studio/cockpit.mjs';
    window.session = new DirectAdminCockpitSession(() => document.querySelector('meta[name="titan-directadmin-csrf"]')?.getAttribute('content') ?? '');
    window.connectCockpit = async () => {
      try {
        await window.session.connect();
        if (!window.mounts) window.mounts = [mountZeroCore(window.session, document.querySelector('#zero')),
          mountOperationsHub(window.session, document.querySelector('#ops')),
          mountBrandStudio(window.session, document.querySelector('#brand'))];
        await Promise.all(window.mounts.map(m => m.refresh())); window.ready = true; return true;
      } catch (error) { window.bootstrapError = error.message; return false; }
    };
    await window.connectCockpit();`;
  const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (incoming, outgoing) => {
    const path = new URL(incoming.url, origin).pathname;
    const send = (contentType, body, status = 200) => {
      outgoing.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; frame-ancestors 'self'; base-uri 'none'" }); outgoing.end(body);
    };
    try {
      if (path.startsWith('/v1/')) {
        const headers = incoming.headers; const record = { path, method: incoming.method, headers }; observed.push(record);
        const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        record.body = body.toString('utf8');
        const response = await gateway(new Request(`${origin}${incoming.url}`, { method: incoming.method, headers,
          ...(incoming.method === 'POST' ? { body } : {}) }));
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text()); return;
      }
      if (path === '/test/cockpit') {
        const nonce = String.fromCharCode(65 + ++nonceCounter).repeat(43);
        return send('text/html', `<meta name="titan-directadmin-csrf" content="${nonce}"><!doctype html><title>SDK browser fixture</title><section id="zero"></section><section id="ops"></section><section id="brand"></section><script type="module" src="/test/bootstrap.js"></script>`);
      }
      if (path === '/test/bootstrap.js') return send('text/javascript', entry);
      const platform = /^\/packages\/titan-platform\/src\/([a-z-]+\.js)$/.exec(path);
      const consumer = /^\/apps\/directadmin\/(zero-core|operations-hub|brand-studio)\/cockpit\.mjs$/.exec(path);
      if (platform) return send('text/javascript', await readFile(new URL(`../.test-dist/${platform[1]}`, import.meta.url), 'utf8'));
      if (consumer) return send('text/javascript', await readFile(new URL(`../../../apps/directadmin/${consumer[1]}/cockpit.mjs`, import.meta.url), 'utf8'));
      return send('text/plain', 'fixture route not found', 404);
    } catch (error) { serverErrors.push(error instanceof Error ? error.message : 'unknown'); return send('text/plain', 'fixture unavailable', 500); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  origin = `https://127.0.0.1:${server.address().port}`;
  const f = await fixture(t, { origin, provider: `directadmin:${new URL(origin).origin}` });
  let bootstrapCalls = 0;
  gateway = createDirectAdminGateway(f.bridge, f.owners, { provide: async proof => {
    bootstrapCalls++;
    assert.equal(proof.origin, origin);
    assert.equal(proof.cookie, 'da_session=fixture-authenticated');
    assert.equal(proof.authorization, null);
    assert.ok(/^[A-Za-z0-9_-]{43,128}$/.test(proof.csrf_nonce));
    if (bootstrapCalls === 1) throw new Error('authentication-denied');
    return { login_assertion: await f.loginFor(f.policy.upstream.issuer, `browser-bootstrap-${bootstrapCalls}`),
      company_id: 'company-a', device_id: 'device-1', csrf_token: csrf };
  } });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) }); t.after(() => browser.close());
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addCookies([{ name: 'da_session', value: 'fixture-authenticated', domain: '127.0.0.1', path: '/',
    secure: true, sameSite: 'Strict' }]);
  const page = await context.newPage();
  const errors = []; const consoleErrors = []; const failedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`));
  await page.goto(`${origin}/test/cockpit`);
  try { await page.waitForFunction(() => window.bootstrapError === 'directadmin-session-rejected', undefined, { timeout: 10_000 }); }
  catch { throw new Error(`Browser denial transition failed: page=${errors.join('; ')}; console=${consoleErrors.join('; ')}; requests=${failedRequests.join('; ')}; server=${serverErrors.join('; ')}; gateway=${observed.map(r => r.path).join(', ')}`); }
  assert.equal(await page.evaluate(() => window.bootstrapError), 'directadmin-session-rejected');
  assert.equal(await page.evaluate(() => window.ready ?? false), false);
  await page.evaluate(async () => {
    document.querySelector('meta[name="titan-directadmin-csrf"]').setAttribute('content', 'R'.repeat(43));
    return window.connectCockpit();
  });
  try { await page.waitForFunction(() => window.ready, undefined, { timeout: 10_000 }); }
  catch { throw new Error(`Browser bootstrap failed: page=${errors.join('; ')}; console=${consoleErrors.join('; ')}; requests=${failedRequests.join('; ')}; server=${serverErrors.join('; ')}; gateway=${observed.map(r => r.path).join(', ')}`); }
  assert.equal(bootstrapCalls, 2);
  assert.equal(await page.locator('[data-state="ready"]').count(), 3);
  assert.match(await page.locator('#zero [role="status"]').innerText(), /0 attention items/);
  assert.match(await page.locator('#ops [role="status"]').innerText(), /0 observed nodes/);
  assert.match(await page.locator('#brand [role="status"]').innerText(), /Publication publication-1/);
  assert.equal(await page.evaluate(() => document.cookie.includes('__Host-titan-da-session')), false);
  assert.equal(await page.evaluate(token => document.documentElement.innerHTML.includes(token), csrf), false);
  const bootstrapRequests = observed.filter(r => r.path === '/v1/directadmin/bootstrap');
  assert.equal(bootstrapRequests.length, 2);
  assert.deepEqual(bootstrapRequests.map(request => request.method), ['POST', 'POST']);
  assert.deepEqual(bootstrapRequests.map(request => request.body), ['', '']);
  assert.deepEqual(bootstrapRequests.map(request => request.headers['x-titan-da-bootstrap-csrf']), ['B'.repeat(43), 'R'.repeat(43)]);
  assert.ok(bootstrapRequests.every(request => request.headers['x-titan-csrf'] === undefined));
  const contextRequests = observed.filter(r => r.path === '/v1/directadmin/context');
  const get = contextRequests.at(-1);
  assert.equal(get.headers['sec-fetch-site'], 'same-origin'); assert.equal(get.headers['x-titan-csrf'], csrf);
  assert.equal(new URL(get.headers.referer).origin, origin);
  const intent = await page.evaluate(async () => {
    const current = await window.session.connect();
    return window.session.intent('titan_zero', { company_id: current.company_id, actor_id: current.actor_id,
      capability_id: 'zero.inspect', operation_id: 'browser-operation', correlation_id: 'browser-correlation', input: {} });
  });
  assert.deepEqual(intent, { status: 'REQUESTED', receipt_id: 'receipt-1', correlation_id: 'browser-correlation' });
  const intentRequest = observed.find(r => r.path === '/v1/directadmin/titan_zero/intents');
  assert.match(JSON.parse(intentRequest.body).context_revision, /^ctx1_[A-Za-z0-9_-]{43}$/);
  assert.equal(f.effects[0].context.context_revision, f.claims.context_revision);

  // Real keyboard refresh uses the shared button and keeps a live status region.
  await page.locator('#zero button').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#zero').dataset.state === 'ready');
  assert.equal(await page.locator('#zero [role="status"]').getAttribute('aria-live'), 'polite');

  const original = f.owners.projection;
  f.owners.projection = async (plugin, current) => {
    const result = await original(plugin, current);
    if (plugin === 'titan_web') return { ...result, source: '<img src=x onerror="window.injected=true">',
      data: { ...result.data, publication_id: '<script>window.injected=true</script>' } };
    return result;
  };
  await page.locator('#brand button').click();
  await page.waitForFunction(() => document.querySelector('#brand pre').textContent.includes('<img'));
  assert.equal(await page.locator('#brand img, #brand script').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);

  // A version mismatch is visible and isolated, without displaying old data.
  f.owners.projection = async (plugin, current) => {
    const result = await original(plugin, current);
    return plugin === 'titan_operations' ? { ...result, data: { ...result.data, schema: 'titan.operations-health.v999' } } : result;
  };
  await page.locator('#ops button').click();
  await page.waitForFunction(() => document.querySelector('#ops').dataset.state === 'incompatible');
  assert.equal(await page.locator('#ops pre').innerText(), '');
  assert.equal(await page.locator('#zero').getAttribute('data-state'), 'ready');
  f.owners.projection = original;

  const sibling = await context.newPage(); await sibling.goto(`${origin}/test/cockpit`); await sibling.waitForFunction(() => window.ready);
  await page.evaluate(() => window.session.switchCompany('company-b'));
  await sibling.waitForFunction(() => [...document.querySelectorAll('section')].every(e => e.dataset.state === 'read-only'));
  assert.equal(await page.locator('section pre').allTextContents().then(text => text.join('')), '');
  assert.equal(await sibling.locator('section pre').allTextContents().then(text => text.join('')), '');
  const post = observed.find(r => r.path === '/v1/directadmin/company');
  assert.equal(post.headers.origin, origin); assert.equal(post.headers['x-titan-csrf'], csrf);
  const rotated = (await context.cookies()).find(c => c.name === '__Host-titan-da-session');
  assert.ok(rotated); assert.notEqual(rotated.value, f.token);
  assert.equal(rotated.httpOnly, true); assert.equal(rotated.secure, true); assert.equal(rotated.sameSite, 'Strict');
  assert.equal(await page.evaluate(() => document.cookie.includes('__Host-titan-da-session')), false);
  const selected = await page.evaluate(async () => {
    const current = await window.session.connect(); await Promise.all(window.mounts.map(m => m.refresh())); return current.company_id;
  });
  assert.equal(selected, 'company-b'); assert.equal(await page.locator('[data-state="ready"]').count(), 3);
  assert.equal(await sibling.locator('[data-state="read-only"]').count(), 3);
  await page.evaluate(() => window.session.logout());
  assert.equal((await context.cookies()).some(c => c.name === '__Host-titan-da-session'), false);
  assert.deepEqual(errors, []);
});
