const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startBackend } = require('./runtime.cjs');

(async () => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'juben-backend-check-'));
  const packaged = process.argv.includes('--packaged');
  const backend = await startBackend({ packaged,
    resourcesPath: path.resolve(__dirname, '..', 'dist', 'desktop', 'win-unpacked', 'resources'), dataPath });
  try {
    const forbidden = await fetch(backend.origin);
    assert.equal(forbidden.status, 403);
    const session = await backend.session();
    assert.equal(session.user.role, 'admin');
    const headers = { 'X-Juben-Desktop': backend.token, Authorization: `Bearer ${session.tokens.accessToken}`,
      'Content-Type': 'application/json' };
    const page = await fetch(`${backend.origin}/dramas`, { headers });
    assert.match(await page.text(), /<div id="root">/);
    const create = await fetch(`${backend.origin}/juben/dramas`, {
      method: 'POST', headers, body: JSON.stringify({ title: 'Desktop smoke', total_episodes: 3 }),
    });
    assert.equal(create.status, 200, await create.clone().text());
    const drama = await create.json();
    assert.ok(drama.success && drama.drama?.id, JSON.stringify(drama));
    assert.ok(fs.readdirSync(path.join(dataPath, 'projects')).length);
    console.log(JSON.stringify({ backend: packaged ? 'frozen' : 'source',
      checks: ['capability-gate', 'local-login', 'SPA-refresh', 'create-drama', 'persistent-data'],
      result: 'PASS', dataPath }));
  } finally { await backend.stop(); }
  await assert.rejects(fetch(`${backend.origin}/__desktop/ready`, { signal: AbortSignal.timeout(1000) }));
  console.log('shutdown: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
