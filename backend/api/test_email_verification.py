from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .email_notifications import EmailService
from .email_verification import is_email_verified
from .models import BurialApplication, EmailOutbox, EmailVerification, UserProfile
from .notifications import NotificationService


@override_settings(BREVO_EMAIL_ENABLED=True, BREVO_API_KEY='test-key',
    BREVO_SENDER_EMAIL='sender@example.com', BREVO_SENDER_NAME='GraveTrak', PHILSMS_ENABLED=False,
    PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class EmailVerificationTests(APITestCase):
    request_url = '/api/profile/email-verification/request/'
    confirm_url = '/api/profile/email-verification/confirm/'

    def setUp(self):
        self.user = get_user_model().objects.create_user('owner@example.com', email='owner@example.com', first_name='Owner')
        UserProfile.objects.create(user=self.user)
        self.other = get_user_model().objects.create_user('other@example.com', email='other@example.com', first_name='Other')
        UserProfile.objects.create(user=self.other)
        self.client.force_authenticate(self.user)
        self.send = patch('api.email_notifications.BrevoEmailProvider.send', return_value=('accepted', 'test-id', '')).start()
        self.addCleanup(patch.stopall)
        self.random = patch('api.email_verification.secrets.randbelow', return_value=123456).start()

    def request_code(self):
        return self.client.post(self.request_url, {}, format='json')

    def confirm(self, code='123456'):
        return self.client.post(self.confirm_url, {'code': code}, format='json')

    def verify(self):
        result = self.request_code()
        self.assertEqual(result.status_code, 200, result.data)
        result = self.confirm()
        self.assertEqual(result.status_code, 200, result.data)

    def event(self, key):
        app, _ = BurialApplication.objects.get_or_create(application_id='VERIFY-APP', defaults={
            'submitted_by': self.user, 'deceased_name': 'Test',
            'deceased_date_of_death': date(2026, 1, 1), 'applicant_name': 'Test'})
        return NotificationService.create(app, 'approved', 'Approved', 'Application update', key).email_outbox

    def test_existing_and_new_users_are_unverified_without_automatic_email(self):
        response = self.client.get('/api/profile/')
        self.assertFalse(response.data['email_verification']['verified'])
        self.assertTrue(response.data['notification_channels']['email_available'])
        self.client.force_authenticate(None)
        response = self.client.post('/api/register/', {'email': 'NEW@example.com', 'password': 'Strong-test-password1!'}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['user']['email'], 'new@example.com')
        self.assertFalse(response.data['user']['email_verification']['verified'])
        self.send.assert_not_called()

    def test_code_is_hashed_bound_to_account_and_verified_only_by_confirmation(self):
        result = self.request_code()
        self.assertEqual(result.status_code, 200, result.data)
        record = EmailVerification.objects.get(user=self.user)
        self.assertNotEqual(record.code_hash, '123456')
        self.assertTrue(check_password('123456', record.code_hash))
        self.assertNotIn('123456', str(result.data))
        self.assertNotIn('code_hash', str(self.client.get('/api/profile/').data))
        self.assertFalse(is_email_verified(self.user))
        self.send.assert_called_once()
        self.assertEqual(self.send.call_args.kwargs['recipient'], self.user.email)
        self.assertIn('123456', self.send.call_args.kwargs['body'])
        self.assertIn('123456', self.send.call_args.kwargs['html_body'])
        self.assertIn('EMAIL VERIFICATION', self.send.call_args.kwargs['html_body'])
        result = self.confirm()
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data['user']['email_verification']['verified'])
        self.assertTrue(is_email_verified(self.user))
        self.assertEqual(self.confirm().status_code, 400)  # Single use.

    def test_unverified_email_never_reaches_workflow_provider_and_history_is_not_replayed(self):
        row = self.event('before')
        self.assertEqual(row.status, 'unverified_recipient')
        EmailService.deliver(row.pk)
        self.send.assert_not_called()
        self.verify()
        self.send.reset_mock()
        EmailService.deliver(row.pk)
        self.send.assert_not_called()
        row = self.event('after')
        self.assertEqual(row.status, 'pending')
        EmailService.deliver(row.pk)
        EmailService.deliver(row.pk)
        self.send.assert_called_once()

    def test_worker_rechecks_verification_before_sending_a_previously_pending_email(self):
        self.verify()
        row = self.event('pending')
        EmailVerification.objects.filter(user=self.user).update(verified_at=None)
        self.send.reset_mock()
        EmailService.deliver(row.pk)
        self.send.assert_not_called()
        row.refresh_from_db()
        self.assertEqual(row.status, 'unverified_recipient')

    def test_resend_cooldown_survives_profile_refresh_and_email_change(self):
        self.request_code()
        self.assertEqual(self.request_code().status_code, 429)
        self.client.patch('/api/profile/', {'email': 'changed@example.com'}, format='json')
        result = self.request_code()
        self.assertEqual(result.status_code, 429)
        self.assertGreater(int(result['Retry-After']), 0)
        self.send.assert_called_once()

    def test_five_requests_per_day_and_new_window_resets_budget(self):
        for index in range(5):
            if index:
                EmailVerification.objects.filter(user=self.user).update(requested_at=timezone.now() - timedelta(seconds=61))
            self.assertEqual(self.request_code().status_code, 200)
        EmailVerification.objects.filter(user=self.user).update(requested_at=timezone.now() - timedelta(seconds=61))
        self.assertEqual(self.request_code().status_code, 429)
        self.assertEqual(self.send.call_count, 5)
        EmailVerification.objects.filter(user=self.user).update(window_started_at=timezone.now() - timedelta(hours=25))
        self.assertEqual(self.request_code().status_code, 200)
        self.assertEqual(EmailVerification.objects.get(user=self.user).send_count, 1)

    def test_resend_replaces_old_code(self):
        self.request_code()
        EmailVerification.objects.filter(user=self.user).update(requested_at=timezone.now() - timedelta(seconds=61))
        self.random.return_value = 654321
        self.assertEqual(self.request_code().status_code, 200)
        self.assertEqual(self.confirm('123456').status_code, 400)
        self.assertEqual(self.confirm('654321').status_code, 200)

    def test_expired_code_and_five_bad_attempts_cannot_verify(self):
        self.request_code()
        for _ in range(5):
            self.assertEqual(self.confirm('999999').status_code, 400)
        self.assertEqual(self.confirm().status_code, 400)
        self.assertFalse(is_email_verified(self.user))
        EmailVerification.objects.filter(user=self.user).update(requested_at=timezone.now() - timedelta(seconds=61))
        self.request_code()
        EmailVerification.objects.filter(user=self.user).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.confirm().status_code, 400)

    def test_email_change_invalidates_verification_and_old_codes_even_if_changed_back(self):
        self.verify()
        for address in ('changed@example.com', 'owner@example.com'):
            response = self.client.patch('/api/profile/', {'email': address}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            self.assertFalse(response.data['email_verification']['verified'])
        self.assertEqual(self.confirm().status_code, 400)
        self.assertEqual(EmailVerification.objects.get(user=self.user).send_count, 1)

    def test_staff_email_change_also_revokes_verification(self):
        self.verify()
        UserProfile.objects.filter(user=self.other).update(role='mayor')
        self.other.refresh_from_db()
        self.client.force_authenticate(self.other)
        response = self.client.patch(f'/api/users/{self.user.pk}/', {'email': 'staff-changed@example.com'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['email_verification']['verified'])

    def test_same_email_and_name_edit_preserve_verification(self):
        self.verify()
        response = self.client.patch('/api/profile/', {'email': 'OWNER@example.com', 'first_name': 'New name'}, format='json')
        self.assertTrue(response.data['email_verification']['verified'])

    def test_no_cross_account_or_client_supplied_verification(self):
        self.request_code()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.confirm().status_code, 400)
        self.assertEqual(self.client.post(self.request_url, {'email': self.user.email}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.confirm_url, {'code': '123456', 'user_id': self.user.pk}, format='json').status_code, 400)
        self.assertEqual(self.client.patch('/api/profile/', {'email_verification': {'verified': True}}, format='json').status_code, 400)
        self.assertFalse(is_email_verified(self.other))

    def test_authentication_and_six_ascii_digits_required(self):
        for code in ('12345', '1234567', 'abcdef', '１２３４５６'):
            self.assertEqual(self.confirm(code).status_code, 400)
        self.client.force_authenticate(None)
        self.assertEqual(self.request_code().status_code, 401)
        self.assertEqual(self.confirm().status_code, 401)

    def test_disabled_provider_does_not_spend_request_budget(self):
        with override_settings(BREVO_EMAIL_ENABLED=False):
            self.assertEqual(self.request_code().status_code, 503)
        self.assertFalse(EmailVerification.objects.exists())
        self.send.assert_not_called()

    def test_failed_and_ambiguous_sends_do_not_verify_or_bypass_cooldown(self):
        for state in ('failed', 'unknown'):
            EmailVerification.objects.all().delete()
            self.send.return_value = (state, '', 'provider error')
            self.assertEqual(self.request_code().status_code, 503)
            self.assertEqual(self.request_code().status_code, 429)
            self.assertFalse(is_email_verified(self.user))
            self.assertEqual(EmailVerification.objects.get(user=self.user).send_count, 1)
            self.assertEqual(self.confirm().status_code, 400 if state == 'failed' else 200)

    def test_verification_is_allowed_when_optional_notifications_are_off(self):
        UserProfile.objects.filter(user=self.user).update(preferences={'email_notifications': False})
        self.user.refresh_from_db()
        self.verify()
        self.assertEqual(self.event('opted-out').status, 'opted_out')

    def test_inflight_send_has_already_reserved_cooldown(self):
        def provider(**kwargs):
            self.assertEqual(self.request_code().status_code, 429)
            return 'accepted', 'test-id', ''
        self.send.side_effect = provider
        self.assertEqual(self.request_code().status_code, 200)
        self.assertEqual(self.send.call_count, 1)

    def test_registration_rejects_case_variant_of_existing_address(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post('/api/register/', {'email': 'OWNER@example.com', 'password': 'safe-pass'}, format='json').status_code, 400)
