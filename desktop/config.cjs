const fs = require('node:fs');
const path = require('node:path');
const keys = ['DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL', 'ZHIPU_API_KEY',
  'DEFAULT_MODEL_PROVIDER', 'CUSTOM_API_BASE_URL', 'CUSTOM_API_KEY', 'CUSTOM_API_MODEL',
  'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB',
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
  if (!['deepseek', 'zhipu', 'custom'].includes(clean.DEFAULT_MODEL_PROVIDER)) throw new Error('请选择模型服务');
  if (clean.DEFAULT_MODEL_PROVIDER === 'custom') {
    clean.CUSTOM_API_BASE_URL = clean.CUSTOM_API_BASE_URL.trim().replace(/\/+$/, '');
    clean.CUSTOM_API_MODEL = clean.CUSTOM_API_MODEL.trim();
    let url;
    try { url = new URL(clean.CUSTOM_API_BASE_URL); } catch { throw new Error('请输入完整的自定义 API 地址'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('API 地址须为 http/https 地址，不含账号、查询参数或片段');
    }
    if (/\/(chat\/completions|responses)$/.test(url.pathname)) throw new Error('填写 API 基础地址，例如 https://api.example.com/v1，不含 /chat/completions');
    if (!clean.CUSTOM_API_MODEL) throw new Error('请填写自定义模型名称');
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
