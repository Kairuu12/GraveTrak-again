import gzip
import json
import os
import subprocess
import sys
from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase, TestCase, override_settings


class RenderConfigurationTests(SimpleTestCase):
    def load_settings(self, **changes):
        env = {key: value for key, value in os.environ.items() if not key.startswith(
            ('DJANGO_', 'DB_', 'RENDER', 'CORS_', 'CSRF_'))}
        env.update(RENDER='true', DJANGO_DEBUG='0', DJANGO_SECRET_KEY='test-only-' * 8,
                   DB_ENGINE='postgresql', DB_NAME='demo', DB_USER='demo',
                   DB_PASSWORD='test-only', DB_HOST='database.internal',
                   RENDER_EXTERNAL_HOSTNAME='demo-api.onrender.com',
                   CORS_ALLOWED_ORIGINS='https://demo.onrender.com',
                   CSRF_TRUSTED_ORIGINS='https://demo.onrender.com')
        env.update(changes)
        return subprocess.run([sys.executable, '-c',
            'from gravetrak_backend import settings as s; import json; '
            'print(json.dumps([s.ALLOWED_HOSTS, s.CORS_ALLOWED_ORIGINS, '
            's.CSRF_TRUSTED_ORIGINS, s.SECURE_PROXY_SSL_HEADER, str(s.MEDIA_ROOT)]))'],
            env=env, cwd=settings.BASE_DIR, capture_output=True, text=True)

    def test_render_host_origins_proxy_and_media_path(self):
        result = self.load_settings(DJANGO_MEDIA_ROOT='/var/data/media')
        self.assertEqual(result.returncode, 0, result.stderr)
        hosts, cors, csrf, proxy, media = json.loads(result.stdout)
        self.assertIn('demo-api.onrender.com', hosts)
        self.assertEqual(cors, ['https://demo.onrender.com'])
        self.assertEqual(csrf, cors)
        self.assertEqual(proxy, ['HTTP_X_FORWARDED_PROTO', 'https'])
        self.assertEqual(media.replace('\\', '/'), '/var/data/media')

    def test_render_rejects_unsafe_startup_settings(self):
        for changes in ({'DJANGO_SECRET_KEY': ''}, {'DJANGO_DEBUG': '1'},
                        {'DB_ENGINE': 'sqlite'}, {'DB_HOST': ''}):
            with self.subTest(changes=changes):
                self.assertNotEqual(self.load_settings(**changes).returncode, 0)


@override_settings(ALLOWED_HOSTS=['testserver'], CORS_ALLOWED_ORIGINS=['https://demo.onrender.com'])
class DeploymentHTTPTests(TestCase):
    def test_health_checks_database_without_disclosing_connection_details(self):
        self.assertEqual(self.client.get('/healthz/').json(), {'status': 'ok'})
        with patch('gravetrak_backend.urls.connection.cursor', side_effect=RuntimeError('private-details')):
            response = self.client.get('/healthz/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'status': 'unavailable'})

    def test_public_api_compression_and_cross_origin_access(self):
        response = self.client.get('/api/', HTTP_ACCEPT_ENCODING='gzip',
                                   HTTP_ORIGIN='https://demo.onrender.com')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Access-Control-Allow-Origin'], 'https://demo.onrender.com')
        self.assertEqual(response['Content-Encoding'], 'gzip')
        self.assertIn('burial-plots', json.loads(gzip.decompress(response.content)))
