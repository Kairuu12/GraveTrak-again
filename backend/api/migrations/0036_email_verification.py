from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('api', '0035_email_notification_outbox'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name='EmailVerification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('verified_email', models.EmailField(blank=True, max_length=254)),
                ('verified_at', models.DateTimeField(blank=True, null=True)),
                ('pending_email', models.EmailField(blank=True, max_length=254)),
                ('code_hash', models.CharField(blank=True, max_length=128)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
                ('requested_at', models.DateTimeField(blank=True, null=True)),
                ('window_started_at', models.DateTimeField(blank=True, null=True)),
                ('send_count', models.PositiveSmallIntegerField(default=0)),
                ('delivery_status', models.CharField(blank=True, max_length=32)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='email_verification', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AlterField(
            model_name='emailoutbox', name='status',
            field=models.CharField(max_length=32, default='pending', db_index=True, choices=[
                ('pending', 'Pending'), ('processing', 'Processing'),
                ('accepted', 'Accepted by provider (delivery not confirmed)'),
                ('failed', 'Failed'), ('unknown', 'Unknown outcome'),
                ('provider_not_configured', 'Provider not configured'),
                ('invalid_recipient', 'Invalid or changed recipient'), ('opted_out', 'Opted out'),
                ('unverified_recipient', 'Email address not verified'),
            ]),
        ),
    ]
