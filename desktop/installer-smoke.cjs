const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function main() {
  // NSIS uses a per-app registry key even when APPDATA is redirected. Never
  // let an isolated installation test replace an existing user's installation.
  const existing = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'Juben' } | Select-Object -ExpandProperty InstallLocation"],
    { encoding: 'utf8', windowsHide: true });
  const active = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-Process Juben -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path'],
    { encoding: 'utf8', windowsHide: true });
  if ((existing.stdout || '').trim() || (active.stdout || '').trim()) {
    console.log('installer-smoke: SKIP_EXISTING_INSTALL (use a clean Windows runner)');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'juben-install-check-'));
  const install = path.join(root, 'app');
  const profile = path.join(root, 'profile');
  const data = path.join(profile, 'juben-desktop');
  fs.mkdirSync(data, { recursive: true });
  const sentinel = path.join(data, 'uninstall-retain.txt');
  fs.writeFileSync(sentinel, 'keep-user-data');
  const env = { ...process.env, APPDATA: profile, JUBEN_SMOKE_DATA: data,
    JUBEN_EXE: path.join(install, 'Juben.exe'), JUBEN_TEST_CUSTOM: '1' };
  function run(exe, args) {
    const result = spawnSync(exe, args, { env, windowsHide: true, encoding: 'utf8', timeout: 600000 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${exe} failed`);
  }
  assert.ok(fs.existsSync(process.env.JUBEN_INSTALLER || ''), 'Set JUBEN_INSTALLER');
  run(process.env.JUBEN_INSTALLER, ['/S', `/D=${install}`]);
  assert.ok(fs.existsSync(env.JUBEN_EXE), 'Installed EXE missing');
  run(process.execPath, [path.join(__dirname, 'smoke.cjs')]);
  // Reinstall over the existing app and verify user data survives the upgrade.
  run(process.env.JUBEN_INSTALLER, ['/S', `/D=${install}`]);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep-user-data');
  const dramaFiles = fs.readdirSync(path.join(data, 'workspace', 'projects'));
  assert.ok(dramaFiles.length > 0, 'Upgrade lost projects');
  const uninstaller = path.join(install, 'Uninstall Juben.exe');
  assert.ok(fs.existsSync(uninstaller), 'Uninstaller missing');
  run(uninstaller, ['/S']);
  for (let i = 0; i < 100 && fs.existsSync(env.JUBEN_EXE); i++) await new Promise(r => setTimeout(r, 200));
  assert.ok(!fs.existsSync(env.JUBEN_EXE), 'Uninstall did not remove program');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep-user-data');
  assert.ok(fs.readdirSync(path.join(data, 'workspace', 'projects')).length > 0);
  console.log(JSON.stringify({ result: 'PASS', checks: ['silent-install', 'installed-exe',
    'custom-api-end-to-end', 'restart', 'upgrade-retains-data', 'silent-uninstall', 'uninstall-retains-data'], root }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
