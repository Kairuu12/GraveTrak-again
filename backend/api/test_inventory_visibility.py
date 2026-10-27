from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import BurialPlot, Cemetery, CemeterySection, ColumbariumSlot, RetiredCemeterySection, UserProfile
from .workflow import PlotAssignmentEngine


class InventoryVisibilityTests(APITestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(username='inventory-visibility')
        UserProfile.objects.update_or_create(user=user, defaults={'role': 'planning'})
        self.client.force_authenticate(user)
        self.cemetery, _ = Cemetery.objects.get_or_create(code='old', defaults={'name': 'Old Cemetery'})
        self.section = CemeterySection.objects.create(cemetery=self.cemetery, name='Section A', zone_code='ACTIVE-A', is_active=True)
        self.plot = BurialPlot.objects.create(cemetery=self.cemetery, section_record=self.section, section='A', plot_id='VIS-A-1', plot_number=1)
        self.niche = ColumbariumSlot.objects.get(cemetery_map='old', section='Section A', floor=1, col=1)

    def niche_ids(self):
        return {row['id'] for row in self.client.get('/api/columbariums/', {'scope': 'active'}).data}

    def plot_ids(self):
        return {row['id'] for row in self.client.get('/api/burial-plots/', {'scope': 'active'}).data}

    def test_orphans_hidden_but_real_legacy_sections_and_occupants_preserved(self):
        orphan = ColumbariumSlot.objects.create(id='VIS-ORPHAN', cemetery_map='old', section='another practice', floor=1, col=1, status='occupied', name='Preserved record')
        legacy = ColumbariumSlot.objects.get(cemetery_map='old', section='Section C', floor=1, col=1)
        self.assertNotIn(orphan.pk, self.niche_ids())
        self.assertIn(legacy.pk, self.niche_ids())
        orphan.refresh_from_db()
        self.assertEqual(orphan.name, 'Preserved record')

    def test_archive_hides_records_summary_and_assignment_restore_returns_same_records(self):
        self.assertIn(self.niche.pk, self.niche_ids())
        self.assertIn(self.plot.pk, self.plot_ids())
        response = self.client.patch(f'/api/cemetery-sections/{self.section.pk}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(self.niche.pk, self.niche_ids())
        self.assertNotIn(self.plot.pk, self.plot_ids())
        summary = self.client.get('/api/burial-plots/summary/', {'scope': 'active', 'section': self.section.pk})
        self.assertEqual(summary.data['total'], 0)
        self.assertIsNone(PlotAssignmentEngine.get_next_available_plot())
        self.assertTrue(ColumbariumSlot.objects.filter(pk=self.niche.pk).exists())
        self.client.patch(f'/api/cemetery-sections/{self.section.pk}/', {'is_active': True}, format='json')
        self.assertIn(self.niche.pk, self.niche_ids())
        self.assertIn(self.plot.pk, self.plot_ids())

    def test_archived_canonical_names_do_not_reappear_through_letter_aliases(self):
        letter = ColumbariumSlot.objects.create(id='VIS-A-LETTER', cemetery_map='old', section='A', floor=1, col=2)
        self.assertIn(letter.pk, self.niche_ids())
        self.section.is_active = False; self.section.save()
        self.assertNotIn(letter.pk, self.niche_ids())

    def test_retirement_survives_permanent_delete_and_blocks_legacy_resurrection(self):
        self.section.is_active = False; self.section.legacy_source_name = 'Section D'; self.section.save()
        response = self.client.delete(f'/api/cemetery-sections/{self.section.pk}/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(CemeterySection.objects.filter(pk=self.section.pk).exists())
        self.assertFalse(ColumbariumSlot.objects.filter(pk=self.niche.pk).exists())
        self.assertEqual(set(RetiredCemeterySection.objects.values_list('name', flat=True)), {'Section A', 'Section D'})
        residual = ColumbariumSlot.objects.create(id='VIS-RESIDUAL', cemetery_map='old', section='Section D', floor=9, col=1)
        self.assertNotIn(residual.pk, self.niche_ids())
        result = self.client.get('/api/cemetery-sections/')
        self.assertIn('Section A', [row['name'] for row in result.data['retired_sections']])
        self.assertFalse(any(feature['properties']['name'] == 'Section A' for feature in result.data['features']))
        create = self.client.post('/api/columbariums/create-section/', {'section': 'Section A', 'cemetery_map': 'old', 'floors': 1, 'columns': 1}, format='json')
        self.assertEqual(create.status_code, 409)

    def test_matching_name_in_other_cemetery_is_not_hidden(self):
        other = ColumbariumSlot.objects.create(id='VIS-NEW-A', cemetery_map='new', section='Section A', floor=1, col=1)
        self.section.is_active = False; self.section.save()
        self.assertNotIn(self.niche.pk, self.niche_ids())
        self.assertIn(other.pk, self.niche_ids())

    def test_renamed_saved_section_supersedes_legacy_alias_without_hiding_new_name(self):
        self.section.name = 'Garden A'; self.section.legacy_source_name = 'Section A'; self.section.save()
        self.niche.section = 'Garden A'; self.niche.save()
        stale = ColumbariumSlot.objects.get(cemetery_map='old', section='Section A', floor=2, col=1)
        self.assertIn(self.niche.pk, self.niche_ids())
        self.assertNotIn(stale.pk, self.niche_ids())

    def test_delete_protects_named_niche_even_if_status_is_incorrectly_available(self):
        self.section.is_active = False; self.section.save()
        self.niche.name = 'Preserved occupant'; self.niche.save()
        response = self.client.delete(f'/api/cemetery-sections/{self.section.pk}/')
        self.assertEqual(response.status_code, 409)
        self.assertTrue(CemeterySection.objects.filter(pk=self.section.pk).exists())
        self.niche.refresh_from_db()
        self.assertEqual(self.niche.name, 'Preserved occupant')

    def test_archived_records_cannot_be_managed_through_active_endpoint(self):
        self.section.is_active = False; self.section.save()
        response = self.client.post(f'/api/columbariums/{self.niche.pk}/maintenance/?scope=active', {'operation': 'start', 'notes': 'Repair', 'expected_updated_at': self.niche.updated_at.isoformat()}, format='json')
        self.assertEqual(response.status_code, 404)
