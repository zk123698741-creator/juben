const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

async function startBackend({ packaged, resourcesPath, dataPath, python, onFailure }) {
  const token = randomBytes(32).toString('hex');
  fs.mkdirSync(path.join(dataPath, 'logs'), { recursive: true });
  const log = fs.createWriteStream(path.join(dataPath, 'logs', 'desktop-backend.log'), { flags: 'a' });
  const executable = packaged ? path.join(resourcesPath, 'backend', 'juben-backend.exe') :
    (python || process.env.JUBEN_PYTHON || path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe'));
  const args = packaged ? [] : [path.join(__dirname, 'backend.py')];
  const child = spawn(executable, args, {
    cwd: dataPath, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
      JUBEN_DESKTOP_DATA: dataPath, JUBEN_DESKTOP_TOKEN: token },
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.stdin.on('error', () => {}); // A failed/exited child may close its pipe first.
  let stopped = false;
  let exited = false;
  let failure;
  let origin;
  child.on('error', error => { failure = error; });
  const done = new Promise(resolve => child.once('exit', (code) => {
    exited = true;
    if (!stopped) {
      failure = new Error(`本地服务退出（${code}），请查看日志。`);
      if (origin) onFailure?.(failure);
    }
    resolve();
  }));
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const port = JSON.parse(line).juben_desktop_port;
      if (Number.isInteger(port) && port > 0 && port < 65536) origin = `http://127.0.0.1:${port}`;
    } catch { /* application logs are not protocol messages */ }
  });
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    child.stdin.end();
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
    if (!exited) {
      child.kill();
      await Promise.race([done, new Promise(resolve => setTimeout(resolve, 2000).unref())]);
    }
    lines.close();
    log.end();
  };
  try {
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (origin) {
        try {
          const response = await fetch(`${origin}/__desktop/ready`, {
            headers: { 'X-Juben-Desktop': token }, signal: AbortSignal.timeout(1500),
          });
          if (response.ok && (await response.json()).ready === true) { ready = true; break; }
        } catch { /* server imports and startup hooks may still be running */ }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error('本地服务启动超时，请通过「文件 → 打开数据目录」查看日志。');
    return {
      origin, token, pid: child.pid, stop,
      async session() {
        const response = await fetch(`${origin}/__desktop/session`, {
          headers: { 'X-Juben-Desktop': token }, signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`本地登录失败（${response.status}）`);
        const session = await response.json();
        session.user.role = session.user.roles?.includes('admin') ? 'admin' : 'user';
        return session;
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startBackend };
