from datetime import timedelta
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase
from .models import OperationsReport, UserProfile, BurialApplication
from .report_applications import application_report_details


class OperationsReportTests(APITestCase):
    def test_report_includes_older_submission_approved_in_period_once(self):
        today = timezone.localdate()
        now = timezone.now()
        app = BurialApplication.objects.create(application_id='REPORT-APP-1', deceased_name='Test Deceased', deceased_date_of_death=today, applicant_name='Test Applicant', status='approved')
        BurialApplication.objects.filter(pk=app.pk).update(submitted_at=now - timedelta(days=30), approved_at=now, burial_date=today)
        unrelated = BurialApplication.objects.create(application_id='REPORT-APP-2', deceased_name='Other', deceased_date_of_death=today, applicant_name='Other', status='pending_review')
        BurialApplication.objects.filter(pk=unrelated.pk).update(submitted_at=now - timedelta(days=30))
        result = application_report_details(today, today)
        self.assertEqual(len(result['application_records']), 1)
        self.assertEqual(result['application_records'][0]['id'], 'REPORT-APP-1')
        self.assertEqual(result['application_statuses'], [{'code': 'approved', 'label': 'Approved', 'count': 1}])

    def setUp(self):
        self.accounts = {}
        for role in ['staff', 'mayor', 'user', 'planning', 'other']:
            user = get_user_model().objects.create_user(username=f'report-{role}')
            UserProfile.objects.update_or_create(user=user, defaults={'role': 'staff' if role == 'other' else role})
            self.accounts[role] = user
        today = timezone.localdate().isoformat()
        self.payload = {'title': 'Operations report', 'period_from': today, 'period_to': today, 'notes': 'Test only'}

    def test_submission_acknowledgment_persists_and_snapshot_is_server_owned(self):
        self.client.force_authenticate(self.accounts['staff'])
        response = self.client.post('/api/operations-reports/', {**self.payload, 'snapshot': {'metrics': {'burials': 999}}, 'status': 'acknowledged'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['snapshot']['metrics']['burials'], 0)
        self.assertIn('generated_at', response.data['snapshot']['staff_operations'])
        self.assertEqual(response.data['snapshot']['staff_operations']['burials'], [])
        self.assertEqual(response.data['status'], 'pending')
        pk = response.data['id']
        url = f'/api/operations-reports/{pk}/acknowledge/'
        self.assertEqual(self.client.post(url).status_code, 403)
        self.client.force_authenticate(self.accounts['mayor'])
        self.assertEqual(len(self.client.get('/api/operations-reports/').data), 1)
        first = self.client.post(url)
        self.assertEqual(first.status_code, 200)
        second = self.client.post(url)
        self.assertEqual(first.data['acknowledged_at'], second.data['acknowledged_at'])
        self.client.force_authenticate(self.accounts['staff'])
        self.assertEqual(self.client.get('/api/operations-reports/').data[0]['status'], 'acknowledged')
        self.assertEqual(self.client.patch(f'/api/operations-reports/{pk}/', {'notes': 'changed'}).status_code, 405)

    def test_role_and_owner_boundaries(self):
        self.client.force_authenticate(self.accounts['staff'])
        report = self.client.post('/api/operations-reports/', self.payload, format='json').data
        self.client.force_authenticate(self.accounts['other'])
        self.assertEqual(self.client.get('/api/operations-reports/').data, [])
        self.assertEqual(self.client.get(f"/api/operations-reports/{report['id']}/").status_code, 404)
        for role in ['user', 'planning']:
            self.client.force_authenticate(self.accounts[role])
            self.assertEqual(self.client.get('/api/operations-reports/').status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get('/api/operations-reports/').status_code, [401, 403])
        self.client.force_authenticate(self.accounts['mayor'])
        self.assertEqual(self.client.post('/api/operations-reports/', self.payload, format='json').status_code, 403)

    def test_invalid_period_and_missing_capability(self):
        self.client.force_authenticate(self.accounts['staff'])
        future = (timezone.localdate() + timedelta(days=1)).isoformat()
        self.assertEqual(self.client.post('/api/operations-reports/', {**self.payload, 'period_to': future}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/operations-reports/', {**self.payload, 'period_from': future}, format='json').status_code, 400)
        profile = self.accounts['staff'].profile
        profile.permissions = ['manage_plots']; profile.save()
        self.assertEqual(self.client.post('/api/operations-reports/', self.payload, format='json').status_code, 403)
        self.assertEqual(OperationsReport.objects.count(), 0)
