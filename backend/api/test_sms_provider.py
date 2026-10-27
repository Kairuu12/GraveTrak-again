import json
from io import StringIO
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import BurialApplication, SmsOutbox, UserProfile
from .notifications import NotificationService, SmsService
from .sms_provider import PhilSmsProvider, sms_available


CONFIG = dict(PHILSMS_ENABLED=True, PHILSMS_API_TOKEN='test-secret',
              PHILSMS_SENDER_ID='PhilSMS', PHILSMS_BASE_URL='https://dashboard.philsms.com/api/v3')


@override_settings(**CONFIG)
class PhilSmsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('sms-test')
        self.profile = UserProfile.objects.create(user=self.user, contact_number='09123456789',
                                                  preferences={'sms_notifications': True})
        self.app = BurialApplication.objects.create(application_id='SMS-TEST', deceased_name='Test',
            deceased_date_of_death=timezone.localdate(), applicant_name='Test', applicant_relationship='other',
            applicant_contact_email='test@example.test', applicant_contact_phone='09999999999',
            applicant_address='Test', submitted_by=self.user)

    def event(self, key='sms:1'):
        return NotificationService.create(self.app, 'approved', 'Update', 'In-app update', key, 'GraveTrak: Update')

    @patch('api.notifications.PhilSmsProvider.send', return_value=('accepted', 'uid-123', ''))
    def test_committed_event_submits_once_and_acceptance_is_not_delivery(self, send):
        with self.captureOnCommitCallbacks(execute=True):
            self.event()
            send.assert_not_called()
            self.event()
        row = SmsOutbox.objects.get()
        self.assertEqual(row.status, 'accepted')
        self.assertEqual(row.provider_message_id, 'uid-123')
        self.assertIsNone(row.sent_at)
        SmsService.deliver(row.pk)
        send.assert_called_once_with(recipient='+639123456789', message='GraveTrak: Update', idempotency_key='sms:1')

    @patch('api.notifications.PhilSmsProvider.send')
    def test_rollback_does_not_send(self, send):
        with self.captureOnCommitCallbacks(execute=True):
            with self.assertRaises(ValueError):
                with transaction.atomic():
                    self.event()
                    raise ValueError('rollback')
        send.assert_not_called()
        self.assertFalse(SmsOutbox.objects.exists())

    @patch('api.notifications.PhilSmsProvider.send')
    def test_disabled_history_never_replayed(self, send):
        with override_settings(PHILSMS_ENABLED=False):
            self.event()
        row = SmsOutbox.objects.get()
        SmsService.deliver(row.pk)
        call_command('send_pending_sms', stdout=StringIO())
        send.assert_not_called()
        row.refresh_from_db()
        self.assertEqual(row.status, 'provider_not_configured')

    @patch('api.notifications.PhilSmsProvider.send')
    def test_opted_out_and_invalid_numbers_never_send(self, send):
        self.profile.preferences = {'sms_notifications': False}
        self.profile.save()
        with self.captureOnCommitCallbacks(execute=True):
            self.event()
        self.assertEqual(SmsOutbox.objects.get().status, 'opted_out')
        self.profile.contact_number = 'invalid'
        self.profile.save()
        self.event('sms:2')
        self.assertEqual(SmsOutbox.objects.get(event_key='sms:2').status, 'invalid_recipient')
        send.assert_not_called()

    @patch('api.notifications.PhilSmsProvider.send')
    def test_rechecks_opt_out_before_sending(self, send):
        self.event()
        self.profile.preferences = {'sms_notifications': False}
        self.profile.save()
        SmsService.deliver(SmsOutbox.objects.get().pk)
        self.assertEqual(SmsOutbox.objects.get().status, 'opted_out')
        send.assert_not_called()

    @patch('api.notifications.PhilSmsProvider.send')
    def test_number_change_stops_queued_send(self, send):
        self.event()
        self.profile.contact_number = '09999999999'
        self.profile.save()
        SmsService.deliver(SmsOutbox.objects.get().pk)
        self.assertEqual(SmsOutbox.objects.get().status, 'invalid_recipient')
        send.assert_not_called()

    @patch('api.notifications.PhilSmsProvider.send', side_effect=RuntimeError('secret response'))
    def test_provider_failure_preserves_notification_without_retry(self, send):
        with self.captureOnCommitCallbacks(execute=True):
            notification = self.event()
        row = SmsOutbox.objects.get()
        self.assertEqual(row.status, 'unknown')
        self.assertNotIn('secret', row.error_message)
        self.assertEqual(row.notification_id, notification.pk)
        call_command('send_pending_sms', stdout=StringIO())
        send.assert_called_once()

    @patch('api.notifications.PhilSmsProvider.send', return_value=('accepted', '', ''))
    def test_recovery_command_processes_only_eligible_pending(self, send):
        self.event()
        call_command('send_pending_sms', stdout=StringIO())
        call_command('send_pending_sms', stdout=StringIO())
        send.assert_called_once()

    def test_settings_expose_availability_and_allow_opt_in(self):
        client = APIClient()
        client.force_authenticate(self.user)
        response = client.get('/api/profile/')
        self.assertTrue(response.data['notification_channels']['sms_available'])
        self.assertNotIn('test-secret', str(response.data))
        response = client.patch('/api/profile/preferences/', {'sms_notifications': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    @patch('api.sms_provider.build_opener')
    def test_transport_payload_and_response(self, opener):
        opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'{"status":"success","data":{"uid":"123"}}'
        self.assertEqual(PhilSmsProvider().send(recipient='+639123456789', message='Test', idempotency_key='k'), ('accepted', '123', ''))
        args, kwargs = opener.return_value.open.call_args
        request = args[0]
        self.assertEqual(request.full_url, CONFIG['PHILSMS_BASE_URL'] + '/sms/send')
        self.assertEqual(request.get_header('Authorization'), 'Bearer test-secret')
        self.assertEqual(json.loads(request.data), {'recipient': '639123456789', 'sender_id': 'PhilSMS', 'type': 'plain', 'message': 'Test'})
        self.assertEqual(kwargs['timeout'], 10)

    @patch('api.sms_provider.build_opener')
    def test_unicode_and_error_responses(self, opener):
        response = opener.return_value.open.return_value.__enter__.return_value
        for payload, status in [(b'{"status":"error","message":"test-secret"}', 'failed'),
                                (b'not json', 'unknown'), (b'{}', 'unknown'),
                                (b'{"status":"success","data":[]}', 'accepted')]:
            response.read.return_value = payload
            result = PhilSmsProvider().send(recipient='+639123456789', message='Ma\u00f1ana', idempotency_key='k')
            self.assertEqual(result[0], status)
            self.assertNotIn('test-secret', result[2])
            self.assertEqual(json.loads(opener.return_value.open.call_args.args[0].data)['type'], 'unicode')

    @patch('api.sms_provider.build_opener')
    def test_http_and_network_failures(self, opener):
        for error, status in [(HTTPError('url', 401, 'secret', {}, None), 'failed'),
                              (HTTPError('url', 500, 'secret', {}, None), 'unknown'),
                              (URLError('secret'), 'unknown'), (TimeoutError(), 'unknown')]:
            opener.return_value.open.side_effect = error
            result = PhilSmsProvider().send(recipient='+639123456789', message='Test', idempotency_key='k')
            self.assertEqual(result[0], status)
            self.assertNotIn('secret', result[2])

    def test_configuration_requires_explicit_enable_token_sender_and_official_host(self):
        for config in [dict(PHILSMS_ENABLED=False), dict(PHILSMS_API_TOKEN=''),
                       dict(PHILSMS_SENDER_ID=''), dict(PHILSMS_BASE_URL='http://example.com')]:
            with override_settings(**config):
                self.assertFalse(sms_available())
