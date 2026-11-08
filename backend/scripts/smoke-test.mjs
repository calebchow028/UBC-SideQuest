#!/usr/bin/env node
// Smoke test against a running backend.
//
//   node scripts/smoke-test.mjs                       # http://localhost:3000
//   node scripts/smoke-test.mjs https://api.example.com
//   SMOKE_TOKEN=<access token> node scripts/smoke-test.mjs https://api.example.com
//
// Without SMOKE_TOKEN it checks /health and that protected routes reject anonymous calls.
// With SMOKE_TOKEN (an Auth0 access token for AUTH0_AUDIENCE, or "dev:<name>" when the server
// runs with AUTH_MODE=dev) it also calls the read-only protected endpoints.
// How to get a real token: Auth0 Dashboard -> Applications -> APIs -> <your API> -> Test tab,
// or copy it from the frontend (getAccessTokenSilently()) in the browser devtools.

const base = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const token = process.env.SMOKE_TOKEN;
let failures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? `  ${detail}` : ''}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}  ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function call(method, path, { auth, body } = {}) {
  const headers = { accept: 'application/json' };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const expectStatus = (res, status) => {
  if (res.status !== status) throw new Error(`expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.json)}`);
};

console.log(`Smoke testing ${base}\n`);

await check('GET /health', async () => {
  const res = await call('GET', '/health');
  expectStatus(res, 200);
  if (res.json.status !== 'ok' || res.json.service !== 'sidequest-backend') throw new Error(JSON.stringify(res.json));
  return JSON.stringify(res.json);
});

await check('GET /api/queue/status without a token is 401', async () => {
  const res = await call('GET', '/api/queue/status');
  expectStatus(res, 401);
});

if (token) {
  await check('GET /api/profile (authenticated)', async () => {
    const res = await call('GET', '/api/profile', { auth: token });
    if (res.status !== 200 && res.status !== 404) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.json)}`);
    return res.status === 404 ? '(no profile yet: create one with PUT /api/profile)' : `id=${res.json.id}`;
  });
  await check('GET /api/queue/status (authenticated)', async () => {
    const res = await call('GET', '/api/queue/status', { auth: token });
    expectStatus(res, 200);
    return JSON.stringify(res.json);
  });
} else {
  console.log('SKIP  protected endpoints (set SMOKE_TOKEN to test them)');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
