const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const data = process.env.JUBEN_SMOKE_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'juben-ui-check-'));
  const fixture = process.env.JUBEN_TEST_CUSTOM ? await require('./api-fixture.cjs').createAPIFixture(data) : null;
  const executablePath = process.env.JUBEN_EXE;
  const env = { ...process.env, JUBEN_SMOKE_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  if (executablePath) {
    // The packaged application must start without finding Python/Node on PATH.
    for (const name of Object.keys(env)) {
      if (['path', 'pythonpath', 'pythonhome', 'virtual_env'].includes(name.toLowerCase())) delete env[name];
    }
    env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
    env.JUBEN_PYTHON = 'Z:\\not-installed\\python.exe';
  }
  let origin;
  const errors = [];
  const launch = () => _electron.launch({ executablePath: executablePath || require('electron'),
    args: executablePath ? [] : [__dirname], env, timeout: 300000 });
  let electron = await launch();
  let dramaId;
  try {
    const page = await electron.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL(/http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120000 });
    await page.waitForFunction(() => {
      const auth = JSON.parse(localStorage.getItem('auth-storage') || '{}');
      return auth.state?.isAuthenticated && document.querySelector('#root')?.textContent.length > 40;
    }, { timeout: 30000 });
    origin = new URL(page.url()).origin;
    await page.evaluate(() => localStorage.setItem('desktop-smoke-preference', 'retained'));
    assert.equal((await fetch(origin)).status, 403);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    const result = await page.evaluate(async () => {
      const state = JSON.parse(localStorage.getItem('auth-storage')).state;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${state.tokens.accessToken}` };
      const response = await fetch('/juben/dramas', { method: 'POST', headers,
        body: JSON.stringify({ title: '桌面版持久化验证', total_episodes: 3 }) });
      return { status: response.status, data: await response.json() };
    });
    assert.equal(result.status, 200);
    dramaId = result.data.drama?.id;
    assert.ok(dramaId, JSON.stringify(result));
    if (fixture) {
      const generated = await page.evaluate(async id => {
        const state = JSON.parse(localStorage.getItem('auth-storage')).state;
        const response = await fetch(`/juben/dramas/${id}/outline`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.tokens.accessToken}` },
          body: JSON.stringify({ premise: '自定义接口端到端验证' }) });
        return { status: response.status, body: await response.json() };
      }, dramaId);
      assert.equal(generated.status, 200, JSON.stringify(generated));
      assert.ok(generated.body.outline.includes('自定义 API 验证大纲'));
      assert.equal(fixture.requests.length, 1);
      console.log('custom-api-frozen-backend: PASS (endpoint, key, model, outline persistence)');
    }
    await page.goto(`${origin}/dramas`);
    await page.getByText('桌面版持久化验证', { exact: true }).first().waitFor({ timeout: 30000 });
    await page.reload();
    await page.getByText('桌面版持久化验证', { exact: true }).first().waitFor({ timeout: 30000 });
    const screenshot = process.env.JUBEN_SCREENSHOT || path.join(data, 'desktop.png');
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    const settingsPromise = electron.waitForEvent('window', { timeout: 15000 });
    await electron.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items[0].click());
    const settings = await settingsPromise;
    await settings.waitForLoadState('domcontentloaded');
    if (fixture) {
      await settings.waitForFunction(() => document.querySelector('[name=CUSTOM_API_MODEL]').value === 'custom-test-model');
      assert.equal(await settings.locator('[name=DEFAULT_MODEL_PROVIDER]').inputValue(), 'custom');
      if (process.env.JUBEN_SETTINGS_SCREENSHOT) await settings.screenshot({ path: process.env.JUBEN_SETTINGS_SCREENSHOT });
    } else await settings.waitForFunction(() => document.querySelector('[name=DEEPSEEK_MODEL]').value === 'deepseek-flash');
    await assert.rejects(page.evaluate(() => window.jubenDesktop.getConfig()));
    await settings.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', mode: executablePath ? 'packaged-exe' : 'development',
      checks: ['window', 'automatic-login', 'renderer-isolation', 'capability-gate', 'create-drama',
        'SPA-refresh', 'settings-window', 'IPC-sender-check'], screenshot, data }));
  } finally { await electron.close(); }
  await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }));
  // Reopen the executable with the same profile: data must survive process exit.
  electron = await launch();
  try {
    const page = await electron.firstWindow();
    await page.waitForURL(/http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120000 });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.isAuthenticated);
    const freshOrigin = new URL(page.url()).origin;
    assert.equal(freshOrigin, origin);
    assert.equal(await page.evaluate(() => localStorage.getItem('desktop-smoke-preference')), 'retained');
    await page.goto(`${freshOrigin}/dramas`);
    await page.getByText('桌面版持久化验证', { exact: true }).first().waitFor({ timeout: 30000 });
    assert.ok(dramaId);
    console.log('restart-persistence: PASS; shutdown: PASS');
  } finally { await electron.close(); if (fixture) await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
