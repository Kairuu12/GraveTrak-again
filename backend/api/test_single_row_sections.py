from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import Cemetery, CemeterySection, ColumbariumSlot, UserProfile


class SingleRowSectionTests(APITestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(username='single-row-cpdo')
        UserProfile.objects.update_or_create(user=user, defaults={'role': 'planning'})
        self.client.force_authenticate(user)
        self.cemetery, _ = Cemetery.objects.get_or_create(code='old', defaults={'name': 'Old Cemetery'})
        self.section = CemeterySection.objects.create(
            cemetery=self.cemetery, name='Bone Crypt Trial', zone_code='BC-TRIAL', is_active=True,
            geometry={'type': 'Polygon', 'coordinates': [[[121.6203, 13.9388], [121.6207, 13.9388],
                [121.6207, 13.9385], [121.6203, 13.9385], [121.6203, 13.9388]]]},
        )

    def generate(self, rows=1, columns=12, floors=4, replace=False):
        return self.client.post('/api/burial-plots/generate-layout/', {
            'section': self.section.pk, 'rows': rows, 'columns': columns, 'floors': floors,
            'orientation': 'horizontal', 'replace_existing': replace,
        }, format='json')

    def niches(self, **extra):
        return self.client.post('/api/columbariums/create-section/', {
            'section': self.section.name, 'cemetery_map': 'old', 'columns': 12, 'floors': 4, **extra,
        }, format='json')

    def test_single_row_persists_and_resync_does_not_double_slots(self):
        response = self.generate()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['graves_created'], 12)
        self.assertEqual(response.data['total_floor_capacity'], 48)
        self.section.refresh_from_db()
        self.assertEqual((self.section.layout_rows, self.section.layout_columns), (1, 12))
        saved = self.client.get(f'/api/cemetery-sections/{self.section.pk}/').data
        self.assertEqual(saved['properties']['layout_rows'], 1)
        self.assertEqual(saved['properties']['layout_columns'], 12)
        for extra in ({'rows': 1}, {}, {'rows': 1}):
            slots = self.niches(**extra)
            self.assertIn(slots.status_code, (200, 201), slots.data)
            self.assertEqual(len(slots.data), 48)
            self.assertEqual(max(slot['col'] for slot in slots.data), 12)

    def test_double_row_and_legacy_default_remain_supported(self):
        self.assertEqual(self.generate(rows=2).status_code, 201)
        response = self.niches()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data), 96)
        self.section.layout_rows = self.section.layout_columns = None
        self.section.save()
        self.assertEqual(len(self.niches().data), 96)

    def test_conflicting_and_invalid_rows_do_not_change_inventory(self):
        self.generate()
        self.niches(rows=1)
        for value in (0, 3, 1.5, True, 'bad'):
            response = self.niches(rows=value)
            self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(self.niches(rows=2).status_code, 409)
        self.assertEqual(ColumbariumSlot.objects.filter(section=self.section.name).count(), 48)

    def test_empty_section_can_change_to_one_row(self):
        self.generate(rows=2)
        self.niches(rows=2)
        self.assertEqual(self.generate(rows=1, replace=True).status_code, 201)
        response = self.niches(rows=1)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 48)

    def test_occupied_niche_blocks_layout_change_and_preserves_records(self):
        self.generate(rows=2)
        self.niches(rows=2)
        slot = ColumbariumSlot.objects.filter(section=self.section.name, col=20, floor=1).get()
        slot.status = 'occupied'
        slot.name = 'Existing record'
        slot.save()
        response = self.generate(rows=1, replace=True)
        self.assertEqual(response.status_code, 409, response.data)
        self.section.refresh_from_db()
        self.assertEqual(self.section.layout_rows, 2)
        self.assertEqual(self.section.ground_plots.count(), 24)
        slot.refresh_from_db()
        self.assertEqual(slot.name, 'Existing record')

    def test_front_only_level_increase_preserves_occupied_slot(self):
        self.generate()
        self.niches(rows=1)
        slot = ColumbariumSlot.objects.filter(section=self.section.name, col=12, floor=4).get()
        slot.status, slot.name = 'occupied', 'Existing record'
        slot.save()
        response = self.niches(rows=1, floors=5)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 60)
        self.assertEqual(self.niches(rows=1, floors=3).status_code, 409)
        slot.refresh_from_db()
        self.assertEqual(slot.name, 'Existing record')

    def test_section_edit_cannot_move_boundary_or_hide_occupied_levels(self):
        self.generate()
        self.niches(rows=1)
        slot = ColumbariumSlot.objects.filter(section=self.section.name, col=12, floor=4).get()
        slot.status, slot.name = 'occupied', 'Existing record'
        slot.save()
        url = f'/api/cemetery-sections/{self.section.pk}/'
        self.assertEqual(self.client.patch(url, {'estimated_stack_height': 3}, format='json').status_code, 400)
        moved = {'type': 'Polygon', 'coordinates': [[[121.6204, 13.9388], [121.6207, 13.9388],
            [121.6207, 13.9385], [121.6204, 13.9385], [121.6204, 13.9388]]]}
        self.assertEqual(self.client.patch(url, {'geometry': moved}, format='json').status_code, 400)
        self.section.refresh_from_db()
        self.assertEqual(self.section.estimated_stack_height, 4)
        self.assertNotEqual(self.section.geometry, moved)
