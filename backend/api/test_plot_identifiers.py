from datetime import date
from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.db import connection
from rest_framework.test import APITestCase

from .models import BurialApplication, BurialPlot, Cemetery, CemeterySection

migration = import_module('api.migrations.0033_standard_plot_identifiers')


class PlotIdentifierTests(APITestCase):
    def setUp(self):
        self.cemetery, _ = Cemetery.objects.get_or_create(code='old', defaults={'name': 'Old Cemetery'})
        self.section = CemeterySection.objects.create(cemetery=self.cemetery, name='Keep this section name', zone_code='NEW CODE')
        self.plot = BurialPlot.objects.create(cemetery=self.cemetery, section_record=self.section,
            plot_id='OLD-LOLOL-R01-C01', section='LOLOL', plot_number=1, status='occupied')
        self.editor = SimpleNamespace(connection=connection)

    def test_standardization_preserves_record_identity_occupancy_and_assignments(self):
        application = BurialApplication.objects.create(application_id='ID-TEST', deceased_name='Test deceased', deceased_date_of_death=date(2026, 1, 1),
            applicant_name='Test applicant', applicant_relationship='child', applicant_contact_email='test@example.com',
            applicant_contact_phone='09123456789', applicant_address='Lucena', status='completed', assigned_plot=self.plot)
        self.plot.occupied_by_application = application; self.plot.save()
        original_pk = self.plot.pk
        migration.standardize_plot_identifiers(apps, self.editor)
        self.plot.refresh_from_db(); application.refresh_from_db(); self.section.refresh_from_db()
        self.assertEqual(self.plot.plot_id, f'OLD-S{self.section.pk:03d}-R01-C01')
        self.assertEqual(self.plot.legacy_plot_id, 'OLD-LOLOL-R01-C01')
        self.assertEqual(self.plot.pk, original_pk)
        self.assertEqual(self.plot.status, 'occupied')
        self.assertEqual(application.assigned_plot_id, original_pk)
        self.assertEqual(self.plot.occupied_by_application_id, application.pk)
        self.assertEqual(self.section.name, 'Keep this section name')
        result = self.client.get('/api/burial-plots/', {'search': 'OLD-LOLOL'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual([row['plot_id'] for row in result.data], [self.plot.plot_id])
        migration.standardize_plot_identifiers(apps, self.editor)
        migration.restore_plot_identifiers(apps, self.editor)
        self.plot.refresh_from_db()
        self.assertEqual(self.plot.plot_id, 'OLD-LOLOL-R01-C01')

    def test_collision_aborts_without_overwriting_any_record(self):
        target = f'OLD-S{self.section.pk:03d}-R01-C01'
        other = BurialPlot.objects.create(cemetery=self.cemetery, plot_id=target, section='OTHER', plot_number=2)
        with self.assertRaises(RuntimeError):
            migration.standardize_plot_identifiers(apps, self.editor)
        self.plot.refresh_from_db(); other.refresh_from_db()
        self.assertEqual(self.plot.plot_id, 'OLD-LOLOL-R01-C01')
        self.assertEqual(other.plot_id, target)
