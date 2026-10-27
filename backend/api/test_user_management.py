from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import UserProfile

User = get_user_model()
PASSWORD = 'Cedar!River-4927'


class UserManagementTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.mayor = User.objects.create_user(username='mayor@example.com', email='mayor@example.com', password=PASSWORD)
        UserProfile.objects.create(user=cls.mayor, role='mayor')
        cls.citizen = User.objects.create_user(username='citizen@example.com', email='citizen@example.com', password=PASSWORD)
        UserProfile.objects.create(user=cls.citizen, role='user')
        cls.limited = User.objects.create_user(username='limited@example.com', email='limited@example.com', password=PASSWORD)
        UserProfile.objects.create(user=cls.limited, role='staff', permissions=['manage_users'])

    def setUp(self):
        self.client.force_authenticate(self.mayor)
        self.url = f'/api/users/{self.citizen.pk}/'

    def new_user(self, **changes):
        return {'email': 'new@example.com', 'password': PASSWORD, 'first_name': 'New', 'role': 'user', **changes}

    def test_create_user_hashes_password_and_does_not_create_session_or_verify_email(self):
        response = self.client.post('/api/users/', self.new_user(role='planning', contact_number='09123456789'), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        created = User.objects.get(pk=response.data['id'])
        self.assertTrue(created.check_password(PASSWORD))
        self.assertEqual(created.profile.role, 'planning')
        self.assertEqual(created.profile.contact_number, '09123456789')
        self.assertFalse(created.is_staff)
        self.assertFalse(created.is_superuser)
        self.assertFalse(Token.objects.filter(user=created).exists())
        self.assertFalse(created.email_verification.verified_at if hasattr(created, 'email_verification') else False)
        self.assertNotIn('password', response.data)

    def test_create_requires_permission_and_valid_password(self):
        before = User.objects.count()
        for password in ('', '123', 'password'):
            response = self.client.post('/api/users/', self.new_user(password=password), format='json')
            self.assertEqual(response.status_code, 400)
            self.assertIn('password', response.data)
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.post('/api/users/', self.new_user(), format='json').status_code, 403)
        self.assertEqual(User.objects.count(), before)

    def test_duplicate_email_is_a_validation_error_for_create_and_edit(self):
        for email in ('mayor@example.com', 'MAYOR@EXAMPLE.COM'):
            created = self.client.post('/api/users/', self.new_user(email=email), format='json')
            updated = self.client.patch(self.url, {'email': email, 'first_name': 'Must not save'}, format='json')
            self.assertEqual(created.status_code, 400, created.data)
            self.assertEqual(updated.status_code, 400, updated.data)
            self.assertIn('email', updated.data)
        self.citizen.refresh_from_db()
        self.assertEqual(self.citizen.email, 'citizen@example.com')
        self.assertEqual(self.citizen.first_name, '')

    def test_edit_own_email_and_normalized_new_email(self):
        self.assertEqual(self.client.patch(self.url, {'email': self.citizen.email}, format='json').status_code, 200)
        response = self.client.patch(self.url, {'email': ' Changed@EXAMPLE.COM ', 'first_name': 'Changed'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.citizen.refresh_from_db()
        self.assertEqual(self.citizen.email, 'changed@example.com')
        self.assertEqual(self.citizen.username, 'changed@example.com')

    def test_cannot_deactivate_or_remove_own_management_access(self):
        url = f'/api/users/{self.mayor.pk}/'
        for patch in ({'is_active': False}, {'role': 'user'}, {'permissions': ['generate_reports']}):
            response = self.client.patch(url, patch, format='json')
            self.assertEqual(response.status_code, 400, response.data)
        self.mayor.refresh_from_db()
        self.assertTrue(self.mayor.is_active)
        self.assertEqual(self.mayor.profile.role, 'mayor')

    def test_limited_manager_can_edit_contact_but_not_roles_or_permissions(self):
        self.client.force_authenticate(self.limited)
        self.assertEqual(self.client.patch(self.url, {'first_name': 'Updated', 'contact_number': '09123456789'}, format='json').status_code, 200)
        for patch in ({'role': 'mayor'}, {'permissions': ['manage_users']}):
            self.assertEqual(self.client.patch(self.url, patch, format='json').status_code, 403)
        for payload in (self.new_user(role='mayor'), self.new_user(permissions=['manage_users'])):
            self.assertEqual(self.client.post('/api/users/', payload, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/users/', self.new_user(), format='json').status_code, 201)

    def test_activation_controls_login_and_existing_token_access(self):
        token = Token.objects.create(user=self.citizen)
        response = self.client.patch(self.url, {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.post('/api/login/', {'email': self.citizen.email, 'password': PASSWORD}, format='json').status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
        self.assertEqual(self.client.get('/api/profile/').status_code, 401)
        self.client.credentials()
        self.client.force_authenticate(self.mayor)
        self.assertEqual(self.client.patch(self.url, {'is_active': True}, format='json').status_code, 200)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.post('/api/login/', {'email': self.citizen.email, 'password': PASSWORD}, format='json').status_code, 200)

    def test_only_successful_login_updates_last_login(self):
        self.client.force_authenticate(user=None)
        self.assertIsNone(self.citizen.last_login)
        self.assertEqual(self.client.post('/api/login/', {'email': self.citizen.email, 'password': 'wrong'}, format='json').status_code, 401)
        self.citizen.refresh_from_db()
        self.assertIsNone(self.citizen.last_login)
        response = self.client.post('/api/login/', {'email': self.citizen.email, 'password': PASSWORD}, format='json')
        self.assertEqual(response.status_code, 200)
        self.citizen.refresh_from_db()
        self.assertIsNotNone(self.citizen.last_login)
        self.assertIsNotNone(response.data['user']['last_login'])
