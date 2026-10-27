from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import BurialApplication, BurialDocument, BurialPlot, Cemetery, CemeterySection, ColumbariumSlot, Grave, InterviewSchedule, SystemSettings, UserProfile
from .reporting import get_report_date_range


User = get_user_model()


class ReportAnalyticsAPITests(APITestCase):
    def setUp(self):
        self.mayor = User.objects.create_user(username='report-mayor@example.com', password='safe-password')
        UserProfile.objects.create(user=self.mayor, role='mayor')
        self.staff = User.objects.create_user(username='report-staff@example.com', password='safe-password')
        UserProfile.objects.create(user=self.staff, role='staff')
        self.citizen = User.objects.create_user(username='report-citizen@example.com', password='safe-password')
        UserProfile.objects.create(user=self.citizen, role='user')

    def make_application(self, identifier, submitted_date, burial_date=None, funeral_home=None):
        application = BurialApplication.objects.create(
            application_id=identifier, deceased_name='Report Person', deceased_date_of_death=submitted_date,
            applicant_name='Applicant', applicant_relationship='other', applicant_contact_email='a@example.com',
            applicant_contact_phone='09170000000', applicant_address='Lucena', burial_date=burial_date,
            funeral_home=funeral_home,
        )
        local_datetime = timezone.make_aware(datetime.combine(submitted_date, time(hour=12)))
        BurialApplication.objects.filter(pk=application.pk).update(submitted_at=local_datetime, created_at=local_datetime)
        return application

    def test_today_filters_mayor_cards_and_table_and_rejects_citizen(self):
        self.make_application('TODAY-REPORT', timezone.localdate())
        self.make_application('YESTERDAY-REPORT', timezone.localdate() - timedelta(days=1))
        self.client.force_authenticate(self.mayor)
        response = self.client.get('/api/reports/analytics/?period=today')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['metrics']['applications_submitted'], 1)
        self.assertNotIn('staff_operations', response.data)
        self.assertEqual([row['id'] for row in response.data['records']], ['TODAY-REPORT'])
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.get('/api/reports/analytics/?period=today').status_code, status.HTTP_403_FORBIDDEN)

    def test_custom_is_inclusive_invalid_range_rejected_and_cemetery_uses_burial_date(self):
        target = timezone.localdate() - timedelta(days=10)
        application = self.make_application('BURIAL-REPORT', timezone.localdate(), burial_date=target)
        # Operations reports count confirmed burials, not planned dates alone.
        application.status = 'completed'
        application.burial_executed_date = target
        application.save(update_fields=['status', 'burial_executed_date'])
        self.client.force_authenticate(self.staff)
        response = self.client.get(f'/api/reports/analytics/?period=custom&from={target}&to={target}')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['metrics']['burials'], 1)
        self.assertEqual([row['reference'] for row in response.data['staff_operations']['burials']], ['BURIAL-REPORT'])
        self.assertEqual([row['id'] for row in response.data['records']], ['BURIAL-REPORT'])
        invalid = self.client.get(f'/api/reports/analytics/?period=custom&from={target + timedelta(days=1)}&to={target}')
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)

    def test_calendar_period_boundaries_are_local_and_not_rolling_windows(self):
        today = timezone.localdate()
        week = get_report_date_range('week')
        month = get_report_date_range('month')
        year = get_report_date_range('year')
        self.assertEqual(week['start_date'].weekday(), 0)
        self.assertEqual(week['end_date'].weekday(), 6)
        self.assertEqual((week['end_date'] - week['start_date']).days, 6)
        self.assertEqual(month['start_date'], today.replace(day=1))
        self.assertEqual(year['start_date'], today.replace(month=1, day=1))
        self.assertEqual(year['end_date'], today.replace(month=12, day=31))
        self.assertTrue(timezone.is_aware(week['start_datetime']))
        self.assertTrue(timezone.is_aware(week['end_datetime_exclusive']))

    def test_appointment_metric_uses_scheduled_date(self):
        target = timezone.localdate() - timedelta(days=20)
        application = self.make_application('APPOINTMENT-REPORT', timezone.localdate())
        InterviewSchedule.objects.create(
            application=application, scheduled_date=target, scheduled_time=time(hour=9), location='CMO',
        )
        self.client.force_authenticate(self.mayor)
        response = self.client.get(f'/api/reports/analytics/?period=custom&from={target}&to={target}')
        self.assertEqual(response.data['metrics']['appointments_scheduled'], 1)
        self.assertEqual(response.data['metrics']['applications_submitted'], 0)

    def test_funeral_home_breakdown_uses_selected_submission_period(self):
        today = timezone.localdate()
        self.make_application('HOME-ONE', today, funeral_home='Alaala Funeral Homes')
        self.make_application('HOME-TWO', today, funeral_home='Alaala Funeral Homes')
        self.make_application('HOME-THREE', today, funeral_home='St. Jude Funeral Homes')
        self.make_application('HOME-OLD', today - timedelta(days=1), funeral_home='St. Jude Funeral Homes')
        self.client.force_authenticate(self.mayor)
        response = self.client.get('/api/reports/analytics/?period=today')
        breakdown = {item['funeral_home']: item['count'] for item in response.data['funeral_home_breakdown']}
        self.assertEqual(breakdown, {'Alaala Funeral Homes': 2, 'St. Jude Funeral Homes': 1})


class CPDOPhaseOneAPITests(APITestCase):
    def setUp(self):
        self.cpdo = User.objects.create_user(username='phase1-cpdo@example.com', password='safe-password')
        UserProfile.objects.create(user=self.cpdo, role='planning')
        self.citizen = User.objects.create_user(username='phase1-citizen@example.com', password='safe-password')
        UserProfile.objects.create(user=self.citizen, role='user')
        self.old = Cemetery.objects.create(code='old-test', name='Old Test Cemetery')
        self.new = Cemetery.objects.create(code='new-test', name='New Test Cemetery')
        self.old_section = CemeterySection.objects.create(cemetery=self.old, name='Old Section A', status='active', geometry={})
        self.new_section = CemeterySection.objects.create(cemetery=self.new, name='New Section A', status='active', geometry={})
        BurialPlot.objects.create(cemetery=self.old, section_record=self.old_section, plot_id='OLD-A-001', section='A', plot_number=1, status='available')
        BurialPlot.objects.create(cemetery=self.old, section_record=self.old_section, plot_id='OLD-A-002', section='A', plot_number=2, status='occupied')
        BurialPlot.objects.create(cemetery=self.new, section_record=self.new_section, plot_id='NEW-A-001', section='A', plot_number=1, status='maintenance')

    def test_public_reads_and_backend_filters_share_persistent_plots(self):
        self.assertEqual(self.client.get('/api/cemeteries/').status_code, status.HTTP_200_OK)
        response = self.client.get('/api/burial-plots/', {'cemetery': self.old.code, 'section': 'A', 'status': 'available'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['plot_id'] for row in response.data], ['OLD-A-001'])

    def test_summary_matches_database_and_section_counts(self):
        response = self.client.get('/api/burial-plots/summary/', {'cemetery': self.old.code})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 2)
        self.assertEqual(response.data['available'], 1)
        self.assertEqual(response.data['occupied'], 1)
        self.assertEqual(response.data['sections'][0]['total'], 2)

    def test_cross_cemetery_section_is_rejected(self):
        self.client.force_authenticate(self.cpdo)
        response = self.client.post('/api/burial-plots/', {
            'cemetery': self.old.id, 'section_record': self.new_section.id,
            'plot_id': 'INVALID-001', 'section': 'A', 'plot_number': 99, 'status': 'available',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_citizen_cannot_write_cpdo_data(self):
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.patch('/api/burial-plots/1/', {'status': 'occupied'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/cemeteries/', {'code': 'blocked', 'name': 'Blocked'}, format='json').status_code, status.HTTP_403_FORBIDDEN)

    def test_no_plot_is_allocated_by_reading_or_filtering(self):
        self.client.get('/api/burial-plots/summary/')
        self.assertEqual(BurialPlot.objects.filter(assigned_to__isnull=False).count(), 0)


class ColumbariumTransferAPITests(APITestCase):
    def setUp(self):
        self.staff = User.objects.create_user(username='niche-transfer-staff@example.com', password='safe-password')
        UserProfile.objects.create(user=self.staff, role='staff')
        self.citizen = User.objects.create_user(username='niche-transfer-citizen@example.com', password='safe-password')
        UserProfile.objects.create(user=self.citizen, role='user')
        self.source = ColumbariumSlot.objects.create(
            id='OLD-A-F1-C1', section='A', floor=1, col=1,
            cemetery_map='old', status='occupied', name='Deceased Person',
        )
        self.same_cemetery_destination = ColumbariumSlot.objects.create(
            id='OLD-A-F1-C2', section='A', floor=1, col=2,
            cemetery_map='old', status='available', name='',
        )
        self.other_cemetery_destination = ColumbariumSlot.objects.create(
            id='NEW-B-F1-C1', section='B', floor=1, col=1,
            cemetery_map='new', status='available', name='',
        )

    def test_staff_can_transfer_within_or_between_cemeteries(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            f'/api/columbariums/{self.source.pk}/transfer/',
            {'target_id': self.same_cemetery_destination.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.source.refresh_from_db()
        self.same_cemetery_destination.refresh_from_db()
        self.assertEqual((self.source.status, self.source.name), ('available', ''))
        self.assertEqual((self.same_cemetery_destination.status, self.same_cemetery_destination.name), ('occupied', 'Deceased Person'))

        response = self.client.post(
            f'/api/columbariums/{self.same_cemetery_destination.pk}/transfer/',
            {'target_id': self.other_cemetery_destination.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.same_cemetery_destination.refresh_from_db()
        self.other_cemetery_destination.refresh_from_db()
        self.assertEqual((self.same_cemetery_destination.status, self.same_cemetery_destination.name), ('available', ''))
        self.assertEqual((self.other_cemetery_destination.status, self.other_cemetery_destination.name), ('occupied', 'Deceased Person'))

    def test_transfer_rejects_unavailable_or_same_destination_without_changes(self):
        self.same_cemetery_destination.status = 'occupied'
        self.same_cemetery_destination.name = 'Another Person'
        self.same_cemetery_destination.save()
        self.client.force_authenticate(self.staff)

        occupied = self.client.post(
            f'/api/columbariums/{self.source.pk}/transfer/',
            {'target_id': self.same_cemetery_destination.pk},
            format='json',
        )
        same = self.client.post(
            f'/api/columbariums/{self.source.pk}/transfer/',
            {'target_id': self.source.pk},
            format='json',
        )
        self.assertEqual(occupied.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(same.status_code, status.HTTP_400_BAD_REQUEST)
        self.source.refresh_from_db()
        self.assertEqual((self.source.status, self.source.name), ('occupied', 'Deceased Person'))

    def test_transfer_requires_plot_management_permission(self):
        self.client.force_authenticate(self.citizen)
        response = self.client.post(
            f'/api/columbariums/{self.source.pk}/transfer/',
            {'target_id': self.same_cemetery_destination.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class CPDOPhaseTwoZoningAPITests(APITestCase):
    def setUp(self):
        self.cpdo = User.objects.create_user(username='phase2-cpdo@example.com', password='safe-password')
        UserProfile.objects.create(user=self.cpdo, role='planning')
        self.citizen = User.objects.create_user(username='phase2-citizen@example.com', password='safe-password')
        UserProfile.objects.create(user=self.citizen, role='user')
        self.old = Cemetery.objects.create(code='phase2-old', name='Phase 2 Old Cemetery')
        self.new = Cemetery.objects.create(code='phase2-new', name='Phase 2 New Cemetery')
        self.zone = CemeterySection.objects.create(
            cemetery=self.old, name='Zone Alpha', zone_code='OLD-A', description='Mapped administrative area',
            status='active', is_active=True, geometry={},
        )
        BurialPlot.objects.create(cemetery=self.old, section_record=self.zone, plot_id='ZA-001', section='Zone Alpha', plot_number=1, status='available')
        BurialPlot.objects.create(cemetery=self.old, section_record=self.zone, plot_id='ZA-002', section='Zone Alpha', plot_number=2, status='occupied')

    def test_zone_list_has_database_capacity_and_filters(self):
        response = self.client.get('/api/cemetery-sections/', {'cemetery': self.old.code, 'active': 'true', 'search': 'OLD-A'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['features']), 1)
        props = response.data['features'][0]['properties']
        self.assertEqual((props['total_plots'], props['available_plots'], props['occupied_plots']), (2, 1, 1))
        self.assertEqual(props['occupancy_percentage'], 50.0)

    def test_cpdo_can_create_edit_and_deactivate_metadata_without_geometry(self):
        self.client.force_authenticate(self.cpdo)
        created = self.client.post('/api/cemetery-sections/', {
            'cemetery': self.new.id, 'name': 'Zone Beta', 'zone_code': 'NEW-B',
            'description': 'Metadata only', 'status': 'planned', 'is_active': True,
        }, format='json')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        zone_id = created.data['id']
        changed = self.client.patch(f'/api/cemetery-sections/{zone_id}/', {'description': 'Updated', 'is_active': False}, format='json')
        self.assertEqual(changed.status_code, status.HTTP_200_OK)
        zone = CemeterySection.objects.get(pk=zone_id)
        self.assertFalse(zone.is_active)
        self.assertEqual(zone.description, 'Updated')

    def test_citizen_cannot_create_edit_or_deactivate_zone(self):
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.post('/api/cemetery-sections/', {'cemetery': self.old.id, 'name': 'Blocked', 'zone_code': 'BLOCK'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.patch(f'/api/cemetery-sections/{self.zone.id}/', {'is_active': False}, format='json').status_code, status.HTTP_403_FORBIDDEN)

    def test_zone_with_plots_is_preserved_and_cannot_change_cemetery(self):
        self.client.force_authenticate(self.cpdo)
        self.assertEqual(self.client.delete(f'/api/cemetery-sections/{self.zone.id}/').status_code, status.HTTP_409_CONFLICT)
        response = self.client.patch(f'/api/cemetery-sections/{self.zone.id}/', {'cemetery': self.new.id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.zone.refresh_from_db()
        self.assertEqual(self.zone.cemetery_id, self.old.id)

    def test_zone_filter_uses_same_plot_relationship_and_does_not_allocate(self):
        response = self.client.get('/api/burial-plots/', {'cemetery': self.old.code, 'section': str(self.zone.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(BurialPlot.objects.filter(assigned_to__isnull=False).count(), 0)


class CPDOSectionDrawingAPITests(APITestCase):
    OLD_BOUNDARY = {'type': 'LineString', 'coordinates': [[121.6199, 13.9390], [121.6201, 13.9392], [121.6219, 13.9390], [121.6218, 13.9383], [121.6213, 13.9378], [121.6208, 13.9374], [121.6199, 13.9390]]}
    NEW_BOUNDARY = {'type': 'LineString', 'coordinates': [[121.6200, 13.9328], [121.6200, 13.9296], [121.6218, 13.9296], [121.6218, 13.9328], [121.6200, 13.9328]]}

    def setUp(self):
        self.cpdo = User.objects.create_user(username='drawing-cpdo@example.com', password='safe-password')
        UserProfile.objects.create(user=self.cpdo, role='planning')
        self.citizen = User.objects.create_user(username='drawing-citizen@example.com', password='safe-password')
        UserProfile.objects.create(user=self.citizen, role='user')
        self.old = Cemetery.objects.create(code='draw-old', name='Drawing Old Cemetery', boundary_geometry=self.OLD_BOUNDARY)
        self.new = Cemetery.objects.create(code='draw-new', name='Drawing New Cemetery', boundary_geometry=self.NEW_BOUNDARY)
        self.old_polygon = {'type': 'Polygon', 'coordinates': [[[121.6203, 13.9388], [121.6207, 13.9388], [121.6207, 13.9385], [121.6203, 13.9385], [121.6203, 13.9388]]]}
        self.new_polygon = {'type': 'Polygon', 'coordinates': [[[121.6204, 13.9315], [121.6208, 13.9315], [121.6208, 13.9311], [121.6204, 13.9311], [121.6204, 13.9315]]]}

    def create_payload(self, cemetery, code, geometry):
        return {'cemetery': cemetery.id, 'name': f'Section {code}', 'zone_code': code, 'description': 'Drawn section', 'status': 'active', 'is_active': True, 'geometry': geometry}

    def test_cpdo_drawn_sections_persist_for_selected_old_and_new_cemetery(self):
        self.client.force_authenticate(self.cpdo)
        old_response = self.client.post('/api/cemetery-sections/', self.create_payload(self.old, 'OLD-D', self.old_polygon), format='json')
        new_response = self.client.post('/api/cemetery-sections/', self.create_payload(self.new, 'NEW-D', self.new_polygon), format='json')
        self.assertEqual(old_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(new_response.status_code, status.HTTP_201_CREATED)
        old_zone = CemeterySection.objects.get(zone_code='OLD-D')
        new_zone = CemeterySection.objects.get(zone_code='NEW-D')
        self.assertEqual(old_zone.cemetery, self.old)
        self.assertEqual(new_zone.cemetery, self.new)
        self.assertEqual(old_zone.geometry, self.old_polygon)
        refreshed = self.client.get('/api/cemetery-sections/', {'cemetery': self.old.code})
        self.assertIn('OLD-D', [feature['properties']['zone_code'] for feature in refreshed.data['features']])
        self.assertEqual(BurialPlot.objects.count(), 0)

    def test_citizen_cannot_save_drawn_section(self):
        self.client.force_authenticate(self.citizen)
        response = self.client.post('/api/cemetery-sections/', self.create_payload(self.old, 'BLOCKED', self.old_polygon), format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_invalid_or_outside_geometry_is_rejected(self):
        self.client.force_authenticate(self.cpdo)
        malformed = {'type': 'Polygon', 'coordinates': [[[121.6203, 13.9388], [121.6204, 13.9387], [121.6203, 13.9388]]]}
        outside = {'type': 'Polygon', 'coordinates': [[[121.6300, 13.9500], [121.6310, 13.9500], [121.6310, 13.9510], [121.6300, 13.9500]]]}
        self.assertEqual(self.client.post('/api/cemetery-sections/', self.create_payload(self.old, 'BAD', malformed), format='json').status_code, status.HTTP_400_BAD_REQUEST)
        response = self.client.post('/api/cemetery-sections/', self.create_payload(self.old, 'OUTSIDE', outside), format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('inside the selected cemetery boundary', str(response.data))

    def test_required_metadata_and_duplicate_code_are_rejected(self):
        self.client.force_authenticate(self.cpdo)
        missing = self.create_payload(self.old, '', self.old_polygon)
        missing['name'] = ''
        self.assertEqual(self.client.post('/api/cemetery-sections/', missing, format='json').status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.post('/api/cemetery-sections/', self.create_payload(self.old, 'DUP', self.old_polygon), format='json').status_code, status.HTTP_201_CREATED)
        duplicate = self.create_payload(self.old, 'DUP', self.old_polygon)
        duplicate['name'] = 'Another Section Name'
        self.assertEqual(self.client.post('/api/cemetery-sections/', duplicate, format='json').status_code, status.HTTP_400_BAD_REQUEST)

    def test_cpdo_confirms_grave_layout_and_capacity_is_persistent(self):
        self.client.force_authenticate(self.cpdo)
        created = self.client.post('/api/cemetery-sections/', self.create_payload(self.old, 'LAYOUT', self.old_polygon), format='json')
        response = self.client.post('/api/burial-plots/generate-layout/', {
            'section': created.data['id'], 'rows': 2, 'columns': 3, 'floors': 4, 'orientation': 'vertical',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['graves_created'], 6)
        self.assertEqual(response.data['total_floor_capacity'], 24)
        zone = CemeterySection.objects.get(pk=created.data['id'])
        self.assertEqual(zone.estimated_stack_height, 4)
        self.assertEqual(zone.layout_orientation, 'vertical')
        self.assertEqual(zone.ground_plots.count(), 6)
        self.assertTrue(all(plot.cemetery_id == self.old.id for plot in zone.ground_plots.all()))
        duplicate = self.client.post('/api/burial-plots/generate-layout/', {
            'section': zone.id, 'rows': 2, 'columns': 3, 'floors': 4,
        }, format='json')
        self.assertEqual(duplicate.status_code, status.HTTP_409_CONFLICT)
        updated = self.client.post('/api/burial-plots/generate-layout/', {
            'section': zone.id, 'rows': 3, 'columns': 2, 'floors': 2,
            'orientation': 'horizontal', 'replace_existing': True,
        }, format='json')
        self.assertEqual(updated.status_code, status.HTTP_201_CREATED)
        zone.refresh_from_db()
        self.assertEqual(zone.ground_plots.count(), 6)
        self.assertEqual(zone.estimated_stack_height, 2)
        self.assertEqual(zone.layout_orientation, 'horizontal')

    def test_citizen_cannot_generate_grave_layout(self):
        section = CemeterySection.objects.create(
            cemetery=self.old, name='Protected Layout', zone_code='PROTECTED',
            geometry=self.old_polygon, status='active',
        )
        self.client.force_authenticate(self.citizen)
        response = self.client.post('/api/burial-plots/generate-layout/', {
            'section': section.id, 'rows': 2, 'columns': 2, 'floors': 2,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(section.ground_plots.count(), 0)

    def test_archived_unused_layout_can_be_permanently_deleted(self):
        self.client.force_authenticate(self.cpdo)
        created = self.client.post('/api/cemetery-sections/', self.create_payload(self.old, 'REMOVE', self.old_polygon), format='json')
        section_id = created.data['id']
        generated = self.client.post('/api/burial-plots/generate-layout/', {
            'section': section_id, 'rows': 2, 'columns': 2, 'floors': 2,
        }, format='json')
        self.assertEqual(generated.status_code, status.HTTP_201_CREATED)
        self.client.patch(f'/api/cemetery-sections/{section_id}/', {'is_active': False}, format='json')
        deleted = self.client.delete(f'/api/cemetery-sections/{section_id}/')
        self.assertEqual(deleted.status_code, status.HTTP_200_OK)
        self.assertEqual(deleted.data['deleted_graves'], 4)
        self.assertFalse(CemeterySection.objects.filter(pk=section_id).exists())
        self.assertFalse(BurialPlot.objects.filter(section_record_id=section_id).exists())

        # Deletion markers hide legacy map geometry but must not reserve the
        # permanently deleted section's name or zone code.
        recreated = self.client.post('/api/cemetery-sections/', self.create_payload(self.old, 'REMOVE', self.old_polygon), format='json')
        self.assertEqual(recreated.status_code, status.HTTP_201_CREATED, recreated.data)
        self.assertNotEqual(recreated.data['id'], section_id)

    def test_archived_section_with_occupied_grave_is_protected(self):
        section = CemeterySection.objects.create(
            cemetery=self.old, name='Protected Occupied Section', zone_code='OCCUPIED',
            geometry=self.old_polygon, status='active', is_active=False,
        )
        BurialPlot.objects.create(
            cemetery=self.old, section_record=section, plot_id='OCCUPIED-001',
            section='OCCUPIED', plot_number=1, status='occupied',
        )
        self.client.force_authenticate(self.cpdo)
        response = self.client.delete(f'/api/cemetery-sections/{section.id}/')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(CemeterySection.objects.filter(pk=section.id).exists())


class RBACAPITests(APITestCase):
    def make_user(self, username, role):
        user = User.objects.create_user(username=username, password='safe-password')
        UserProfile.objects.create(user=user, role=role)
        return user

    def setUp(self):
        self.super_admin = self.make_user('cmo@example.com', 'mayor')
        self.cpdo = self.make_user('cpdo@example.com', 'planning')
        self.staff = self.make_user('staff@example.com', 'staff')
        self.citizen_a = self.make_user('citizen-a@example.com', 'user')
        self.citizen_b = self.make_user('citizen-b@example.com', 'user')
        self.grave = Grave.objects.create(grave_id='RBAC-1', name='Available', location='Section A')
        self.own_application = BurialApplication.objects.create(
            application_id='RBAC-OWN', deceased_name='Own Record', deceased_date_of_death=date.today(),
            applicant_name='Citizen A', applicant_relationship='other', applicant_contact_email='a@example.com',
            applicant_contact_phone='09170000000', applicant_address='Lucena', submitted_by=self.citizen_a,
        )
        self.other_application = BurialApplication.objects.create(
            application_id='RBAC-OTHER', deceased_name='Other Record', deceased_date_of_death=date.today(),
            applicant_name='Citizen B', applicant_relationship='other', applicant_contact_email='b@example.com',
            applicant_contact_phone='09170000001', applicant_address='Lucena', submitted_by=self.citizen_b,
        )

    def test_anonymous_can_read_public_map_data_but_cannot_manage_graves(self):
        self.assertEqual(self.client.get('/api/graves/').status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.post('/api/graves/', {}).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_citizen_only_sees_own_burial_application(self):
        self.client.force_authenticate(self.citizen_a)
        self.assertEqual(self.client.get(f'/api/burial-applications/{self.own_application.id}/').status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(f'/api/burial-applications/{self.other_application.id}/').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.patch(f'/api/graves/{self.grave.id}/', {'status': 'occupied'}).status_code, status.HTTP_403_FORBIDDEN)

    def test_application_list_includes_approval_and_burial_timestamps(self):
        now = timezone.now()
        BurialApplication.objects.filter(pk=self.own_application.pk).update(
            submitted_at=now - timedelta(minutes=30),
            approved_at=now - timedelta(minutes=15),
            completed_at=now,
        )
        self.client.force_authenticate(self.super_admin)
        response = self.client.get('/api/burial-applications/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        application = next(row for row in response.data if row['id'] == self.own_application.id)
        self.assertEqual(parse_datetime(application['submitted_at']), now - timedelta(minutes=30))
        self.assertEqual(parse_datetime(application['approved_at']), now - timedelta(minutes=15))
        self.assertEqual(parse_datetime(application['completed_at']), now)

    def test_staff_cannot_manage_users_or_cpdo_sections(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get('/api/users/').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post('/api/cemetery-sections/', {'name': 'RBAC Section', 'geometry': {}}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.patch(f'/api/graves/{self.grave.id}/', {'status': 'maintenance'}).status_code, status.HTTP_200_OK)

    def test_cpdo_can_manage_sections_but_not_users_or_cmo_workflow(self):
        self.client.force_authenticate(self.cpdo)
        self.assertEqual(self.client.post('/api/cemetery-sections/', {'name': 'RBAC Section', 'geometry': {}}, format='json').status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.client.get('/api/users/').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post(f'/api/burial-applications/{self.own_application.id}/approve/', {}).status_code, status.HTTP_403_FORBIDDEN)

    def test_super_admin_can_manage_users_and_roles(self):
        self.client.force_authenticate(self.super_admin)
        self.assertEqual(self.client.get('/api/users/').status_code, status.HTTP_200_OK)
        response = self.client.patch(f'/api/users/{self.staff.id}/', {'role': 'planning', 'permissions': ['manage_zoning']})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff.profile.refresh_from_db()
        self.assertEqual(self.staff.profile.role, 'planning')
        self.assertEqual(self.staff.profile.permissions, ['manage_zoning'])


class DocumentCompletenessAPITests(APITestCase):
    def make_user(self, username, role):
        user = User.objects.create_user(username=username, password='safe-password')
        UserProfile.objects.create(user=user, role=role)
        return user

    def setUp(self):
        self.reviewer = self.make_user('reviewer@example.com', 'mayor')
        self.citizen = self.make_user('owner@example.com', 'user')
        self.other_citizen = self.make_user('other@example.com', 'user')
        self.application = BurialApplication.objects.create(
            application_id='DOC-TEST', deceased_name='Test Record', deceased_date_of_death=date.today(),
            applicant_name='Owner', applicant_relationship='other', applicant_contact_email='owner@example.com',
            applicant_contact_phone='09170000000', applicant_address='Lucena', submitted_by=self.citizen,
        )
        settings = {
            'appointment_opening_time': '08:00', 'appointment_closing_time': '17:00',
            'appointment_duration_minutes': '30', 'appointment_slot_interval_minutes': '30',
            'appointment_maximum_simultaneous': '1', 'appointment_working_days': '0,1,2,3,4,5',
        }
        for key, value in settings.items():
            SystemSettings.objects.create(setting_key=key, setting_value=value)

    def upload(self, document_type, name='document.pdf'):
        self.client.force_authenticate(self.citizen)
        return self.client.post(
            f'/api/burial-applications/{self.application.id}/upload-documents/',
            {document_type: SimpleUploadedFile(name, b'%PDF-1.4 test', content_type='application/pdf')},
            format='multipart',
        )

    def review(self, document, review_status, remarks=''):
        self.client.force_authenticate(self.reviewer)
        return self.client.post(
            f'/api/burial-documents/{document.id}/review/',
            {'verification_status': review_status, 'verification_remarks': remarks},
            format='json',
        )

    def test_upload_defaults_to_pending_and_owner_isolation_is_enforced(self):
        response = self.upload(BurialDocument.DocumentType.DEATH_CERTIFICATE)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        document = BurialDocument.objects.get(application=self.application)
        self.assertEqual(document.verification_status, BurialDocument.VerificationStatus.PENDING_REVIEW)
        self.assertIsNone(document.verified_by)
        self.assertIsNone(document.verified_at)

        self.client.force_authenticate(self.other_citizen)
        self.assertEqual(self.client.get(f'/api/burial-documents/{document.id}/').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(f'/api/burial-documents/{document.id}/download/').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            self.client.post(f'/api/burial-applications/{self.application.id}/upload-documents/', {}, format='multipart').status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_citizen_and_non_cmo_cannot_review(self):
        self.upload(BurialDocument.DocumentType.DEATH_CERTIFICATE)
        document = BurialDocument.objects.get(application=self.application)
        self.client.force_authenticate(self.citizen)
        for review_status in ('complete', 'needs_correction'):
            response = self.client.post(
                f'/api/burial-documents/{document.id}/review/',
                {'verification_status': review_status}, format='json'
            )
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cmo_review_persists_decision_reviewer_timestamp_and_remarks(self):
        self.upload(BurialDocument.DocumentType.DEATH_CERTIFICATE)
        document = BurialDocument.objects.get(application=self.application)
        response = self.review(document, 'needs_correction', 'Please upload a readable copy.')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        document.refresh_from_db()
        self.assertEqual(document.verification_status, 'needs_correction')
        self.assertEqual(document.verification_note, 'Please upload a readable copy.')
        self.assertEqual(document.verified_by, self.reviewer)
        self.assertIsNotNone(document.verified_at)
        self.assertFalse(document.verified)

        response = self.review(document, 'complete')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        document.refresh_from_db()
        self.assertEqual(document.verification_status, 'complete')
        self.assertTrue(document.verified)

    def test_replacement_resets_review_and_does_not_duplicate_active_document(self):
        self.upload(BurialDocument.DocumentType.DEATH_CERTIFICATE)
        document = BurialDocument.objects.get(application=self.application)
        self.review(document, 'needs_correction', 'Unreadable')
        self.upload(BurialDocument.DocumentType.DEATH_CERTIFICATE, 'replacement.pdf')
        document.refresh_from_db()
        self.assertEqual(BurialDocument.objects.filter(application=self.application).count(), 1)
        self.assertEqual(document.verification_status, 'pending_review')
        self.assertEqual(document.verification_note, '')
        self.assertIsNone(document.verified_by)
        self.assertIsNone(document.verified_at)

    def test_completeness_states_and_no_automatic_final_approval(self):
        self.assertEqual(self.application.document_completeness['state'], 'incomplete')
        for document_type in BurialDocument.required_document_types():
            self.upload(document_type, f'{document_type}.pdf')
        self.application.refresh_from_db()
        self.assertEqual(self.application.document_completeness['state'], 'under_review')
        self.assertFalse(self.application.document_completeness['ready_for_further_processing'])

        first = self.application.documents.first()
        self.review(first, 'needs_correction', 'Correction required')
        self.assertEqual(self.application.document_completeness['state'], 'needs_correction')
        self.review(first, 'complete')
        for document in self.application.documents.exclude(pk=first.pk):
            self.review(document, 'complete')

        self.application.refresh_from_db()
        summary = self.application.document_completeness
        self.assertEqual(summary['state'], 'complete')
        self.assertTrue(summary['ready_for_further_processing'])
        self.assertEqual(summary['complete_count'], len(BurialDocument.required_document_types()))
        self.assertEqual(self.application.status, BurialApplication.ApplicationStatus.PENDING_REVIEW)

    def test_workflow_guard_rejects_unresolved_documents(self):
        self.client.force_authenticate(self.reviewer)
        response = self.client.post(f'/api/burial-applications/{self.application.id}/assign-plot/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_completed_document_review_moves_to_scheduling_not_final_approval(self):
        for document_type in BurialDocument.required_document_types():
            self.upload(document_type, f'{document_type}.pdf')
        for document in self.application.documents.all():
            self.review(document, 'complete')

        self.client.force_authenticate(self.reviewer)
        appointment_date = date.today() + timedelta(days=1)
        while appointment_date.weekday() == 6:
            appointment_date += timedelta(days=1)
        response = self.client.post(
            f'/api/burial-applications/{self.application.id}/complete-document-review/', {}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, BurialApplication.ApplicationStatus.DOCUMENTS_COMPLETE)
        self.assertIsNone(self.application.approved_at)

        response = self.client.post(
            f'/api/burial-applications/{self.application.id}/schedule-interview/',
            {
                'scheduled_date': appointment_date,
                'scheduled_time': '10:00:00',
                'location': "Mayor's Office",
                'notes': 'Bring original documents.',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, BurialApplication.ApplicationStatus.FOR_INTERVIEW)
        self.assertIsNone(self.application.approved_at)

        rescheduled_date = date.today() + timedelta(days=2)
        while rescheduled_date.weekday() == 6:
            rescheduled_date += timedelta(days=1)
        appointment_id = self.application.interview_schedule.id
        response = self.client.post(
            f'/api/interview-schedules/{appointment_id}/reschedule/',
            {
                'scheduled_date': rescheduled_date,
                'scheduled_time': '14:30:00',
                'location': "Mayor's Office",
                'notes': 'Rescheduled appointment.',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        appointment = InterviewSchedule.objects.get(pk=appointment_id)
        self.assertEqual(appointment.scheduled_date, rescheduled_date)
        self.assertEqual(appointment.scheduled_time.strftime('%H:%M:%S'), '14:30:00')
        self.assertEqual(appointment.application_id, self.application.id)

    def test_scheduler_rejects_sunday_lunch_past_and_conflicts(self):
        for document_type in BurialDocument.required_document_types():
            self.upload(document_type, f'{document_type}.pdf')
        for document in self.application.documents.all():
            self.review(document, 'complete')
        self.client.force_authenticate(self.reviewer)
        self.client.post(f'/api/burial-applications/{self.application.id}/complete-document-review/', {}, format='json')

        sunday = date.today() + timedelta(days=(6 - date.today().weekday()) % 7 or 7)
        base = {'duration_minutes': 5, 'location': "Mayor's Office", 'notes': ''}
        response = self.client.post(f'/api/burial-applications/{self.application.id}/schedule-interview/', {**base, 'scheduled_date': sunday, 'scheduled_time': '10:00'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        weekday = date.today() + timedelta(days=1)
        while weekday.weekday() == 6:
            weekday += timedelta(days=1)
        response = self.client.post(f'/api/burial-applications/{self.application.id}/schedule-interview/', {**base, 'scheduled_date': weekday, 'scheduled_time': '11:59'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self.client.post(f'/api/burial-applications/{self.application.id}/schedule-interview/', {**base, 'scheduled_date': weekday, 'scheduled_time': '13:00'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        other = BurialApplication.objects.create(
            application_id='DOC-CONFLICT', deceased_name='Conflict', deceased_date_of_death=date.today(),
            applicant_name='Other', applicant_relationship='other', applicant_contact_email='other@example.com',
            applicant_contact_phone='09170000002', applicant_address='Lucena', submitted_by=self.other_citizen,
            status=BurialApplication.ApplicationStatus.DOCUMENTS_COMPLETE,
        )
        for document_type in BurialDocument.required_document_types():
            BurialDocument.objects.create(application=other, document_type=document_type, document_file=SimpleUploadedFile(f'{document_type}.pdf', b'%PDF test'), verification_status='complete')
        response = self.client.post(f'/api/burial-applications/{other.id}/schedule-interview/', {**base, 'scheduled_date': weekday, 'scheduled_time': '13:04'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self.client.post(f'/api/burial-applications/{other.id}/schedule-interview/', {**base, 'scheduled_date': weekday, 'scheduled_time': '13:05'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_cancel_releases_slot_and_citizen_cannot_administer(self):
        appointment_date = date.today() + timedelta(days=1)
        while appointment_date.weekday() == 6:
            appointment_date += timedelta(days=1)
        self.application.status = BurialApplication.ApplicationStatus.FOR_INTERVIEW
        self.application.save()
        appointment = InterviewSchedule.objects.create(application=self.application, scheduled_date=appointment_date, scheduled_time='10:00', duration_minutes=30, location="Mayor's Office", created_by=self.reviewer)
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.get(f'/api/interview-schedules/{appointment.id}/').status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.post(f'/api/interview-schedules/{appointment.id}/cancel/', {}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.other_citizen)
        self.assertEqual(self.client.get(f'/api/interview-schedules/{appointment.id}/').status_code, status.HTTP_404_NOT_FOUND)
        self.client.force_authenticate(self.reviewer)
        self.assertEqual(self.client.post(f'/api/interview-schedules/{appointment.id}/cancel/', {'reason': 'Applicant requested'}, format='json').status_code, status.HTTP_200_OK)
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, 'cancelled')
