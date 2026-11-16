const fs = require('node:fs');
const path = require('node:path');
const keys = ['DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL', 'ZHIPU_API_KEY',
  'DEFAULT_MODEL_PROVIDER', 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB',
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'];
function readConfig(dataPath) {
  const file = path.join(dataPath, 'connections.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
    DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEFAULT_MODEL_PROVIDER: 'deepseek', POSTGRES_PORT: '5432',
  };
}
function saveConfig(dataPath, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('配置格式无效');
  const clean = {};
  for (const key of keys) {
    const value = values[key] ?? '';
    if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) {
      throw new Error(`配置项 ${key} 格式无效`);
    }
    clean[key] = value;
  }
  if (clean.POSTGRES_HOST && (!/^\d{1,5}$/.test(clean.POSTGRES_PORT) ||
      Number(clean.POSTGRES_PORT) < 1 || Number(clean.POSTGRES_PORT) > 65535)) throw new Error('数据库端口无效');
  const env = keys.filter(key => clean[key]).map(key =>
    `${key}='${clean[key].replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join('\n') + '\n';
  // This file is desktop-managed; it intentionally accepts only known connection fields.
  fs.writeFileSync(path.join(dataPath, '.env.tmp'), env, { mode: 0o600 });
  fs.renameSync(path.join(dataPath, '.env.tmp'), path.join(dataPath, '.env'));
  fs.writeFileSync(path.join(dataPath, 'connections.json'), JSON.stringify(clean, null, 2), { mode: 0o600 });
}
module.exports = { readConfig, saveConfig };
