from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0031_alter_columbariumslot_options_alter_cemetery_name_and_more')]

    operations = [
        migrations.AddField(model_name=model, name=name, field=field)
        for model in ('burialplot', 'columbariumslot')
        for name, field in (
            ('maintenance_previous_status', models.CharField(max_length=20, blank=True, default='')),
            ('maintenance_notes', models.TextField(blank=True, default='')),
        )
    ] + [
        migrations.AlterField(
            model_name='columbariumslot', name='status',
            field=models.CharField(max_length=16, default='available', choices=[
                ('available', 'Available'), ('occupied', 'Occupied'), ('maintenance', 'Maintenance'),
            ]),
        ),
    ]
