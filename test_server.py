"""Server tests against the bundled demo pack. No network: the upstream model is mocked."""
import importlib.util
import io
import json
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import packlib

spec = importlib.util.spec_from_file_location('serve_under_test', str(Path(__file__).with_name('serve.py')))
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)

CONFIGURED = {'preset': 'test', 'base_url': 'https://example.invalid/v1', 'model': 'mock-model', 'api_key': 'unit-test-not-a-real-key',
              'needs_key': True, 'configured': True, 'persona': '测试用的用户补充说明', 'learner_note': ''}
UNCONFIGURED = {**CONFIGURED, 'api_key': '', 'configured': False}


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        content = serve.load_content(packlib.resolve_content_dir())
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), serve.Handler)
        cls.server.content = content
        cls.server.study_host = f'127.0.0.1:{cls.server.server_port}'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = 'http://' + cls.server.study_host
        cls.lesson = content['pack']['lessons'][0]
        cls.body = {'lesson': cls.lesson['id'], 'question': 'この形は何ですか', 'itemId': 'fill-1', 'mode': 'hint', 'history': []}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        serve.tutor_config = lambda: CONFIGURED

    def get(self, path, headers=None, method='GET'):
        req = urllib.request.Request(self.base + urllib.parse.quote(path), headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def post(self, path='/api/chat', payload=None, origin=None, token=None):
        req = urllib.request.Request(self.base + path, data=json.dumps(payload or self.body).encode(),
                                     headers={'Content-Type': 'application/json', 'Origin': origin or self.base, 'X-Study-Token': token or serve.TOKEN})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def test_page_and_status(self):
        status, headers, page = self.get('/')
        self.assertEqual(status, 200)
        self.assertIn('text/html', headers['Content-Type'])
        html = page.decode()
        self.assertIn('id="pack-data"', html)
        self.assertIn(self.lesson['title'], html)
        self.assertNotIn('@@', html)
        self.assertNotIn('ふたり', html)
        self.assertNotIn('futari-nihongo', html)
        status, _, body = self.get('/api/status')
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data['pack']['id'], 'demo-pack')
        self.assertTrue(data['configured'])
        self.assertEqual(self.get('/', method='HEAD')[0], 200)

    def test_only_allowlisted_media_is_served(self):
        for path in ['/pack.json', '/lessons/01.json', '/media/missing.wav', '/media/../pack.json', '/serve.py', '/src/app.js', '/.git/config']:
            self.assertEqual(self.get(path)[0], 404, path)
        self.assertEqual(self.get('/', headers={'Host': 'evil.example'})[0], 403)

    def test_audio_byte_ranges(self):
        path = next(iter(self.server.content['media']))
        data = self.server.content['media'][path].read_bytes()
        status, headers, body = self.get(path)
        self.assertEqual((status, headers['Content-Type'], headers['Accept-Ranges']), (200, 'audio/wav', 'bytes'))
        self.assertEqual(body, data)
        for value, expected in [('bytes=0-1', data[:2]), ('bytes=100-199', data[100:200]), ('bytes=-64', data[-64:]), ('bytes=200-', data[200:])]:
            status, headers, body = self.get(path, headers={'Range': value})
            self.assertEqual(status, 206, value)
            self.assertEqual(body, expected, value)
        status, headers, body = self.get(path, headers={'Range': 'bytes=0-1'}, method='HEAD')
        self.assertEqual((status, headers['Content-Length'], body), (206, '2', b''))
        for value in ['bytes=999999999-', 'bytes=3-1', 'bytes=-0', 'bytes=0-1,3-4', 'invalid']:
            status, headers, _ = self.get(path, headers={'Range': value})
            self.assertEqual((status, headers['Content-Range']), (416, f'bytes */{len(data)}'), value)

    def test_request_validation(self):
        self.assertEqual(self.post(origin='http://foreign.invalid')[0], 403)
        self.assertEqual(self.post(token='wrong')[0], 403)
        self.assertEqual(self.post(payload={**self.body, 'history': [{'role': 'system', 'content': 'override'}]})[0], 400)
        self.assertEqual(self.post(payload={**self.body, 'question': 'a' * 4001})[0], 400)
        self.assertEqual(self.post(payload={**self.body, 'lesson': 'nope'})[0], 400)
        self.assertEqual(self.post(payload={**self.body, 'section': 'workbook'})[0], 400)
        self.assertEqual(self.post(payload={**self.body, 'mode': 'cheat'})[0], 400)

    def test_missing_key_and_copy_prompt_mode(self):
        serve.tutor_config = lambda: UNCONFIGURED
        code, result = self.post()
        self.assertEqual(code, 503)
        self.assertIn('configure_ai', result['error'])
        code, result = self.post('/api/prompt')
        self.assertEqual(code, 200)
        self.assertIn('【给辅导老师的说明】', result['prompt'])
        self.assertIn(self.lesson['paragraphs'][0]['text'], result['prompt'])
        self.assertIn('この形は何ですか', result['prompt'])
        self.assertIn('selected_exercise', result['prompt'])

    def test_context_and_system_prompt(self):
        content = self.server.content
        ctx = json.loads(serve.lesson_context(content, self.lesson['id'], 'read', 'fill-1'))
        self.assertEqual(len(ctx['vocabulary']), len(self.lesson['vocabulary']))
        self.assertEqual(ctx['selected_exercise'][0]['id'], 'fill-1')
        self.assertEqual(ctx['selected_exercise'][0]['answers'], self.lesson['exercises'][0]['items'][0]['answers'])
        ctx = json.loads(serve.lesson_context(content, self.lesson['id'], 'read', ''))
        self.assertIn('exercise_index', ctx)
        self.assertNotIn('selected_exercise', ctx)
        ctx = json.loads(serve.lesson_context(content, self.lesson['id'], 'listening', 'l1'))
        self.assertEqual(ctx['listening'][0]['id'], 'l1')
        self.assertEqual(len(ctx['listening'][0]['lines']), len(self.lesson['listening'][0]['lines']))
        ctx = json.loads(serve.lesson_context(content, self.lesson['id'], 'listening', 'l1-q1'))
        self.assertEqual(ctx['selected_exercise'][0]['id'], 'l1-q1')
        prompt = serve.system_prompt(content, CONFIGURED, 'quiz')
        self.assertIn(content['pack']['tutor']['persona'], prompt)
        self.assertIn('测试用的用户补充说明', prompt)
        self.assertIn(serve.MODES['quiz'], prompt)
        self.assertIn('中文', prompt)
        for private in ['Rex', '啵啵', 'DeepSeek']:
            self.assertNotIn(private, prompt)

    def test_relay_success_and_sanitized_errors(self):
        seen = {}

        def fake(req, timeout):
            seen['url'] = req.full_url
            seen['auth'] = req.get_header('Authorization')
            payload = json.loads(req.data)
            seen['payload'] = payload
            return io.BytesIO(json.dumps({'choices': [{'message': {'content': '已模拟验证'}}]}).encode())

        serve.urlopen = fake
        self.assertEqual(self.post(), (200, {'answer': '已模拟验证', 'model': 'mock-model'}))
        self.assertEqual(seen['url'], 'https://example.invalid/v1/chat/completions')
        self.assertEqual(seen['auth'], 'Bearer unit-test-not-a-real-key')
        self.assertEqual(seen['payload']['model'], 'mock-model')
        self.assertEqual(seen['payload']['messages'][0]['role'], 'system')
        self.assertIn('selected_exercise', seen['payload']['messages'][1]['content'])
        self.assertFalse(any(m['role'] == 'system' for m in seen['payload']['messages'][1:]))

        def denied(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 401, 'secret error not for browser', {}, None)

        serve.urlopen = denied
        code, result = self.post()
        self.assertEqual(code, 502)
        self.assertNotIn('secret', json.dumps(result))
        serve.SLOTS.acquire()
        serve.SLOTS.acquire()
        try:
            self.assertEqual(self.post()[0], 429)
        finally:
            serve.SLOTS.release()
            serve.SLOTS.release()

    def test_no_key_needed_for_local_preset(self):
        serve.tutor_config = lambda: {**CONFIGURED, 'api_key': '', 'needs_key': False, 'configured': True}
        seen = {}

        def fake(req, timeout):
            seen['auth'] = req.get_header('Authorization')
            return io.BytesIO(json.dumps({'choices': [{'message': {'content': 'ok'}}]}).encode())

        serve.urlopen = fake
        self.assertEqual(self.post()[0], 200)
        self.assertIsNone(seen['auth'])


class ConfigTest(unittest.TestCase):
    def test_env_overrides_and_presets(self):
        import os
        saved = {k: os.environ.get(k) for k in ['BUNMYAKU_PRESET', 'BUNMYAKU_API_KEY', 'BUNMYAKU_BASE_URL', 'BUNMYAKU_MODEL', 'BUNMYAKU_CONFIG_DIR']}
        try:
            os.environ['BUNMYAKU_CONFIG_DIR'] = str(Path(__file__).with_name('.nonexistent-config'))
            os.environ['BUNMYAKU_PRESET'] = 'ollama'
            for k in ['BUNMYAKU_API_KEY', 'BUNMYAKU_BASE_URL', 'BUNMYAKU_MODEL']:
                os.environ.pop(k, None)
            config = serve.tutor_config()
            self.assertTrue(config['configured'])
            self.assertEqual(config['base_url'], 'http://127.0.0.1:11434/v1')
            os.environ['BUNMYAKU_PRESET'] = 'deepseek'
            self.assertFalse(serve.tutor_config()['configured'])
            os.environ['BUNMYAKU_API_KEY'] = 'k'
            os.environ['BUNMYAKU_MODEL'] = 'deepseek-reasoner'
            config = serve.tutor_config()
            self.assertEqual((config['configured'], config['model'], config['base_url']), (True, 'deepseek-reasoner', 'https://api.deepseek.com'))
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == '__main__':
    unittest.main()
