from datetime import date

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import BurialApplication, BurialPlot, Cemetery, CemeterySection, ColumbariumSlot, UserProfile
from .workflow import ApplicationWorkflowEngine, PlotAssignmentEngine


class IndividualPlotMaintenanceTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='maintenance-cpdo')
        UserProfile.objects.update_or_create(user=self.user, defaults={'role': 'planning'})
        self.client.force_authenticate(self.user)
        cemetery, _ = Cemetery.objects.get_or_create(code='new', defaults={'name': 'New Cemetery'})
        self.section = CemeterySection.objects.create(cemetery=cemetery, name='Maintenance test', zone_code='MT', status='active')
        self.plot = BurialPlot.objects.create(cemetery=cemetery, section_record=self.section, section='MT', plot_id='MT-1', plot_number=1)
        self.neighbor = BurialPlot.objects.create(cemetery=cemetery, section_record=self.section, section='MT', plot_id='MT-2', plot_number=2)
        self.niche = ColumbariumSlot.objects.create(id='MT-F1-C1', cemetery_map='new', section=self.section.name, floor=1, col=1, status='occupied', name='Preserved occupant')

    def action(self, item, operation, notes='Repair cracked cover', **extra):
        resource = 'columbariums' if isinstance(item, ColumbariumSlot) else 'burial-plots'
        return self.client.post(f'/api/{resource}/{item.pk}/maintenance/', {
            'operation': operation, 'notes': notes, 'expected_updated_at': item.updated_at.isoformat(), **extra,
        }, format='json')

    def application(self):
        return BurialApplication.objects.create(
            application_id='MT-APP', deceased_name='Test deceased', deceased_date_of_death=date(2026, 1, 1),
            applicant_name='Test applicant', applicant_relationship='child', applicant_contact_email='test@example.com',
            applicant_contact_phone='09123456789', applicant_address='Lucena', status='slot_assigned', assigned_plot=self.plot,
        )

    def test_only_selected_plot_changes_and_summary_updates(self):
        result = self.action(self.plot, 'start')
        self.assertEqual(result.status_code, 200, result.data)
        self.plot.refresh_from_db(); self.neighbor.refresh_from_db(); self.section.refresh_from_db()
        self.assertEqual(self.plot.status, 'maintenance')
        self.assertEqual(self.plot.maintenance_previous_status, 'available')
        self.assertEqual(self.neighbor.status, 'available')
        self.assertEqual(self.section.status, 'active')
        summary = self.client.get('/api/burial-plots/summary/', {'section': self.section.pk})
        self.assertEqual(summary.data['maintenance'], 1)
        self.assertEqual(summary.data['available'], 1)
        self.assertEqual(self.action(self.plot, 'complete').status_code, 200)
        self.plot.refresh_from_db()
        self.assertEqual(self.plot.status, 'available')

    def test_occupied_niche_restores_occupant_and_status(self):
        self.assertEqual(self.action(self.niche, 'start').status_code, 200)
        self.niche.refresh_from_db()
        self.assertEqual(self.niche.name, 'Preserved occupant')
        self.assertEqual(self.niche.status, 'maintenance')
        self.assertEqual(self.action(self.niche, 'update', 'Waiting for materials').status_code, 200)
        self.niche.refresh_from_db()
        self.assertEqual(self.niche.maintenance_notes, 'Waiting for materials')
        result = self.action(self.niche, 'complete', 'Cover replaced')
        self.assertEqual(result.status_code, 200, result.data)
        self.niche.refresh_from_db()
        self.assertEqual(self.niche.status, 'occupied')
        self.assertEqual(self.niche.name, 'Preserved occupant')
        self.assertEqual(self.niche.maintenance_previous_status, '')

    def test_available_niche_returns_to_available(self):
        self.niche.status = 'available'; self.niche.name = ''; self.niche.save()
        self.assertEqual(self.action(self.niche, 'start').status_code, 200)
        self.niche.refresh_from_db()
        self.assertEqual(self.action(self.niche, 'complete').status_code, 200)
        self.niche.refresh_from_db()
        self.assertEqual(self.niche.status, 'available')

    def test_occupied_plot_restores_occupancy_and_application(self):
        application = self.application()
        self.plot.status = 'occupied'; self.plot.occupied_by_application = application; self.plot.save()
        self.assertEqual(self.action(self.plot, 'start').status_code, 200)
        self.plot.refresh_from_db()
        self.assertEqual(self.action(self.plot, 'complete').status_code, 200)
        self.plot.refresh_from_db()
        self.assertEqual(self.plot.status, 'occupied')
        self.assertEqual(self.plot.occupied_by_application_id, application.pk)

    def test_stale_record_cannot_overwrite_newer_change(self):
        self.assertEqual(self.action(self.plot, 'start').status_code, 200)
        self.assertEqual(self.action(self.plot, 'complete').status_code, 409)
        self.plot.refresh_from_db()
        self.assertEqual(self.plot.status, 'maintenance')

    def test_reason_and_valid_transition_are_required(self):
        self.assertEqual(self.action(self.plot, 'start', '   ').status_code, 400)
        self.assertEqual(self.action(self.plot, 'complete').status_code, 409)
        self.assertEqual(self.action(self.plot, 'invalid').status_code, 400)
        self.assertEqual(self.action(self.plot, 'start').status_code, 200)
        self.plot.refresh_from_db()
        self.assertEqual(self.action(self.plot, 'start').status_code, 409)

    def test_anonymous_and_citizen_cannot_manage_either_inventory(self):
        self.client.force_authenticate(user=None)
        for item in (self.plot, self.niche):
            self.assertEqual(self.action(item, 'start').status_code, 401)
        UserProfile.objects.filter(user=self.user).update(role='user')
        self.user.refresh_from_db(); self.client.force_authenticate(self.user)
        for item in (self.plot, self.niche):
            self.assertEqual(self.action(item, 'start').status_code, 403)

    def test_direct_patch_cannot_bypass_maintenance(self):
        for item, resource in ((self.plot, 'burial-plots'), (self.niche, 'columbariums')):
            self.assertEqual(self.action(item, 'start').status_code, 200)
            response = self.client.patch(f'/api/{resource}/{item.pk}/', {'status': 'available'}, format='json')
            self.assertEqual(response.status_code, 400, response.data)
        response = self.client.patch(f'/api/columbariums/{self.niche.pk}/', {'name': ''}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_maintenance_niche_cannot_receive_transfer(self):
        target = ColumbariumSlot.objects.create(id='MT-F1-C2', cemetery_map='new', section=self.section.name, floor=1, col=2)
        self.assertEqual(self.action(target, 'start').status_code, 200)
        response = self.client.post(f'/api/columbariums/{self.niche.pk}/transfer/', {'target_id': target.pk}, format='json')
        self.assertEqual(response.status_code, 409)
        self.niche.refresh_from_db()
        self.assertEqual(self.niche.name, 'Preserved occupant')

    def test_maintenance_plot_is_excluded_from_assignment(self):
        self.assertEqual(self.action(self.plot, 'start').status_code, 200)
        BurialPlot.objects.exclude(pk=self.neighbor.pk).exclude(pk=self.plot.pk).update(status='occupied')
        self.assertEqual(PlotAssignmentEngine.get_next_available_plot().pk, self.neighbor.pk)

    def test_pending_assignment_survives_maintenance_and_blocks_burial_completion(self):
        application = self.application()
        self.plot.assigned_to = application; self.plot.save()
        self.assertEqual(self.action(self.plot, 'start').status_code, 200)
        success, message = ApplicationWorkflowEngine.transition(application, 'completed', self.user)
        self.assertFalse(success, message)
        self.plot.refresh_from_db(); application.refresh_from_db()
        self.assertEqual(self.plot.status, 'maintenance')
        self.assertEqual(self.plot.assigned_to_id, application.pk)
        self.assertEqual(application.status, 'slot_assigned')
        self.assertEqual(self.action(self.plot, 'complete').status_code, 200)
        self.plot.refresh_from_db()
        self.assertEqual(self.plot.assigned_to_id, application.pk)

    def test_rejecting_assignment_does_not_remove_maintenance(self):
        application = self.application()
        self.plot.assigned_to = application; self.plot.save()
        self.assertEqual(self.action(self.plot, 'start').status_code, 200)
        success, message = ApplicationWorkflowEngine.transition(application, 'rejected', self.user)
        self.assertTrue(success, message)
        self.plot.refresh_from_db()
        self.assertEqual(self.plot.status, 'maintenance')
        self.assertIsNone(self.plot.assigned_to_id)

    def test_legacy_maintenance_record_can_be_completed(self):
        self.plot.status = 'maintenance'; self.plot.save()
        self.assertEqual(self.action(self.plot, 'complete').status_code, 200)
        self.plot.refresh_from_db()
        self.assertEqual(self.plot.status, 'available')
