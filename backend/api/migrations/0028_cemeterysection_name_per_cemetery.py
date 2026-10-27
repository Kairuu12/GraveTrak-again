from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0027_philsms_delivery_states')]

    operations = [
        migrations.AlterField(
            model_name='cemeterysection',
            name='name',
            field=models.CharField(max_length=128),
        ),
        migrations.AddConstraint(
            model_name='cemeterysection',
            constraint=models.UniqueConstraint(
                fields=('cemetery', 'name'),
                name='unique_section_name_per_cemetery',
            ),
        ),
    ]
