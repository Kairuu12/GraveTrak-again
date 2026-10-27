from datetime import date
from unittest.mock import patch
from types import SimpleNamespace
from django.test import SimpleTestCase, TestCase
from .models import BurialApplication
from .staff_reports import staff_operations_report


class StaffOperationsTests(SimpleTestCase):
    def test_snapshot_keeps_layouts_separate_and_flags_incomplete_records(self):
        slots = [SimpleNamespace(pk='1', cemetery_map='old', section='Section A', floor=1, col=1,
                    status='occupied', name='Recorded Person', maintenance_notes=''),
                 SimpleNamespace(pk='2', cemetery_map='new', section='Section B', floor=2, col=1,
                    status='maintenance', name='', maintenance_notes='Repair door')]
        plot = SimpleNamespace(plot_id='P1', cemetery=SimpleNamespace(code='old'),
            section_record=SimpleNamespace(name='Section A'), location_description='Row 1', maintenance_notes='Repair')
        with patch('api.staff_reports.ColumbariumSlot.objects') as slot_manager, \
             patch('api.staff_reports.BurialPlot.objects') as plot_manager, \
             patch('api.staff_reports.BurialApplication.objects') as apps, \
             patch('api.staff_reports.active_niches') as visible_slots, \
             patch('api.staff_reports.active_plots') as visible_plots:
            visible_slots.return_value.order_by.return_value = slots
            visible_plots.return_value.select_related.return_value = [plot]
            apps.filter.return_value.order_by.return_value = []
            report = staff_operations_report(date(2026, 1, 1), date(2026, 1, 31))
            self.assertEqual(sum(row['total'] for row in report['sections']), 2)
            self.assertEqual(len(report['checks']), 1)
            self.assertEqual(report['checks'][0]['reference'], '1')
            self.assertEqual(len(report['maintenance']), 2)
            self.assertEqual(report['maintenance'][1]['kind'], 'Ground layout')
            visible_slots.assert_called_once_with(slot_manager.all.return_value)
            visible_plots.assert_called_once_with(plot_manager.filter.return_value)
            apps.filter.assert_called_once_with(status='completed', burial_executed_date__range=(date(2026, 1, 1), date(2026, 1, 31)))


class CompletedBurialReportTests(TestCase):
    def test_uses_actual_date_and_confirmed_status_not_submission_or_schedule(self):
        def create(reference, status, scheduled, actual):
            BurialApplication.objects.create(application_id=reference, deceased_name='Test Person',
                deceased_date_of_death=date(2025, 12, 1), applicant_name='Test Applicant',
                applicant_contact_email='test@example.com', applicant_contact_phone='09123456789',
                applicant_address='Test address', applicant_relationship='relative',
                status=status, burial_date=scheduled, burial_executed_date=actual)
        create('INCLUDED', 'completed', date(2025, 12, 31), date(2026, 1, 2))
        create('SCHEDULED', 'scheduled', date(2026, 1, 2), None)
        create('PENDING', 'pending_review', date(2026, 1, 3), None)
        create('MISSING-ACTUAL', 'completed', date(2026, 1, 4), None)
        create('OUTSIDE', 'completed', date(2026, 1, 5), date(2026, 2, 1))
        create('UNCONFIRMED', 'scheduled', date(2026, 1, 5), date(2026, 1, 5))
        report = staff_operations_report(date(2026, 1, 1), date(2026, 1, 31))
        self.assertEqual(report['burials_basis'], 'actual_completion')
        self.assertEqual([row['reference'] for row in report['burials']], ['INCLUDED'])
        self.assertEqual(report['burials'][0]['date'], '2026-01-02')
