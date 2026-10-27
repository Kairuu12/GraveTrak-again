from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import json

from django.test import SimpleTestCase, override_settings
from .email_templates import render_email, render_notification_email, TEXT_FOOTER
from .email_notifications import BrevoEmailProvider


class EmailTemplateTests(SimpleTestCase):
    def test_user_content_cannot_inject_html_or_links(self):
        html = render_email(title='<img src=x onerror=alert(1)>',
            message='<script>alert(1)</script>\nA & B\n\n<a href="https://example.com">Click</a>',
            name='<b>Owner</b>', reference='<iframe>')
        for tag in ('<script>', '<img', '<a href=', '<iframe>', '<b>Owner'):
            self.assertNotIn(tag, html)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn('A &amp; B', html)
        self.assertIn('&lt;b&gt;Owner&lt;/b&gt;', html)
        self.assertIn('<br>', html)

    def test_queued_message_and_subject_are_used_instead_of_current_notification_text(self):
        record = SimpleNamespace(subject='GraveTrak: Interview Scheduled',
            body='Your interview is on November 5 at 10:00 AM at CMO Office.' + TEXT_FOOTER,
            notification=SimpleNamespace(title='Changed title', message='Changed message',
                notification_type='interview_scheduled', application_id=1,
                application=SimpleNamespace(application_id='GT-2026-0001'),
                recipient=SimpleNamespace(first_name='Maria')))
        html = render_notification_email(record)
        self.assertIn('November 5 at 10:00 AM at CMO Office.', html)
        self.assertIn('GT-2026-0001', html)
        self.assertIn('Hello Maria,', html)
        self.assertNotIn('Changed title', html)
        self.assertNotIn('Changed message', html)
        self.assertNotIn('GraveTrak Notifications', html)

    def test_verification_code_is_readable_and_not_in_preheader(self):
        html = render_email(title='Verify your email address', message='Confirm your email.',
                            kind='verification', code='012345')
        self.assertIn('012345', html)
        self.assertIn('Expires in 10 minutes', html)
        self.assertIn('If you did not request it', html)
        preheader = html.split('<div style="display:none', 1)[1].split('</div>', 1)[0]
        self.assertNotIn('012345', preheader)
        self.assertNotIn('Manage your preferences', html)

    def test_no_external_assets_scripts_or_localhost_links(self):
        for kind in ('approved', 'documents_correction', 'verification', 'unknown'):
            html = render_email(title='Update', message='Details', kind=kind)
            for unwanted in ('<script', '<img', '<link', '<form', 'localhost', '127.0.0.1', 'src=', 'href='):
                self.assertNotIn(unwanted, html)
            self.assertIn('role="presentation"', html)
            self.assertIn('max-width:600px', html)

    @override_settings(BREVO_EMAIL_ENABLED=True, BREVO_API_KEY='test',
                       BREVO_SENDER_EMAIL='sender@example.test', BREVO_SENDER_NAME='GraveTrak')
    def test_one_provider_request_carries_both_html_and_plain_text(self):
        html = render_email(title='Verify', message='Confirm your email.', kind='verification', code='012345')
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"messageId":"mock-id"}'
        with patch('api.email_notifications.build_opener') as opener:
            opener.return_value.open.return_value = response
            result = BrevoEmailProvider().send(recipient='recipient@example.test', subject='Verify',
                body='Your code is 012345', html_body=html)
        opener.return_value.open.assert_called_once()
        payload = json.loads(opener.return_value.open.call_args.args[0].data)
        self.assertEqual(payload['htmlContent'], html)
        self.assertEqual(payload['textContent'], 'Your code is 012345')
        self.assertEqual(result, ('accepted', 'mock-id', ''))
