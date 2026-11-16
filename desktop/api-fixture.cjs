const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { saveConfig } = require('./config.cjs');

async function createAPIFixture(data) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      assert.equal(req.url, '/v1/chat/completions');
      assert.equal(req.headers.authorization, 'Bearer TOKEN');
      const value = JSON.parse(body);
      assert.equal(value.model, 'custom-test-model');
      assert.ok(!value.thinking);
      requests.push(value);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'test-completion', object: 'chat.completion', created: 1,
        model: value.model, choices: [{ index: 0, message: { role: 'assistant',
          content: '# 自定义 API 验证大纲\n第一集：人物登场。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    } catch (error) { res.writeHead(400); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const workspace = path.join(data, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  saveConfig(workspace, { DEFAULT_MODEL_PROVIDER: 'custom', CUSTOM_API_KEY: 'TOKEN',
    CUSTOM_API_MODEL: 'custom-test-model',
    CUSTOM_API_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` });
  return { requests, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { createAPIFixture };
