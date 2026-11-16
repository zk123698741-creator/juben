// Drive the embedded Electron renderer over CDP: NSIS does not forward the
// Node inspector pipe expected by Playwright's _electron launcher.
const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'juben-portable-check-'));
  const executable = process.env.JUBEN_EXE;
  assert.ok(executable && fs.existsSync(executable));
  const env = { ...process.env, JUBEN_SMOKE_DATA: data };
  for (const key of Object.keys(env)) {
    if (['path', 'pythonpath', 'pythonhome', 'virtual_env', 'electron_run_as_node'].includes(key.toLowerCase())) delete env[key];
  }
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  env.JUBEN_PYTHON = 'Z:\\not-installed\\python.exe';
  let previousOrigin;
  for (let run = 1; run <= 2; run++) {
    const debugPort = await freePort();
    const start = Date.now();
    const child = spawn(executable, [`--remote-debugging-port=${debugPort}`], { env, windowsHide: true, stdio: 'ignore' });
    let exitCode;
    const exited = new Promise(resolve => child.once('exit', code => { exitCode = code; resolve(); }));
    child.on('error', error => { throw error; });
    let browser;
    try {
      let endpoint;
      while (Date.now() - start < 300000) {
        if (exitCode !== undefined) throw new Error(`Portable launcher exited: ${exitCode}`);
        try {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1000) });
          endpoint = (await response.json()).webSocketDebuggerUrl;
          if (endpoint) break;
        } catch {}
        await delay(500);
      }
      assert.ok(endpoint, 'Portable extraction/startup exceeded 5 minutes');
      browser = await chromium.connectOverCDP(endpoint);
      const page = browser.contexts()[0].pages()[0];
      assert.ok(page, 'Expected desktop window');
      await page.waitForURL(/http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120000 });
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.isAuthenticated);
      const origin = new URL(page.url()).origin;
      assert.equal((await fetch(origin)).status, 403);
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      if (run === 1) {
        previousOrigin = origin;
        await page.evaluate(() => localStorage.setItem('portable-preference', 'retained'));
        const created = await page.evaluate(async () => {
          const auth = JSON.parse(localStorage.getItem('auth-storage')).state;
          const response = await fetch('/juben/dramas', { method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.tokens.accessToken}` },
            body: JSON.stringify({ title: '便携 EXE 验证作品', total_episodes: 3 }) });
          return { status: response.status, data: await response.json() };
        });
        assert.equal(created.status, 200);
        assert.ok(created.data.drama.id);
      } else {
        assert.equal(origin, previousOrigin);
        assert.equal(await page.evaluate(() => localStorage.getItem('portable-preference')), 'retained');
      }
      await page.goto(`${origin}/dramas`);
      await page.getByText('便携 EXE 验证作品', { exact: true }).first().waitFor();
      await page.reload();
      await page.getByText('便携 EXE 验证作品', { exact: true }).first().waitFor();
      if (process.env.JUBEN_SCREENSHOT) await page.screenshot({ path: process.env.JUBEN_SCREENSHOT, animations: 'disabled' });
      console.log(JSON.stringify({ mode: 'portable-exe-cdp', run, result: 'PASS',
        startupSeconds: Math.round((Date.now() - start) / 1000), data,
        checks: ['self-extraction', 'desktop-window', 'bundled-backend', 'automatic-login',
          'no-system-python-node', 'renderer-isolation', 'capability-gate', 'drama-persistence', 'SPA-refresh'] }));
      await page.close();
      await Promise.race([exited, delay(30000)]);
      assert.notEqual(exitCode, undefined, 'Portable process did not stop after closing its window');
      await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }));
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (exitCode === undefined) {
        await new Promise(resolve => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' }).once('exit', resolve));
      }
    }
  }
  console.log('restart-persistence: PASS; shutdown: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
