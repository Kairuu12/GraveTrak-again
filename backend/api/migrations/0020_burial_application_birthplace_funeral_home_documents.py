from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0019_cemeterysection_layout_orientation'),
    ]

    operations = [
        migrations.AddField(
            model_name='burialapplication',
            name='place_of_birth',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='burialapplication',
            name='funeral_home',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AlterField(
            model_name='burialdocument',
            name='document_type',
            field=models.CharField(
                choices=[
                    ('death_certificate', 'Certified True Copy of Death Certificate'),
                    ('citizenship_proof', 'Proof of Citizenship'),
                    ('family_relationship', 'Proof of Family Relationship'),
                    ('burial_permit', 'Burial Permit'),
                    ('list_permit', 'List Permit'),
                    ('valid_id', 'Valid ID of Applicant'),
                    ('funeral_contract', 'Funeral Contract'),
                    ('deceased_valid_id', 'Valid ID of Deceased'),
                    ('indigency', 'Indigency'),
                    ('other', 'Other Document'),
                ],
                max_length=30,
            ),
        ),
    ]
