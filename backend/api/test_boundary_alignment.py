import json
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from django.apps import apps
from django.conf import settings
from django.test import TestCase
from .models import Cemetery

alignment = import_module('api.migrations.0037_align_old_cemetery_west_boundary')


class BoundaryAlignmentTests(TestCase):
    def test_frontend_and_backend_share_exact_alignment_and_keep_other_sides(self):
        path = Path(settings.BASE_DIR).parent / 'frontend/src/data/oldCemeteryBoundary.json'
        self.assertEqual(json.loads(path.read_text()), alignment.ALIGNED)
        coordinates = alignment.ALIGNED['coordinates']
        self.assertEqual(coordinates[0], coordinates[-1])
        self.assertEqual(coordinates[2:7], alignment.PREVIOUS['coordinates'][2:7])

    def test_migration_is_reversible_and_preserves_custom_boundaries(self):
        cemetery, _ = Cemetery.objects.update_or_create(code='old', defaults={
            'name': 'Old Cemetery', 'boundary_geometry': alignment.PREVIOUS})
        editor = SimpleNamespace(connection=SimpleNamespace(alias='default'))
        alignment.forwards(apps, editor)
        cemetery.refresh_from_db()
        self.assertEqual(cemetery.boundary_geometry, alignment.ALIGNED)
        alignment.backwards(apps, editor)
        cemetery.refresh_from_db()
        self.assertEqual(cemetery.boundary_geometry, alignment.PREVIOUS)
        custom = {'type': 'LineString', 'coordinates': [[0,0],[1,0],[1,1],[0,0]]}
        cemetery.boundary_geometry = custom
        cemetery.save()
        alignment.forwards(apps, editor)
        cemetery.refresh_from_db()
        self.assertEqual(cemetery.boundary_geometry, custom)
