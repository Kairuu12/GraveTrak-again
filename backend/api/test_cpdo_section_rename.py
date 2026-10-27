from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import BurialPlot, Cemetery, CemeterySection, ColumbariumSlot, UserProfile


class CPDOSectionRenameTests(APITestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(username='section-rename-cpdo')
        UserProfile.objects.update_or_create(user=user, defaults={'role': 'planning'})
        self.client.force_authenticate(user=user)
        self.cemetery, _ = Cemetery.objects.get_or_create(code='new', defaults={'name': 'New Cemetery'})

    def test_zone_code_conflict_identifies_owner_and_length_is_not_duplicate(self):
        owner = CemeterySection.objects.create(cemetery=self.cemetery, name='Cluster 2', zone_code='OLD CLUSTER 1')
        for active in (True, False):
            owner.is_active = active
            owner.save()
            response = self.client.post('/api/cemetery-sections/', {
                'cemetery': self.cemetery.pk, 'name': 'Cluster 1', 'zone_code': 'old cluster 1',
            }, format='json')
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn('Cluster 2', str(response.data['zone_code']))
            self.assertIn('active' if active else 'archived', str(response.data['zone_code']))
        too_long = self.client.post('/api/cemetery-sections/', {
            'cemetery': self.cemetery.pk, 'name': 'Cluster 1', 'zone_code': 'X' * 33,
        }, format='json')
        self.assertEqual(too_long.status_code, 400)
        self.assertIn('32', str(too_long.data['zone_code']))
        self.assertNotIn('already used', str(too_long.data['zone_code']))

    def test_changing_code_preserves_records_and_frees_previous_code(self):
        section = CemeterySection.objects.create(cemetery=self.cemetery, name='Cluster 2', zone_code='OLD CLUSTER 1')
        plot = BurialPlot.objects.create(cemetery=self.cemetery, section_record=section,
            plot_id='CODE-SAFETY-R01-C01', section='OLD CLUSTE', plot_number=1, status='occupied')
        slot = ColumbariumSlot.objects.create(id='CODE-SAFETY-F1-C1', section='Cluster 2',
            cemetery_map='new', floor=1, col=1, status='occupied', name='Existing record')
        response = self.client.patch(f'/api/cemetery-sections/{section.pk}/', {'zone_code': 'OLD CLUSTER 2'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        plot.refresh_from_db()
        slot.refresh_from_db()
        self.assertEqual(plot.plot_id, 'CODE-SAFETY-R01-C01')
        self.assertEqual(plot.status, 'occupied')
        self.assertEqual(slot.name, 'Existing record')
        self.assertEqual(slot.section, 'Cluster 2')
        created = self.client.post('/api/cemetery-sections/', {
            'cemetery': self.cemetery.pk, 'name': 'Cluster 1', 'zone_code': 'OLD CLUSTER 1',
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)

    def test_saved_section_rename_preserves_plot_and_occupied_niche(self):
        old_cemetery, _ = Cemetery.objects.get_or_create(code='old', defaults={'name': 'Old Cemetery'})
        CemeterySection.objects.create(cemetery=old_cemetery, name='Memorial Garden', zone_code='OLD-MG')
        section = CemeterySection.objects.create(cemetery=self.cemetery, name='Section A', zone_code='NEW-A')
        plot = BurialPlot.objects.create(
            cemetery=self.cemetery, section_record=section, plot_id='NEW-A-R01-C01',
            section='NEW-A', plot_number=1, location_description='Section A, Row 1, Column 1',
        )
        slot = ColumbariumSlot.objects.create(
            id='NEW-SECTION-A-F1-C1', section='Section A', cemetery_map='new',
            floor=1, col=1, status='occupied', name='Existing occupant',
        )

        response = self.client.patch(
            f'/api/cemetery-sections/{section.pk}/',
            {'name': 'Memorial Garden', 'zone_code': 'NEW-MG', 'legacy_source_name': 'Section A'},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        section.refresh_from_db()
        plot.refresh_from_db()
        slot.refresh_from_db()
        self.assertEqual(section.name, 'Memorial Garden')
        self.assertEqual(section.legacy_source_name, 'Section A')
        self.assertEqual(plot.section, 'NEW-MG')
        self.assertEqual(plot.location_description, 'Memorial Garden, Row 1, Column 1')
        self.assertEqual(slot.section, 'Memorial Garden')
        self.assertEqual(slot.status, 'occupied')
        self.assertEqual(slot.name, 'Existing occupant')
        self.assertEqual(slot.pk, 'NEW-SECTION-A-F1-C1')

    def test_legacy_section_upgrade_moves_existing_niches_to_new_name(self):
        slot = ColumbariumSlot.objects.create(
            id='NEW-SECTION-B-F1-C1', section='Section B', cemetery_map='new',
            floor=1, col=1, status='occupied', name='Existing occupant',
        )
        response = self.client.post('/api/columbariums/create-section/', {
            'section': 'Garden B', 'previous_section': 'Section B',
            'cemetery_map': 'new', 'floors': 1, 'columns': 1,
        }, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        slot.refresh_from_db()
        self.assertEqual(slot.section, 'Garden B')
        self.assertEqual(slot.status, 'occupied')
        self.assertEqual(slot.name, 'Existing occupant')
        self.assertEqual(slot.pk, 'NEW-SECTION-B-F1-C1')

    def test_permanently_deleting_archived_section_removes_available_niches(self):
        section = CemeterySection.objects.create(
            cemetery=self.cemetery, name='Trial Section', zone_code='NEW-TRIAL', is_active=True,
        )
        slot = ColumbariumSlot.objects.create(
            id='NEW-TRIAL-F1-C1', section='Trial Section', cemetery_map='new',
            floor=1, col=1, status='available', name='',
        )

        archive = self.client.patch(f'/api/cemetery-sections/{section.pk}/', {'is_active': False}, format='json')
        response = self.client.delete(f'/api/cemetery-sections/{section.pk}/')

        self.assertEqual(archive.status_code, 200, archive.data)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['deleted_niches'], 1)
        self.assertFalse(CemeterySection.objects.filter(pk=section.pk).exists())
        self.assertFalse(ColumbariumSlot.objects.filter(pk=slot.pk).exists())
