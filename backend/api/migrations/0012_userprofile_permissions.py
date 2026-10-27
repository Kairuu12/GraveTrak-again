# Generated manually for the RBAC permission overrides.
from django.db import migrations, models


def remove_non_cmo_django_superuser_flags(apps, schema_editor):
    """Keep existing accounts but prevent CPDO/staff Django-admin bypasses."""
    UserProfile = apps.get_model('api', 'UserProfile')
    for profile in UserProfile.objects.filter(role__in=['planning', 'staff']).select_related('user'):
        user = profile.user
        if user.is_superuser or user.is_staff:
            user.is_superuser = False
            user.is_staff = False
            user.save(update_fields=['is_superuser', 'is_staff'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_cemeterysection'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='permissions',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(remove_non_cmo_django_superuser_flags, migrations.RunPython.noop),
    ]
