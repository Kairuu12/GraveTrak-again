from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from .models import BurialApplication, BurialDocument, ColumbariumSlot, Grave, UserProfile, StatusAuditLog


@override_settings(BREVO_EMAIL_ENABLED=False, PHILSMS_ENABLED=False,
                   STORAGES={'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
                             'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'}})
class FinalAssignmentTests(APITestCase):
    def setUp(self):
        self.mayor = get_user_model().objects.create_user('assignment-mayor')
        UserProfile.objects.create(user=self.mayor, role='mayor')
        self.owner = get_user_model().objects.create_user('assignment-owner', email='owner@example.com')
        UserProfile.objects.create(user=self.owner)
        self.client.force_authenticate(self.mayor)
        self.app = BurialApplication.objects.create(application_id='ASSIGN-TEST',
            deceased_name='Test Occupant', deceased_date_of_death=timezone.localdate(),
            applicant_name='Owner', submitted_by=self.owner, status='for_interview')
        for kind in BurialDocument.required_document_types():
            BurialDocument.objects.create(application=self.app, document_type=kind,
                document_file=SimpleUploadedFile(kind+'.pdf', b'%PDF test'), verification_status='complete')
        self.slot = ColumbariumSlot.objects.create(id='ASSIGN-NICHE', section='Section A',
            cemetery_map='old', floor=1, col=99)
        self.url = f'/api/burial-applications/{self.app.pk}/approve-and-assign/'
        self.payload = {'type': 'columbarium', 'target_id': self.slot.pk}

    def test_final_assignment_persists_approval_once_without_burial_completion(self):
        for _ in range(2):
            response = self.client.post(self.url, self.payload, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        self.app.refresh_from_db(); self.slot.refresh_from_db()
        self.assertEqual(self.app.status, 'slot_assigned')
        self.assertIsNotNone(self.app.approved_at)
        self.assertIsNone(self.app.completed_at)
        self.assertIsNone(self.app.burial_executed_date)
        self.assertEqual(self.slot.status, 'occupied')
        self.assertIn(self.slot.pk, self.app.burial_location)
        self.assertEqual(StatusAuditLog.objects.filter(application=self.app, new_status='approved').count(), 1)
        result = self.client.get('/api/reports/analytics/', {'period': 'overall'})
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['metrics']['applications_approved'], 1)
        # Report period must follow approval date, not submission date or current status.
        old_date = timezone.now() - timedelta(days=60)
        BurialApplication.objects.filter(pk=self.app.pk).update(approved_at=old_date, status='completed')
        today = self.client.get('/api/reports/analytics/', {'period': 'today'})
        self.assertEqual(today.data['metrics']['applications_approved'], 0)
        self.assertEqual(self.client.get('/api/reports/analytics/', {'period': 'overall'}).data['metrics']['applications_approved'], 1)

    def test_conflict_and_missing_documents_do_not_save_approval(self):
        self.slot.status = 'maintenance'; self.slot.save()
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 400)
        self.slot.status = 'available'; self.slot.save()
        self.app.documents.update(verification_status='pending_review')
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 400)
        self.app.refresh_from_db(); self.assertIsNone(self.app.approved_at)

    def test_failure_rolls_back_slot_and_application(self):
        with patch('api.application_assignment.NotificationService.final_status', side_effect=RuntimeError('storage failure')):
            with self.assertRaises(RuntimeError):
                self.client.post(self.url, self.payload, format='json')
        self.app.refresh_from_db(); self.slot.refresh_from_db()
        self.assertEqual(self.slot.status, 'available'); self.assertIsNone(self.app.approved_at)
        self.assertFalse(StatusAuditLog.objects.filter(application=self.app).exists())

    def test_citizen_cannot_approve_and_existing_occupant_is_protected(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 403)
        self.client.force_authenticate(self.mayor)
        self.slot.name = 'Existing occupant'; self.slot.save()
        self.assertEqual(self.client.post(self.url, self.payload, format='json').status_code, 400)
        self.slot.refresh_from_db(); self.assertEqual(self.slot.name, 'Existing occupant')

    def test_ground_assignment_and_invalid_target(self):
        invalid = self.client.post(self.url, {'type': 'grave', 'target_id': 'invalid'}, format='json')
        self.assertEqual(invalid.status_code, 400)
        grave = Grave.objects.create(grave_id='ASSIGN-GROUND', name='', location='Test ground plot')
        result = self.client.post(self.url, {'type': 'grave', 'target_id': grave.pk}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.app.refresh_from_db(); grave.refresh_from_db()
        self.assertIsNotNone(self.app.approved_at)
        self.assertEqual(grave.name, self.app.deceased_name)
        self.assertEqual(grave.status, 'occupied')
        self.assertIn(grave.grave_id, self.app.burial_location)
