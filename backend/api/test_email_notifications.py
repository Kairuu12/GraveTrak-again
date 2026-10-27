from datetime import date
from io import BytesIO, StringIO
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError, URLError

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, SimpleTestCase, override_settings
from rest_framework.test import APITestCase

from .email_notifications import BrevoEmailProvider, EmailService
from .models import BurialApplication, EmailOutbox, Notification, UserProfile, EmailVerification
from django.utils import timezone
from .notifications import NotificationService

CONFIG = dict(BREVO_EMAIL_ENABLED=True, BREVO_API_KEY='test-secret',
              BREVO_SENDER_EMAIL='sender@example.com', BREVO_SENDER_NAME='GraveTrak', PHILSMS_ENABLED=False)


@override_settings(**CONFIG)
class EmailNotificationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('email-owner', email='owner@example.com')
        self.profile = UserProfile.objects.create(user=self.user)
        EmailVerification.objects.create(user=self.user, verified_email=self.user.email, verified_at=timezone.now())
        self.app = BurialApplication.objects.create(application_id='EMAIL-TEST', deceased_name='Test Person',
            deceased_date_of_death=date(2026, 1, 1), applicant_name='Test Applicant', submitted_by=self.user)

    def event(self, key='event-1'):
        return NotificationService.create(self.app, 'burial_scheduled', 'Burial scheduled', 'Please check your schedule.', key)

    def test_new_events_queue_once_and_never_send_during_application_request(self):
        with patch('api.email_notifications.BrevoEmailProvider.send') as send:
            notice = self.event()
            self.event()
            send.assert_not_called()
        self.assertEqual(EmailOutbox.objects.count(), 1)
        self.assertEqual(notice.email_outbox.status, 'pending')
        with patch('api.email_notifications.BrevoEmailProvider.send', return_value=('accepted', 'provider-1', '')) as send:
            EmailService.deliver(notice.email_outbox.pk)
            EmailService.deliver(notice.email_outbox.pk)
            send.assert_called_once()
        row = EmailOutbox.objects.get()
        self.assertEqual(row.status, 'accepted')
        notice.refresh_from_db()
        self.assertFalse(notice.sent)  # Accepted by provider is not confirmed delivery.

    def test_disabled_events_are_not_replayed_after_enabling(self):
        with override_settings(BREVO_EMAIL_ENABLED=False):
            self.event()
        with patch('api.email_notifications.BrevoEmailProvider.send') as send:
            call_command('send_pending_emails', stdout=StringIO())
            send.assert_not_called()
        self.assertEqual(EmailOutbox.objects.get().status, 'provider_not_configured')

    def test_worker_reports_blocked_events_and_actual_outcomes(self):
        with override_settings(BREVO_EMAIL_ENABLED=False):
            self.event('blocked')
        self.event('ready')
        output = StringIO()
        with patch('api.email_notifications.BrevoEmailProvider.send', return_value=('accepted', 'test-id', '')):
            call_command('send_pending_emails', stdout=output)
        self.assertIn('accepted=1', output.getvalue())
        self.assertIn('1 unattempted emails remain blocked', output.getvalue())

    def test_explicit_recovery_previews_then_queues_only_selected_unattempted_email(self):
        with override_settings(BREVO_EMAIL_ENABLED=False):
            row = self.event().email_outbox
            untouched = self.event('other').email_outbox
        call_command('requeue_unconfigured_emails', ids=[row.pk], stdout=StringIO())
        row.refresh_from_db()
        self.assertEqual(row.status, 'provider_not_configured')
        call_command('requeue_unconfigured_emails', ids=[row.pk], apply=True, stdout=StringIO())
        with patch('api.email_notifications.BrevoEmailProvider.send', return_value=('accepted', 'test-id', '')) as send:
            call_command('send_pending_emails', stdout=StringIO())
            call_command('send_pending_emails', stdout=StringIO())
            send.assert_called_once()
        untouched.refresh_from_db()
        self.assertEqual(untouched.status, 'provider_not_configured')

    def test_recovery_refuses_attempted_events_and_optouts_without_partial_updates(self):
        from django.utils import timezone
        with override_settings(BREVO_EMAIL_ENABLED=False):
            row = self.event().email_outbox
            other = self.event('other').email_outbox
        for changes in ({'status': 'failed'}, {'status': 'unknown'}, {'status': 'accepted'},
                        {'status': 'processing'}, {'attempted_at': timezone.now()},
                        {'provider_message_id': 'existing'}, {'recipient_email': 'changed@example.com'}):
            EmailOutbox.objects.filter(pk=other.pk).update(**changes)
            with self.assertRaises(CommandError):
                call_command('requeue_unconfigured_emails', ids=[row.pk, other.pk], apply=True, stdout=StringIO())
            row.refresh_from_db()
            self.assertEqual(row.status, 'provider_not_configured')
            EmailOutbox.objects.filter(pk=other.pk).update(status='provider_not_configured', attempted_at=None,
                provider_message_id='', recipient_email=self.user.email)
        self.profile.preferences = {'email_notifications': False}
        self.profile.save()
        with self.assertRaises(CommandError):
            call_command('requeue_unconfigured_emails', ids=[row.pk], apply=True, stdout=StringIO())

    def test_optout_and_changed_address_checked_before_sending(self):
        row = self.event().email_outbox
        self.profile.preferences = {'email_notifications': False}; self.profile.save()
        with patch('api.email_notifications.BrevoEmailProvider.send') as send:
            EmailService.deliver(row.pk)
            send.assert_not_called()
        row.refresh_from_db(); self.assertEqual(row.status, 'opted_out')
        self.profile.preferences = {}; self.profile.save()
        row = self.event('event-2').email_outbox
        self.user.email = 'changed@example.com'; self.user.save()
        EmailService.deliver(row.pk)
        row.refresh_from_db(); self.assertEqual(row.status, 'invalid_recipient')

    def test_failed_and_unknown_are_not_automatically_retried(self):
        for state in ('failed', 'unknown'):
            row = self.event(state).email_outbox
            with patch('api.email_notifications.BrevoEmailProvider.send', return_value=(state, '', 'Check provider')) as send:
                EmailService.deliver(row.pk); EmailService.deliver(row.pk)
                send.assert_called_once()

    def test_transaction_rollback_and_historical_notices_create_no_sendable_email(self):
        from django.db import transaction
        with self.assertRaises(ValueError):
            with transaction.atomic():
                self.event()
                raise ValueError('rollback')
        self.assertEqual(EmailOutbox.objects.count(), 0)
        Notification.objects.create(recipient=self.user, application=self.app, event_key='old',
                                    notification_type='system_alert', title='Old', message='Old')
        self.event('old')
        self.assertEqual(EmailOutbox.objects.count(), 0)


@override_settings(**CONFIG)
class BrevoTransportTests(SimpleTestCase):
    def test_unauthorized_ip_is_actionable_without_logging_response_details(self):
        error = HTTPError('url', 401, 'Unauthorized', {},
            BytesIO(b'{"code":"unauthorized","message":"Unrecognised IP address 192.0.2.1 secret"}'))
        with patch('api.email_notifications.build_opener') as opener:
            opener.return_value.open.side_effect = error
            state, uid, message = BrevoEmailProvider().send(recipient='owner@example.com', subject='Test', body='Test')
        self.assertEqual((state, uid), ('failed', ''))
        self.assertIn('Authorized IPs', message)
        self.assertNotIn('192.0.2.1', message)
        self.assertNotIn('secret', message)

    def test_invalid_key_and_malformed_auth_errors_are_sanitized(self):
        for body in (b'{"message":"Key not found secret"}', b'not json secret', b'[]'):
            error = HTTPError('url', 401, 'Unauthorized', {}, BytesIO(body))
            with patch('api.email_notifications.build_opener') as opener:
                opener.return_value.open.side_effect = error
                state, _, message = BrevoEmailProvider().send(recipient='owner@example.com', subject='Test', body='Test')
            self.assertEqual(state, 'failed')
            self.assertIn('API authentication rejected', message)
            self.assertNotIn('secret', message)

    def test_payload_and_acceptance(self):
        import json
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"messageId":"message-1"}'
        with patch('api.email_notifications.build_opener') as opener:
            opener.return_value.open.return_value = response
            result = BrevoEmailProvider().send(recipient='owner@example.com', subject='Test', body='Test body')
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, 'https://api.brevo.com/v3/smtp/email')
            self.assertEqual(json.loads(request.data)['to'], [{'email': 'owner@example.com'}])
            self.assertEqual(json.loads(request.data)['textContent'], 'Test body')
            self.assertIn('Test body', json.loads(request.data)['htmlContent'])
            self.assertIn('GraveTrak', json.loads(request.data)['htmlContent'])
            self.assertEqual(result, ('accepted', 'message-1', ''))

    def test_errors_are_sanitized_and_ambiguous_responses_not_called_sent(self):
        for error, status in [(HTTPError('url', 429, 'secret', {}, BytesIO()), 'failed'),
                              (HTTPError('url', 500, 'secret', {}, BytesIO()), 'unknown'),
                              (URLError('secret'), 'unknown')]:
            with patch('api.email_notifications.build_opener') as opener:
                opener.return_value.open.side_effect = error
                result = BrevoEmailProvider().send(recipient='owner@example.com', subject='Test', body='Test')
                self.assertEqual(result[0], status)
                self.assertNotIn('secret', result[2])


@override_settings(**CONFIG, STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
})
class EmailWorkflowTests(APITestCase):
    """Exercise real workflow entry points through the outbox worker."""

    def setUp(self):
        self.owner = get_user_model().objects.create_user('workflow-owner', email='owner@example.com')
        self.reviewer = get_user_model().objects.create_user('workflow-reviewer', email='reviewer@example.com')
        UserProfile.objects.create(user=self.owner)
        EmailVerification.objects.create(user=self.owner, verified_email=self.owner.email, verified_at=timezone.now())
        UserProfile.objects.create(user=self.reviewer, role='mayor')
        self.app = BurialApplication.objects.create(
            application_id='EMAIL-WORKFLOW', deceased_name='Test Person',
            deceased_date_of_death=date(2026, 1, 1), applicant_name='Test Applicant',
            submitted_by=self.owner)
        self.client.force_authenticate(self.reviewer)

    def submission_payload(self):
        from .models import BurialDocument
        payload = dict(deceased_name='Test Person', deceased_date_of_birth='1950-01-01',
            place_of_birth='Test City', deceased_date_of_death='2026-01-01', deceased_gender='M',
            applicant_name='Test Applicant', applicant_relationship='child',
            applicant_contact_email='different-contact@example.com', applicant_contact_phone='09123456789',
            applicant_address='Test address', funeral_home='Test Funeral Home', client_age=30,
            client_gender='F', client_civil_status='Single', client_educational_attainment='College',
            client_occupation='Employee', client_income='10000', client_address='Test address')
        for kind in BurialDocument.required_document_types():
            payload[kind] = SimpleUploadedFile(kind + '.pdf', b'%PDF test', content_type='application/pdf')
        return payload

    def test_real_submission_queues_receipt_for_account_email_and_worker_sends_once(self):
        self.client.force_authenticate(self.owner)
        with patch('api.email_notifications.BrevoEmailProvider.send') as send:
            result = self.client.post('/api/burial-applications/', self.submission_payload(), format='multipart')
            self.assertEqual(result.status_code, 201, result.data)
            send.assert_not_called()
        row = EmailOutbox.objects.get(notification__notification_type='application_received')
        self.assertEqual(row.recipient_email, self.owner.email)
        self.assertEqual(row.status, 'pending')
        self.assertEqual(row.notification.application.documents.count(), 6)
        with patch('api.email_notifications.BrevoEmailProvider.send', return_value=('accepted', 'receipt-id', '')) as send:
            call_command('send_pending_emails', stdout=StringIO())
            call_command('send_pending_emails', stdout=StringIO())
            send.assert_called_once()

    def test_submission_rolls_back_when_notification_cannot_be_saved(self):
        self.client.force_authenticate(self.owner)
        before = BurialApplication.objects.count()
        with patch('api.email_notifications.EmailService.prepare', side_effect=RuntimeError('storage unavailable')):
            with self.assertRaises(RuntimeError):
                self.client.post('/api/burial-applications/', self.submission_payload(), format='multipart')
        self.assertEqual(BurialApplication.objects.count(), before)
        self.assertFalse(Notification.objects.exists())

    def test_mayor_approve_and_assign_queues_one_approval_email(self):
        from .models import BurialDocument, ColumbariumSlot
        BurialApplication.objects.filter(pk=self.app.pk).update(status='for_interview')
        for kind in BurialDocument.required_document_types():
            BurialDocument.objects.create(application=self.app, document_type=kind,
                document_file=SimpleUploadedFile(kind + '.pdf', b'%PDF test'), verification_status='complete')
        slot = ColumbariumSlot.objects.create(id='EMAIL-NICHE', section='Section A', cemetery_map='old', floor=1, col=99)
        with patch('api.email_notifications.BrevoEmailProvider.send') as send:
            for _ in range(2):
                result = self.client.post(f'/api/burial-applications/{self.app.pk}/approve-and-assign/',
                    {'type': 'columbarium', 'target_id': slot.pk}, format='json')
                self.assertEqual(result.status_code, 200, result.data)
            send.assert_not_called()
        row = EmailOutbox.objects.get(notification__notification_type='approved')
        self.assertEqual(row.status, 'pending')
        self.assertEqual(row.recipient_email, self.owner.email)
        with patch('api.email_notifications.BrevoEmailProvider.send', return_value=('accepted', 'approval-id', '')) as send:
            call_command('send_pending_emails', stdout=StringIO())
            call_command('send_pending_emails', stdout=StringIO())
            send.assert_called_once()

    def test_status_notifications_reach_worker_once_and_use_account_email(self):
        from .workflow import NotificationEngine
        with patch('api.email_notifications.BrevoEmailProvider.send') as send:
            for status in ('pending_review', 'action_required', 'scheduled', 'completed'):
                NotificationEngine.send_status_notification(self.app, status)
                NotificationEngine.send_status_notification(self.app, status)
            send.assert_not_called()
        self.assertEqual(EmailOutbox.objects.filter(status='pending').count(), 4)
        with patch('api.email_notifications.BrevoEmailProvider.send', return_value=('accepted', 'test-id', '')) as send:
            call_command('send_pending_emails', stdout=StringIO())
            call_command('send_pending_emails', stdout=StringIO())
        self.assertEqual(send.call_count, 4)
        self.assertTrue(all(call.kwargs['recipient'] == self.owner.email for call in send.call_args_list))
        self.assertEqual(EmailOutbox.objects.filter(status='accepted').count(), 4)

    def test_approval_and_rejection_api_queue_one_email_per_transition(self):
        from .models import BurialDocument
        for kind in BurialDocument.required_document_types():
            BurialDocument.objects.create(application=self.app, document_type=kind,
                document_file=SimpleUploadedFile(kind + '.pdf', b'%PDF test'), verification_status='complete')
        with patch('api.email_notifications.BrevoEmailProvider.send') as send:
            for status, endpoint in (('approved', 'approve'), ('rejected', 'reject')):
                BurialApplication.objects.filter(pk=self.app.pk).update(status='slot_assigned')
                for _ in range(2):
                    response = self.client.post(f'/api/burial-applications/{self.app.pk}/{endpoint}/',
                                                {'reason': 'Private review reason'}, format='json')
                    self.assertEqual(response.status_code, 200, response.data)
                row = EmailOutbox.objects.get(notification__notification_type=status)
                self.assertEqual(row.status, 'pending')
                self.assertEqual(row.recipient_email, self.owner.email)
                self.assertNotIn('Private review reason', row.body)
            send.assert_not_called()
        self.assertEqual(EmailOutbox.objects.count(), 2)

    def test_interview_schedule_and_reschedule_queue_correct_details(self):
        from datetime import timedelta
        from django.utils import timezone
        from .models import BurialDocument
        for kind in BurialDocument.required_document_types():
            BurialDocument.objects.create(application=self.app, document_type=kind,
                document_file=SimpleUploadedFile(kind + '.pdf', b'%PDF test'), verification_status='complete')
        base = f'/api/burial-applications/{self.app.pk}/'
        self.assertEqual(self.client.post(base + 'complete-document-review/').status_code, 200)
        day = timezone.localdate() + timedelta(days=2)
        while day.weekday() == 6:
            day += timedelta(days=1)
        payload = {'scheduled_date': str(day), 'scheduled_time': '10:00:00',
                   'duration_minutes': 30, 'location': 'CMO Office'}
        with patch('api.email_notifications.BrevoEmailProvider.send') as send:
            result = self.client.post(base + 'schedule-interview/', payload, format='json')
            self.assertEqual(result.status_code, 200, result.data)
            row = EmailOutbox.objects.get(notification__notification_type='interview_scheduled')
            self.assertIn('CMO Office', row.body)
            payload['location'] = 'Updated Office'
            url = f'/api/interview-schedules/{result.data["schedule_id"]}/reschedule/'
            for _ in range(2):
                result = self.client.post(url, payload, format='json')
                self.assertEqual(result.status_code, 200, result.data)
            row = EmailOutbox.objects.get(notification__notification_type='interview_rescheduled')
            self.assertIn('Updated Office', row.body)
            self.assertEqual(row.status, 'pending')
            send.assert_not_called()
        self.assertEqual(EmailOutbox.objects.count(), 2)
