from django.db import migrations, models


def migrate_verified_documents(apps, schema_editor):
    BurialDocument = apps.get_model('api', 'BurialDocument')
    BurialDocument.objects.filter(verified=True).update(verification_status='complete')


class Migration(migrations.Migration):
    dependencies = [('api', '0012_userprofile_permissions')]

    operations = [
        migrations.AddField(
            model_name='burialdocument',
            name='verification_status',
            field=models.CharField(
                choices=[
                    ('pending_review', 'Pending Review'),
                    ('complete', 'Complete'),
                    ('needs_correction', 'Needs Correction'),
                ],
                db_index=True,
                default='pending_review',
                max_length=24,
            ),
        ),
        migrations.RunPython(migrate_verified_documents, migrations.RunPython.noop),
    ]
