from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0014_burialapplication_documents_complete_status')]

    operations = [
        migrations.AddField(model_name='interviewschedule', name='duration_minutes', field=models.PositiveIntegerField(blank=True, null=True)),
        migrations.AddField(model_name='interviewschedule', name='cancelled_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='interviewschedule', name='cancellation_reason', field=models.TextField(blank=True)),
    ]
