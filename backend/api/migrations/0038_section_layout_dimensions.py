from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0037_align_old_cemetery_west_boundary')]
    operations = [
        migrations.AddField(model_name='cemeterysection', name='layout_rows',
                            field=models.PositiveIntegerField(blank=True, null=True)),
        migrations.AddField(model_name='cemeterysection', name='layout_columns',
                            field=models.PositiveIntegerField(blank=True, null=True)),
    ]
