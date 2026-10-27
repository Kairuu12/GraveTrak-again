from django.db import migrations, models
import django.db.models.deletion


def seed_cemeteries(apps, schema_editor):
    Cemetery = apps.get_model('api', 'Cemetery')
    CemeterySection = apps.get_model('api', 'CemeterySection')
    BurialPlot = apps.get_model('api', 'BurialPlot')

    old, _ = Cemetery.objects.get_or_create(
        code='old', defaults={'name': 'Lucena Old Public Cemetery', 'is_active': True}
    )
    Cemetery.objects.get_or_create(
        code='new', defaults={'name': 'Lucena New Public Cemetery', 'is_active': True}
    )
    # Legacy rows had no cemetery discriminator. Preserve them and associate
    # them with the map they historically appeared on (Old Map).
    CemeterySection.objects.filter(cemetery__isnull=True).update(cemetery=old)
    BurialPlot.objects.filter(cemetery__isnull=True).update(cemetery=old)


class Migration(migrations.Migration):
    dependencies = [('api', '0015_interviewschedule_scheduling_fields')]

    operations = [
        migrations.CreateModel(
            name='Cemetery',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.SlugField(max_length=32, unique=True)),
                ('name', models.CharField(max_length=128, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'verbose_name_plural': 'Cemeteries', 'ordering': ['name']},
        ),
        migrations.AddField(
            model_name='cemeterysection', name='cemetery',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='sections', to='api.cemetery'),
        ),
        migrations.AddField(
            model_name='burialplot', name='cemetery',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='ground_plots', to='api.cemetery'),
        ),
        migrations.AddField(
            model_name='burialplot', name='section_record',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='ground_plots', to='api.cemeterysection'),
        ),
        migrations.RunPython(seed_cemeteries, migrations.RunPython.noop),
    ]
