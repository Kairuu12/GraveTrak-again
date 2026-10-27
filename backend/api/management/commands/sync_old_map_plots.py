"""Persist missing original Old Cemetery map layouts, without recreating retired sections."""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.inventory_visibility import normalized_section
from api.models import BurialPlot, Cemetery, CemeterySection, RetiredCemeterySection


def sync_old_map_plots():
    features = json.loads((Path(__file__).resolve().parents[2] / 'data' / 'old_map_sections.json').read_text())
    created_sections = created_plots = 0
    with transaction.atomic():
        cemetery = Cemetery.objects.select_for_update().get(code='old')
        if not cemetery.is_active:
            return (0, 0)
        managed = {
            normalized_section(name)
            for section in CemeterySection.objects.filter(cemetery=cemetery)
            for name in (section.name, section.legacy_source_name) if name
        }
        managed.update(normalized_section(name) for name in RetiredCemeterySection.objects.filter(
            cemetery=cemetery).values_list('name', flat=True))
        for feature in features:
            letter = feature['properties']['id']
            name = f'Section {letter}'
            # Existing, renamed, archived and deleted sections are authoritative.
            # Never regenerate their layouts or reset their plot statuses.
            if normalized_section(name) in managed:
                continue
            # Unlinked historical records need manual reconciliation, not duplicates.
            if BurialPlot.objects.filter(cemetery=cemetery, section_record__isnull=True,
                                         section__in=[letter, name]).exists():
                raise CommandError(f'Unlinked records exist for {name}; reconcile them before importing.')
            geometry = {**feature['geometry'], 'plot_layout': 'legacy-two-sided'}
            section = CemeterySection.objects.create(
                cemetery=cemetery, name=name, legacy_source_name=name,
                status='active', is_active=True, geometry=geometry,
                estimated_stack_height=4, layout_orientation='horizontal',
            )
            p0, p1, p2, p3 = geometry['coordinates'][0][:4]
            def interpolate(start, end, fraction):
                return [a + (b - a) * fraction for a, b in zip(start, end)]
            plots = []
            for row in range(1, 3):
                for column in range(1, 43):
                    left = interpolate(p3, p2, (column - .5) / 42)
                    right = interpolate(p0, p1, (column - .5) / 42)
                    lng, lat = interpolate(left, right, (row - .5) / 2)
                    plots.append(BurialPlot(
                        cemetery=cemetery, section_record=section, section=letter,
                        plot_id=f'OLD-S{section.pk:03d}-R{row:02d}-C{column:02d}',
                        legacy_plot_id=f'Section {letter}-C{(row - 1) * 42 + column}',
                        plot_number=(row - 1) * 42 + column,
                        location_description=f'{name}, Row {row}, Column {column}',
                        longitude=lng, latitude=lat, status='available',
                    ))
            BurialPlot.objects.bulk_create(plots)
            created_sections += 1
            created_plots += len(plots)
    return created_sections, created_plots


class Command(BaseCommand):
    help = 'Save missing original Old Cemetery sections and plot layouts. Existing records are preserved.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Commit the import; otherwise roll it back.')

    def handle(self, *args, **options):
        with transaction.atomic():
            sections, plots = sync_old_map_plots()
            if not options['apply']:
                transaction.set_rollback(True)
            mode = 'Saved' if options['apply'] else 'Preview (rolled back)'
            self.stdout.write(f'{mode}: {sections} sections, {plots} plot records.')
