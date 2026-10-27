from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0018_cemetery_boundary_geometry'),
    ]

    operations = [
        migrations.AddField(
            model_name='cemeterysection',
            name='layout_orientation',
            field=models.CharField(
                choices=[('horizontal', 'Horizontal'), ('vertical', 'Vertical')],
                default='horizontal',
                max_length=16,
            ),
        ),
    ]
