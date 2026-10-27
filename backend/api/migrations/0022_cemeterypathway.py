from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('api', '0021_burial_application_client_and_family_composition')]

    operations = [
        migrations.CreateModel(
            name='CemeteryPathway',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=128)),
                ('pathway_type', models.CharField(choices=[('walkway', 'Walkway'), ('road', 'Road'), ('access', 'Access Path')], default='walkway', max_length=24)),
                ('width_meters', models.DecimalField(decimal_places=2, default=2, max_digits=5)),
                ('description', models.TextField(blank=True)),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('geometry', models.JSONField(default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('cemetery', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='pathways', to='api.cemetery')),
            ],
            options={'ordering': ['name']},
        ),
        migrations.AddConstraint(
            model_name='cemeterypathway',
            constraint=models.UniqueConstraint(fields=('cemetery', 'name'), name='unique_pathway_name_per_cemetery'),
        ),
    ]
