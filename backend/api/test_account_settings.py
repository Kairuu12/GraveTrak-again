from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import BurialApplication, Notification, SmsOutbox, UserProfile
from .notifications import NotificationService

User = get_user_model()


@override_settings(PHILSMS_ENABLED=False)
class AccountSettingsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='account@example.test', email='account@example.test',
            first_name='Maria M.', last_name='Reyes Jr.', password='Original-Secure-Pass23!')
        self.profile = UserProfile.objects.create(user=self.user, contact_number='09123456789')
        self.other = User.objects.create_user(username='other@example.test', email='other@example.test', password='Other-Secure-Pass23!')
        UserProfile.objects.create(user=self.other, preferences={'theme': 'dark'})
        self.token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + self.token.key)

    def test_profile_loads_actual_values_without_secrets(self):
        response = self.client.get('/api/profile/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['first_name'], 'Maria M.')
        self.assertEqual(response.data['contact_number'], '09123456789')
        self.assertNotIn('password', response.data)
        self.assertFalse(response.data['notification_channels']['sms_available'])
        self.assertEqual(response.data['notification_channels']['sms_destination'], '0912*****89')
        self.assertFalse(response.data['preferences_initialized'])

    def test_profile_edit_preserves_name_parts_and_email_login(self):
        response = self.client.patch('/api/profile/', {'first_name': '  Maria M.  ', 'last_name': ' Santos Jr. ',
            'email': ' New-Account@example.test ', 'contact_number': '+63 912 345-6789'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['first_name'], 'Maria M.')
        self.assertEqual(response.data['last_name'], 'Santos Jr.')
        self.assertEqual(response.data['contact_number'], '09123456789')
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, self.user.username)
        self.assertEqual(self.user.username, 'new-account@example.test')
        self.client.credentials()
        self.assertEqual(self.client.post('/api/login/', {'email': self.user.username, 'password': 'Original-Secure-Pass23!'}).status_code, 200)

    def test_profile_validation(self):
        for patch, field in [({'email': 'bad'}, 'email'), ({'email': ''}, 'email'),
                             ({'email': 'OTHER@example.test'}, 'email'),
                             ({'contact_number': '1234'}, 'contact_number'),
                             ({'contact_number': ''}, 'contact_number'),
                             ({'first_name': ' ', 'last_name': ' '}, 'first_name')]:
            result = self.client.patch('/api/profile/', patch, format='json')
            self.assertEqual(result.status_code, 400, result.data)
            self.assertIn(field, result.data)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, 'account@example.test')

    def test_supported_phone_formats_reuse_existing_profile_column(self):
        for number in ('09123456789', '9123456789', '+639123456789', '639123456789'):
            response = self.client.patch('/api/profile/', {'contact_number': number}, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['contact_number'], '09123456789')
        self.assertEqual(UserProfile.objects.filter(user=self.user).count(), 1)

    def test_preference_patch_persists_and_preserves_other_choices(self):
        response = self.client.patch('/api/profile/preferences/', {'theme': 'system', 'text_size': 'large', 'high_contrast': True}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['preferences']['theme'], 'system')
        self.client.patch('/api/profile/preferences/', {'email_notifications': False, 'cemetery_announcements': False}, format='json')
        result = self.client.get('/api/profile/').data
        self.assertTrue(result['preferences_initialized'])
        self.assertEqual(result['preferences']['theme'], 'system')
        self.assertEqual(result['preferences']['text_size'], 'large')
        self.assertTrue(result['preferences']['high_contrast'])
        self.assertFalse(result['preferences']['email_notifications'])
        self.assertFalse(result['preferences']['cemetery_announcements'])
        self.assertEqual(self.client.get('/api/profile/preferences/').data['preferences'], result['preferences'])

    def test_preferences_survive_logout_login(self):
        self.client.patch('/api/profile/preferences/', {'theme': 'dark'}, format='json')
        self.assertEqual(self.client.post('/api/logout/').status_code, 200)
        self.client.credentials()
        session = self.client.post('/api/login/', {'email': self.user.username, 'password': 'Original-Secure-Pass23!'}).data
        self.assertEqual(session['user']['preferences']['theme'], 'dark')
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + session['token'])
        self.assertEqual(self.client.get('/api/profile/preferences/').data['preferences']['theme'], 'dark')

    def test_sms_cannot_be_enabled_and_invalid_choices_are_rejected(self):
        for patch in ({'sms_notifications': True}, {'theme': 'invalid'}, {'text_size': 'huge'}, {'high_contrast': 'not a boolean'}):
            self.assertEqual(self.client.patch('/api/profile/preferences/', patch, format='json').status_code, 400)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.preferences, {})

    def test_no_cross_account_or_privilege_updates(self):
        for url in ('/api/profile/', '/api/profile/preferences/'):
            for patch in ({'user_id': self.other.pk}, {'id': self.other.pk}, {'role': 'mayor'}, {'permissions': ['manage_users']}, {'password': 'unsafe'}):
                self.assertEqual(self.client.patch(url, patch, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'/api/users/{self.other.pk}/', {'first_name': 'Intruder'}, format='json').status_code, 403)
        self.other.refresh_from_db()
        self.assertEqual(self.other.first_name, '')
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.role, 'user')

    def test_authentication_required(self):
        self.client.credentials()
        for url, method in [('/api/profile/', 'get'), ('/api/profile/', 'patch'),
                            ('/api/profile/preferences/', 'get'), ('/api/profile/preferences/', 'patch'),
                            ('/api/profile/change-password/', 'post')]:
            self.assertEqual(getattr(self.client, method)(url).status_code, 401)

    def password_payload(self, **extra):
        return {'current_password': 'Original-Secure-Pass23!', 'new_password': 'Replacement-Str0ng-Pass42!',
                'confirm_password': 'Replacement-Str0ng-Pass42!', **extra}

    def test_password_wrong_current_confirmation_and_policy(self):
        for payload, field in [
            (self.password_payload(current_password='wrong'), 'current_password'),
            (self.password_payload(confirm_password='different'), 'confirm_password'),
            (self.password_payload(new_password='short', confirm_password='short'), 'new_password'),
            (self.password_payload(new_password='123456789', confirm_password='123456789'), 'new_password'),
        ]:
            result = self.client.post('/api/profile/change-password/', payload, format='json')
            self.assertEqual(result.status_code, 400)
            self.assertIn(field, result.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Original-Secure-Pass23!'))
        self.assertTrue(Token.objects.filter(key=self.token.key).exists())

    def test_password_is_hashed_token_rotated_and_new_login_works(self):
        response = self.client.post('/api/profile/change-password/', self.password_payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('password', response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Replacement-Str0ng-Pass42!'))
        self.assertNotEqual(self.user.password, 'Replacement-Str0ng-Pass42!')
        self.assertFalse(Token.objects.filter(key=self.token.key).exists())
        self.assertEqual(self.client.get('/api/profile/').status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + response.data['token'])
        self.assertEqual(self.client.get('/api/profile/').status_code, 200)
        self.client.credentials()
        self.assertEqual(self.client.post('/api/login/', {'email': self.user.username, 'password': 'Original-Secure-Pass23!'}).status_code, 401)
        self.assertEqual(self.client.post('/api/login/', {'email': self.user.username, 'password': 'Replacement-Str0ng-Pass42!'}).status_code, 200)

    def test_optional_channels_do_not_disable_critical_notifications_or_sms_preparation(self):
        app = BurialApplication.objects.create(application_id='SETTINGS-EVENT', submitted_by=self.user,
            deceased_name='Test', deceased_date_of_death='2026-01-01', applicant_name='Test',
            applicant_relationship='other', applicant_contact_email=self.user.email, applicant_contact_phone='')
        self.client.patch('/api/profile/preferences/', {'email_notifications': False, 'cemetery_announcements': False}, format='json')
        app = BurialApplication.objects.get(pk=app.pk)
        notice = NotificationService.create(app, 'approved', 'Approved', 'Private update', 'settings:one', 'GraveTrak: Update')
        self.assertFalse(notice.send_via_email)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(SmsOutbox.objects.get().status, 'provider_not_configured')
        self.client.patch('/api/profile/preferences/', {'email_notifications': True}, format='json')
        app = BurialApplication.objects.get(pk=app.pk)
        notice = NotificationService.create(app, 'approved', 'Approved', 'Update', 'settings:two', 'GraveTrak: Update')
        self.assertTrue(notice.send_via_email)
        self.assertFalse(notice.sent)

    def test_legacy_user_without_profile_gets_defaults_and_can_save(self):
        self.profile.delete()
        result = self.client.get('/api/profile/').data
        self.assertEqual(result['preferences']['theme'], 'light')
        self.assertEqual(self.client.patch('/api/profile/preferences/', {'text_size': 'medium'}, format='json').status_code, 200)
        self.assertEqual(UserProfile.objects.get(user=self.user).preferences['text_size'], 'medium')

    def test_non_object_payload_is_a_validation_error(self):
        self.assertEqual(self.client.patch('/api/profile/preferences/', [{'theme': 'dark'}], format='json').status_code, 400)
