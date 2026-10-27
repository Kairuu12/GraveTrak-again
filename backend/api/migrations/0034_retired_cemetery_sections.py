from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('api', '0033_standard_plot_identifiers')]
    operations = [
        migrations.CreateModel(
            name='RetiredCemeterySection',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=128)),
                ('cemetery', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='retired_sections', to='api.cemetery')),
            ],
        ),
        migrations.AddConstraint(model_name='retiredcemeterysection', constraint=models.UniqueConstraint(fields=('cemetery', 'name'), name='unique_retired_section_name')),
    ]
