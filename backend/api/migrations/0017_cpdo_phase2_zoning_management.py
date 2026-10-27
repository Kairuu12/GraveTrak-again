from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0016_cpdo_phase1_foundation')]

    operations = [
        migrations.AddField(
            model_name='cemeterysection', name='description',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='cemeterysection', name='display_order',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='cemeterysection', name='is_active',
            field=models.BooleanField(db_index=True, default=True),
        ),
        migrations.AddField(
            model_name='cemeterysection', name='zone_code',
            field=models.CharField(blank=True, db_index=True, max_length=32),
        ),
        migrations.AlterField(
            model_name='cemeterysection', name='geometry',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AlterModelOptions(
            name='cemeterysection', options={'ordering': ['display_order', 'name']},
        ),
        migrations.AddConstraint(
            model_name='cemeterysection',
            constraint=models.UniqueConstraint(
                condition=~models.Q(zone_code=''),
                fields=('cemetery', 'zone_code'),
                name='unique_zone_code_per_cemetery',
            ),
        ),
    ]
