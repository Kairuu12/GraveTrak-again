import tempfile
import gc
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import BurialApplication, BurialDocument, InterviewSchedule, Notification, SmsOutbox, UserProfile
from .notifications import NotificationService, normalize_ph_mobile
from .workflow import ApplicationWorkflowEngine


@override_settings(PHILSMS_ENABLED=False)
class BurialNotificationTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        self.addCleanup(gc.collect)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)
        User = get_user_model()
        self.owner = User.objects.create_user('owner')
        self.other = User.objects.create_user('other')
        self.staff = User.objects.create_user('reviewer')
        UserProfile.objects.create(user=self.owner, contact_number='09123456789')
        UserProfile.objects.create(user=self.other)
        UserProfile.objects.create(user=self.staff, role='mayor')
        self.application = BurialApplication.objects.create(
            application_id='NOTIFY-TEST', deceased_name='Private Deceased',
            deceased_date_of_death=timezone.localdate(), applicant_name='Owner',
            applicant_relationship='other', applicant_contact_email='owner@example.test',
            applicant_contact_phone='09999999999', applicant_address='Test', submitted_by=self.owner)
        self.base = f'/api/burial-applications/{self.application.pk}/'
        self.client.force_authenticate(self.staff)

    def documents(self, correction_count=0):
        for index, kind in enumerate(BurialDocument.required_document_types()):
            BurialDocument.objects.create(application=self.application, document_type=kind,
                document_file=SimpleUploadedFile(kind + '.pdf', b'%PDF test'),
                verification_status='needs_correction' if index < correction_count else 'complete')

    def schedule_payload(self):
        day = timezone.localdate() + timedelta(days=2)
        while day.weekday() == 6:
            day += timedelta(days=1)
        return {'scheduled_date': str(day), 'scheduled_time': '10:00:00',
                'duration_minutes': 30, 'location': 'CMO Office', 'notes': 'Private applicant note'}

    def schedule(self):
        self.documents()
        self.assertEqual(self.client.post(self.base + 'complete-document-review/').status_code, 200)
        response = self.client.post(self.base + 'schedule-interview/', self.schedule_payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def test_philippine_normalization(self):
        for value in ('09123456789', '9123456789', '+639123456789', '639123456789', '0912 345-6789'):
            self.assertEqual(normalize_ph_mobile(value), '+639123456789')
        for value in ('', None, '123', '+14155551234', '0912abc6789', '08123456789'):
            self.assertIsNone(normalize_ph_mobile(value))

    def test_individual_reviews_do_not_notify_and_finalized_corrections_are_consolidated(self):
        self.documents()
        for doc in list(self.application.documents.all())[:3]:
            result = self.client.post(f'/api/burial-documents/{doc.pk}/review/',
                {'verification_status': 'needs_correction', 'verification_remarks': 'Private detail'}, format='json')
            self.assertEqual(result.status_code, 200)
            self.assertEqual(SmsOutbox.objects.count(), 0)
        for _ in range(2):
            response = self.client.post(self.base + 'complete-document-review/')
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(SmsOutbox.objects.count(), 1)
        self.assertEqual(Notification.objects.get().notification_type, 'documents_correction')
        self.assertNotIn('Private', SmsOutbox.objects.get().message)
        # A replacement upload creates a genuinely new review event.
        self.client.force_authenticate(self.owner)
        kind = self.application.documents.first().document_type
        self.client.post(self.base + 'upload-documents/', {kind: SimpleUploadedFile('replacement.pdf', b'%PDF revised')}, format='multipart')
        self.client.force_authenticate(self.staff)
        doc = self.application.documents.get(document_type=kind)
        self.client.post(f'/api/burial-documents/{doc.pk}/review/', {'verification_status': 'needs_correction', 'verification_remarks': 'Private detail'}, format='json')
        self.assertEqual(self.client.post(self.base + 'complete-document-review/').status_code, 200)
        self.assertEqual(SmsOutbox.objects.count(), 2)

    def test_complete_documents_and_failed_schedule_create_no_sms(self):
        self.documents()
        self.assertEqual(SmsOutbox.objects.count(), 0)
        self.assertEqual(self.client.post(self.base + 'complete-document-review/').status_code, 200)
        self.assertEqual(SmsOutbox.objects.count(), 0)
        payload = self.schedule_payload()
        payload['scheduled_date'] = str(timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.client.post(self.base + 'schedule-interview/', payload, format='json').status_code, 400)
        self.assertEqual(SmsOutbox.objects.count(), 0)
        self.assertEqual(InterviewSchedule.objects.count(), 0)

    def test_schedule_retry_and_material_reschedule_versions(self):
        response = self.schedule()
        self.assertEqual(self.client.post(self.base + 'schedule-interview/', self.schedule_payload(), format='json').status_code, 200)
        self.assertEqual(Notification.objects.count(), 1)
        record = SmsOutbox.objects.get()
        self.assertEqual(record.status, 'provider_not_configured')
        self.assertEqual(record.recipient_number, '+639123456789')
        self.assertFalse(record.eligible_for_delivery)
        self.assertIsNone(record.sent_at)
        self.assertFalse(Notification.objects.get().sent)
        self.assertNotIn('Private', record.message)
        url = f'/api/interview-schedules/{response.data["schedule_id"]}/reschedule/'
        payload = self.schedule_payload()
        payload['notes'] = 'Different private note'
        self.assertEqual(self.client.post(url, payload, format='json').status_code, 200)
        self.assertEqual(SmsOutbox.objects.count(), 1)
        for location in ('New Office', 'CMO Office'):
            payload['location'] = location
            self.assertEqual(self.client.post(url, payload, format='json').status_code, 200)
            self.assertEqual(self.client.post(url, payload, format='json').status_code, 200)
        self.assertEqual(SmsOutbox.objects.count(), 3)
        self.assertEqual(Notification.objects.filter(notification_type='interview_rescheduled').count(), 2)

    def test_no_sms_for_status_views_or_in_review(self):
        self.client.get(self.base)
        self.client.get('/api/burial-applications/')
        self.client.post(self.base + 'request-action/', {'reason': 'Additional information'}, format='json')
        self.application.refresh_from_db()
        ApplicationWorkflowEngine.transition(self.application, 'pending_review', self.staff)
        self.assertFalse(SmsOutbox.objects.exists())

    def test_appointment_cancellation_is_not_application_cancellation(self):
        response = self.schedule()
        result = self.client.post(f'/api/interview-schedules/{response.data["schedule_id"]}/cancel/', {'reason': 'Appointment only'}, format='json')
        self.assertEqual(result.status_code, 200)
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, 'documents_complete')
        self.assertEqual(SmsOutbox.objects.count(), 1)

    def test_invalid_approval_and_rejection_do_not_notify(self):
        self.assertEqual(self.client.post(self.base + 'approve/').status_code, 400)
        self.assertEqual(self.client.post(self.base + 'reject/').status_code, 400)
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(SmsOutbox.objects.exists())

    def test_review_finalization_requires_all_submitted_documents_reviewed(self):
        self.documents(correction_count=1)
        self.application.documents.filter(verification_status='complete').update(verification_status='pending_review')
        self.assertEqual(self.client.post(self.base + 'complete-document-review/').status_code, 400)
        self.assertFalse(SmsOutbox.objects.exists())

    def test_bell_is_newest_first_and_read_retry_preserves_timestamp(self):
        for text in ('First update', 'Second update'):
            self.client.post(self.base + 'notify/', {'message': text, 'idempotency_key': str(uuid.uuid4())}, format='json')
        self.client.force_authenticate(self.owner)
        rows = self.client.get('/api/notifications/').data
        self.assertEqual([row['message'] for row in rows], ['Second update', 'First update'])
        url = f'/api/notifications/{rows[0]["id"]}/mark-read/'
        first = self.client.post(url).data['read_at']
        self.assertEqual(self.client.post(url).data['read_at'], first)

    def test_approval_rejection_and_retries(self):
        self.documents()
        for target in ('approved', 'rejected'):
            BurialApplication.objects.filter(pk=self.application.pk).update(status='slot_assigned')
            endpoint = 'approve/' if target == 'approved' else 'reject/'
            for _ in range(2):
                response = self.client.post(self.base + endpoint, {'reason': 'Sensitive reason'}, format='json')
                self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(SmsOutbox.objects.filter(notification_type=target).count(), 1)
        self.assertFalse(SmsOutbox.objects.filter(message__contains='Sensitive').exists())

    def test_manual_notify_validation_owner_resolution_and_idempotency(self):
        payload = {'message': 'Private in-app message', 'idempotency_key': str(uuid.uuid4()),
                   'recipient': self.other.pk, 'phone': '09999999999'}
        for _ in range(2):
            result = self.client.post(self.base + 'notify/', payload, format='json')
            self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(SmsOutbox.objects.count(), 1)
        self.assertEqual(Notification.objects.get().recipient, self.owner)
        self.assertEqual(SmsOutbox.objects.get().recipient_number, '+639123456789')
        self.assertNotIn('Private', SmsOutbox.objects.get().message)
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, 'pending_review')
        self.assertNotIn('09123456789', str(self.client.get(self.base + 'notify/').data))
        payload['message'] = 'Different message'
        self.assertEqual(self.client.post(self.base + 'notify/', payload, format='json').status_code, 409)
        for message in ('', ' ' * 2, 'x' * 1001, None):
            self.assertEqual(self.client.post(self.base + 'notify/', {**payload, 'message': message}, format='json').status_code, 400)
        payload['idempotency_key'] = str(uuid.uuid4())
        self.assertEqual(self.client.post(self.base + 'notify/', payload, format='json').status_code, 200)
        self.assertEqual(SmsOutbox.objects.count(), 2)

    def test_missing_and_invalid_mobile_do_not_break_business_action(self):
        for number in ('', 'bad-number'):
            UserProfile.objects.filter(user=self.owner).update(contact_number=number)
            response = self.client.post(self.base + 'notify/', {'message': 'Update', 'idempotency_key': str(uuid.uuid4())}, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['sms_status'], 'invalid_recipient')
        self.assertEqual(Notification.objects.count(), 2)
        self.assertEqual(SmsOutbox.objects.filter(status='invalid_recipient').count(), 2)

    def test_legacy_application_without_owner_is_logged_without_fake_delivery(self):
        self.application.submitted_by = None
        self.application.status = 'slot_assigned'
        self.application.save()
        ApplicationWorkflowEngine.transition(self.application, 'rejected', self.staff)
        self.assertFalse(Notification.objects.exists())
        self.assertEqual(SmsOutbox.objects.get().status, 'invalid_recipient')

    def test_bell_count_read_and_owner_isolation(self):
        self.client.post(self.base + 'notify/', {'message': 'Update', 'idempotency_key': str(uuid.uuid4())}, format='json')
        notification = Notification.objects.get()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/notifications/').data, [])
        self.assertEqual(self.client.get(f'/api/notifications/{notification.pk}/').status_code, 404)
        self.assertEqual(self.client.post(f'/api/notifications/{notification.pk}/mark-read/').status_code, 404)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get('/api/notifications/unread-count/').data['count'], 1)
        self.assertEqual(self.client.get('/api/notifications/').data[0]['application'], self.application.pk)
        self.client.post(f'/api/notifications/{notification.pk}/mark-read/')
        self.assertEqual(self.client.get('/api/notifications/unread-count/').data['count'], 0)
        notification.refresh_from_db()
        self.assertIsNotNone(notification.read_at)

    def test_citizen_cannot_trigger_staff_notifications(self):
        self.client.force_authenticate(self.owner)
        for endpoint in ('notify/', 'approve/', 'reject/', 'complete-document-review/', 'schedule-interview/'):
            self.assertEqual(self.client.post(self.base + endpoint, {}, format='json').status_code, 403)
        self.assertFalse(SmsOutbox.objects.exists())

    def test_transaction_rollback_removes_business_state_and_notifications(self):
        self.application.status = 'slot_assigned'
        self.application.save()
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                ApplicationWorkflowEngine.transition(self.application, 'approved', self.staff)
                raise RuntimeError('Downstream save failed')
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, 'slot_assigned')
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(SmsOutbox.objects.exists())

    def test_schedule_rolls_back_if_outbox_persistence_fails(self):
        self.documents()
        self.client.post(self.base + 'complete-document-review/')
        with patch('api.notifications.SmsService.prepare', side_effect=RuntimeError('Storage unavailable')):
            with self.assertRaises(RuntimeError):
                self.client.post(self.base + 'schedule-interview/', self.schedule_payload(), format='json')
        self.assertFalse(InterviewSchedule.objects.exists())
        self.assertFalse(Notification.objects.exists())
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, 'documents_complete')
