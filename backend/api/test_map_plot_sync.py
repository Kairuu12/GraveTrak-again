from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from api.inventory_visibility import active_plots
from api.management.commands.sync_old_map_plots import sync_old_map_plots
from api.models import BurialPlot, Cemetery, CemeterySection, ColumbariumSlot, RetiredCemeterySection
from api.views import BurialPlotViewSet


class MapPlotSyncTests(TestCase):
    def setUp(self):
        self.cemetery = Cemetery.objects.get(code='old')

    def test_persists_original_cells_once_and_preserves_niches(self):
        before = list(ColumbariumSlot.objects.order_by('pk').values())
        self.assertEqual(sync_old_map_plots(), (14, 1176))
        self.assertEqual(sync_old_map_plots(), (0, 0))
        self.assertEqual(active_plots(BurialPlot.objects.all()).count(), 1176)
        self.assertEqual(BurialPlot.objects.exclude(status='available').count(), 0)
        self.assertEqual(list(ColumbariumSlot.objects.order_by('pk').values()), before)
        section = CemeterySection.objects.get(cemetery=self.cemetery, name='Section A')
        self.assertEqual(section.geometry['plot_layout'], 'legacy-two-sided')
        self.assertEqual(section.ground_plots.get(plot_number=43).legacy_plot_id, 'Section A-C43')

    def test_does_not_resurrect_archived_renamed_or_deleted_sections(self):
        CemeterySection.objects.create(cemetery=self.cemetery, name='Section A', is_active=False)
        CemeterySection.objects.create(cemetery=self.cemetery, name='Garden B', legacy_source_name='Section B')
        RetiredCemeterySection.objects.create(cemetery=self.cemetery, name='Section C')
        self.assertEqual(sync_old_map_plots(), (11, 924))
        self.assertFalse(BurialPlot.objects.filter(section__in=['A', 'B', 'C']).exists())

    def test_keeps_existing_status_ids_and_custom_layout(self):
        section = CemeterySection.objects.create(cemetery=self.cemetery, name='Section A', status='maintenance')
        plot = BurialPlot.objects.create(cemetery=self.cemetery, section_record=section,
            section='A', plot_number=1, plot_id='EXISTING', status='maintenance',
            maintenance_previous_status='occupied', maintenance_notes='Preserve this')
        before = BurialPlot.objects.filter(pk=plot.pk).values().get()
        self.assertEqual(sync_old_map_plots(), (13, 1092))
        self.assertEqual(BurialPlot.objects.filter(pk=plot.pk).values().get(), before)

    def test_preview_rolls_back_and_inactive_cemetery_is_not_imported(self):
        call_command('sync_old_map_plots', stdout=StringIO())
        self.assertEqual(CemeterySection.objects.filter(cemetery=self.cemetery).count(), 0)
        self.assertEqual(BurialPlot.objects.count(), 0)
        self.cemetery.is_active = False
        self.cemetery.save()
        self.assertEqual(sync_old_map_plots(), (0, 0))

    def test_summary_reconciles_statuses_across_sections_and_plot_numbers(self):
        sync_old_map_plots()
        plots = BurialPlot.objects.order_by('pk')
        plots.filter(pk=plots.first().pk).update(status='occupied')
        plots.filter(pk=plots.last().pk).update(status='maintenance')
        response = BurialPlotViewSet.as_view({'get': 'summary'})(
            APIRequestFactory().get('/api/burial-plots/summary/', {'scope': 'active', 'cemetery': 'old'}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['total'], 1176)
        self.assertEqual(response.data['available'], 1174)
        self.assertEqual(response.data['occupied'], 1)
        self.assertEqual(response.data['maintenance'], 1)
        self.assertEqual(sum(response.data['by_status'].values()), response.data['total'])
