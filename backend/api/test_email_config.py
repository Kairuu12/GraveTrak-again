from pathlib import Path
from tempfile import TemporaryDirectory
from django.test import SimpleTestCase
from unittest.mock import Mock
from django.conf import settings
from gravetrak_backend.email_config import email_settings, load_email_config, watch_email_config


class EmailConfigTests(SimpleTestCase):
    def test_file_rotation_does_not_leave_stale_values_in_child_environment(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / '.env.email'
            env = {}
            path.write_text('BREVO_API_KEY=old-key\nBREVO_EMAIL_ENABLED=0', encoding='utf-8')
            self.assertEqual(email_settings(path, env)['BREVO_API_KEY'], 'old-key')
            self.assertEqual(env, {})
            path.write_text('BREVO_API_KEY=new-key\nBREVO_EMAIL_ENABLED=1', encoding='utf-8')
            updated = email_settings(path, env)
            self.assertEqual(updated['BREVO_API_KEY'], 'new-key')
            self.assertEqual(updated['BREVO_EMAIL_ENABLED'], '1')
            self.assertEqual(email_settings(path, {'BREVO_API_KEY': 'hosting-key'})['BREVO_API_KEY'], 'hosting-key')

    def test_local_email_file_is_watched_for_dev_server_restart(self):
        reloader = Mock(extra_files=set())
        watch_email_config(reloader)
        self.assertIn(settings.BASE_DIR / '.env.email', reloader.extra_files)

    def test_loads_private_settings_without_overriding_environment(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / '.env.email'
            path.write_text('\ufeff# comment\nBREVO_API_KEY="test-key"\nBREVO_EMAIL_ENABLED=0\nBREVO_SENDER_NAME=GraveTrak\nSECRET_KEY=ignored\n', encoding='utf-8')
            env = {'BREVO_EMAIL_ENABLED': '1'}
            load_email_config(path, env)
            self.assertEqual(env, {'BREVO_API_KEY': 'test-key', 'BREVO_EMAIL_ENABLED': '1', 'BREVO_SENDER_NAME': 'GraveTrak'})

    def test_missing_file_and_values_are_never_executed(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / '.env.email'
            env = {}
            load_email_config(path, env)
            self.assertEqual(env, {})
            path.write_text("BREVO_API_KEY=$(not-a-command)\nBREVO_SENDER_EMAIL='test@example.com'", encoding='utf-8')
            load_email_config(path, env)
            self.assertEqual(env['BREVO_API_KEY'], '$(not-a-command)')
            self.assertEqual(env['BREVO_SENDER_EMAIL'], 'test@example.com')
