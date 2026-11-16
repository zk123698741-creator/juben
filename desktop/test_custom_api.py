"""Real HTTP protocol checks; no external credentials or paid service."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aiohttp import web
from utils.llm_client import get_llm_client


class CustomAPITest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests = []
        app = web.Application()
        app.router.add_post('/v1/chat/completions', self.respond)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.env = patch.dict(os.environ, {
            'JUBEN_DESKTOP_DATA': 'test', 'DEFAULT_MODEL_PROVIDER': 'custom',
            'CUSTOM_API_BASE_URL': f'http://127.0.0.1:{port}/v1',
            'CUSTOM_API_KEY': 'TOKEN', 'CUSTOM_API_MODEL': 'custom-test-model'})
        self.env.start()
        self.client = get_llm_client('deepseek', model='old-hardcoded-model')

    async def asyncTearDown(self):
        await self.client.client.close()
        self.env.stop()
        await self.runner.cleanup()

    async def respond(self, request):
        self.assertEqual(request.headers['Authorization'], 'Bearer TOKEN')
        body = await request.json()
        self.assertEqual(body['model'], 'custom-test-model')
        self.assertNotIn('thinking', body)
        self.requests.append(body)
        if body.get('stream'):
            return web.Response(text='data: {"id":"s","object":"chat.completion.chunk","created":1,"model":"custom-test-model","choices":[]}\n\n'
                'data: {"id":"s","object":"chat.completion.chunk","created":1,"model":"custom-test-model","choices":[{"index":0,"delta":{"content":"STREAM_OK"}}]}\n\n'
                'data: [DONE]\n\n', content_type='text/event-stream')
        message = {'role': 'assistant', 'content': 'CHAT_OK'}
        if body.get('tools'):
            message['tool_calls'] = [{'id': 'call_1', 'type': 'function',
                'function': {'name': 'check', 'arguments': '{}'}}]
        return web.json_response({'id': 'test', 'object': 'chat.completion', 'created': 1,
            'model': body['model'], 'choices': [{'index': 0, 'message': message,
                'finish_reason': 'tool_calls' if body.get('tools') else 'stop'}]})

    async def test_legacy_override_and_chat(self):
        self.assertEqual(await self.client.chat([{'role': 'user', 'content': 'test'}], model='old'), 'CHAT_OK')
        self.assertEqual(len(self.requests), 1)

    async def test_stream(self):
        text = ''.join([part async for part in self.client.stream_chat([{'role': 'user', 'content': 'test'}])])
        self.assertEqual(text, 'STREAM_OK')

    async def test_tools(self):
        result = await self.client.chat_with_tools([{'role': 'user', 'content': 'test'}],
            tools=[{'type': 'function', 'function': {'name': 'check', 'parameters': {'type': 'object'}}}],
            model='old', extra_body={'thinking': {'type': 'disabled'}})
        self.assertEqual(result['tool_calls'][0]['function']['name'], 'check')


if __name__ == '__main__':
    unittest.main()
