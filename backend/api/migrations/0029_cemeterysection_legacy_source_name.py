from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0028_cemeterysection_name_per_cemetery')]

    operations = [
        migrations.AddField(
            model_name='cemeterysection',
            name='legacy_source_name',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
    ]
