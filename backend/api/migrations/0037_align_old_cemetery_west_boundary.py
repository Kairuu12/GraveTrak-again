"""Align the west edge to OSM way 262146173, inspected 2026-10-25.

Only the northwest/west/southwest vertices change. This is basemap alignment,
not a survey correction; plot and section coordinates are not changed.
"""
from importlib import import_module
from django.db import migrations


PREVIOUS = import_module('api.migrations.0018_cemetery_boundary_geometry').OLD_BOUNDARY
ALIGNED = {
    'type': 'LineString',
    'coordinates': [
        [121.6199905, 13.9390239],
        [121.6200737, 13.9391749],
        *PREVIOUS['coordinates'][2:7],
        [121.6208461, 13.9373969],
        [121.6199905, 13.9390239],
    ],
}


def replace_known_boundary(apps, schema_editor, source, target):
    Cemetery = apps.get_model('api', 'Cemetery')
    for cemetery in Cemetery.objects.using(schema_editor.connection.alias).filter(code='old'):
        # Do not overwrite a separately edited boundary in another deployment.
        if cemetery.boundary_geometry == source:
            cemetery.boundary_geometry = target
            cemetery.save(using=schema_editor.connection.alias, update_fields=['boundary_geometry'])


def forwards(apps, schema_editor):
    replace_known_boundary(apps, schema_editor, PREVIOUS, ALIGNED)


def backwards(apps, schema_editor):
    replace_known_boundary(apps, schema_editor, ALIGNED, PREVIOUS)


class Migration(migrations.Migration):
    dependencies = [('api', '0036_email_verification')]
    operations = [migrations.RunPython(forwards, backwards)]
