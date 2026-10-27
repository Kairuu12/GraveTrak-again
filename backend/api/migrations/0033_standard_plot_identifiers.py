import re

from django.db import migrations, models


def standardize_plot_identifiers(apps, schema_editor):
    Plot = apps.get_model('api', 'BurialPlot')
    plots = list(Plot.objects.using(schema_editor.connection.alias).select_related('cemetery').all())
    existing = {plot.plot_id: plot.pk for plot in plots}
    changes = []
    targets = set()
    for plot in plots:
        position = re.search(r'-R(\d+)-C(\d+)$', plot.plot_id, re.I)
        if not position or not plot.section_record_id or not plot.cemetery_id:
            continue
        code = re.sub(r'[^A-Z0-9]+', '-', plot.cemetery.code.upper()).strip('-') or 'CEM'
        row, col = map(int, position.groups())
        identifier = f'{code}-S{plot.section_record_id:03d}-R{row:02d}-C{col:02d}'
        if identifier == plot.plot_id:
            continue
        if len(identifier) > 50 or identifier in targets or identifier in existing:
            raise RuntimeError(f'Cannot safely standardize plot {plot.pk}: identifier collision or invalid length.')
        targets.add(identifier)
        plot.legacy_plot_id = plot.legacy_plot_id or plot.plot_id
        plot.plot_id = identifier
        changes.append(plot)
    Plot.objects.using(schema_editor.connection.alias).bulk_update(changes, ['plot_id', 'legacy_plot_id'])


def restore_plot_identifiers(apps, schema_editor):
    Plot = apps.get_model('api', 'BurialPlot')
    db = schema_editor.connection.alias
    rows = list(Plot.objects.using(db).exclude(legacy_plot_id=''))
    existing = set(Plot.objects.using(db).values_list('plot_id', flat=True))
    aliases = [plot.legacy_plot_id for plot in rows]
    if len(aliases) != len(set(aliases)) or any(alias in existing for alias in aliases):
        raise RuntimeError('Cannot safely restore legacy plot identifiers: a legacy ID is already in use.')
    for plot in rows:
        plot.plot_id = plot.legacy_plot_id
        plot.legacy_plot_id = ''
    Plot.objects.using(db).bulk_update(rows, ['plot_id', 'legacy_plot_id'])


class Migration(migrations.Migration):
    dependencies = [('api', '0032_individual_plot_maintenance')]
    operations = [
        migrations.AddField(model_name='burialplot', name='legacy_plot_id', field=models.CharField(max_length=50, blank=True, default='', db_index=True)),
        migrations.RunPython(standardize_plot_identifiers, restore_plot_identifiers),
    ]
