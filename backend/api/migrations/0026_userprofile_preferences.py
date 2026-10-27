from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0025_burial_notification_outbox')]
    operations = [
        migrations.AddField(
            model_name='userprofile', name='preferences',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
