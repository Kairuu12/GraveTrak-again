from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from .models import SavedGrave, UserProfile


class SavedGravePrivacyTests(APITestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(username='saved-owner')
        self.other = get_user_model().objects.create_user(username='saved-other')
        self.staff = get_user_model().objects.create_user(username='saved-staff')
        for user, role in [(self.owner, 'user'), (self.other, 'user'), (self.staff, 'staff')]:
            UserProfile.objects.update_or_create(user=user, defaults={'role': role})
        self.payload = {'grave_id': 'Section A-F2-C1', 'cemetery': 'old',
                        'details': {'name': 'Test Loved One', 'floor': 2, 'latlng': [13.94, 121.62]}}

    def test_guests_and_staff_cannot_access(self):
        for user in [None, self.staff]:
            self.client.force_authenticate(user=user)
            self.assertIn(self.client.get('/api/saved-graves/').status_code, [401, 403])
            self.assertIn(self.client.post('/api/saved-graves/', self.payload, format='json').status_code, [401, 403])

    def test_owner_is_server_assigned_and_duplicates_are_idempotent(self):
        self.client.force_authenticate(user=self.owner)
        payload = {**self.payload, 'user': self.other.pk}
        first = self.client.post('/api/saved-graves/', payload, format='json')
        self.assertEqual(first.status_code, 201)
        second = self.client.post('/api/saved-graves/', payload, format='json')
        self.assertEqual(second.status_code, 200)
        self.assertEqual(SavedGrave.objects.get().user, self.owner)
        self.assertEqual(len(self.client.get('/api/saved-graves/').data), 1)

    def test_other_account_cannot_read_or_delete_and_can_save_same_grave(self):
        self.client.force_authenticate(user=self.owner)
        item = self.client.post('/api/saved-graves/', self.payload, format='json').data
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get('/api/saved-graves/').data, [])
        url = f"/api/saved-graves/{item['id']}/"
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)
        self.assertEqual(self.client.post('/api/saved-graves/', self.payload, format='json').status_code, 201)
        self.client.force_authenticate(user=self.owner)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual(SavedGrave.objects.get().user, self.other)

    def test_invalid_coordinates_are_rejected_and_cemeteries_are_distinct(self):
        self.client.force_authenticate(user=self.owner)
        invalid = {**self.payload, 'details': {'name': 'Test', 'latlng': [91, 181]}}
        self.assertEqual(self.client.post('/api/saved-graves/', invalid, format='json').status_code, 400)
        for cemetery in ['old', 'new']:
            self.assertEqual(self.client.post('/api/saved-graves/', {**self.payload, 'cemetery': cemetery}, format='json').status_code, 201)
        self.assertEqual(SavedGrave.objects.count(), 2)
