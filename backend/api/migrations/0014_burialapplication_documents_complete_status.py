from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0013_burialdocument_verification_status')]

    operations = [
        migrations.AlterField(
            model_name='burialapplication',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending_review', 'Pending Review'),
                    ('action_required', 'Action Required'),
                    ('documents_complete', 'Documents Complete — Ready for Scheduling'),
                    ('slot_assigned', 'Slot Assigned'),
                    ('approved', 'Approved'),
                    ('for_interview', 'For Interview'),
                    ('scheduled', 'Scheduled'),
                    ('completed', 'Completed'),
                    ('rejected', 'Rejected'),
                ],
                db_index=True,
                default='pending_review',
                max_length=20,
            ),
        ),
    ]
