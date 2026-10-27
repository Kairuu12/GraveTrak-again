from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('api', '0020_burial_application_birthplace_funeral_home_documents')]

    operations = [
        migrations.AddField(model_name='burialapplication', name='client_age', field=models.PositiveSmallIntegerField(blank=True, null=True)),
        migrations.AddField(model_name='burialapplication', name='client_gender', field=models.CharField(blank=True, choices=[('M', 'Male'), ('F', 'Female'), ('O', 'Other')], max_length=10, null=True)),
        migrations.AddField(model_name='burialapplication', name='client_civil_status', field=models.CharField(blank=True, max_length=20)),
        migrations.AddField(model_name='burialapplication', name='client_educational_attainment', field=models.CharField(blank=True, max_length=120)),
        migrations.AddField(model_name='burialapplication', name='client_occupation', field=models.CharField(blank=True, max_length=120)),
        migrations.AddField(model_name='burialapplication', name='client_income', field=models.CharField(blank=True, max_length=120)),
        migrations.AddField(model_name='burialapplication', name='client_address', field=models.TextField(blank=True)),
        migrations.CreateModel(
            name='FamilyCompositionMember',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255)),
                ('age', models.PositiveSmallIntegerField(blank=True, null=True)),
                ('sex', models.CharField(blank=True, choices=[('M', 'Male'), ('F', 'Female'), ('O', 'Other')], max_length=10)),
                ('civil_status', models.CharField(blank=True, max_length=20)),
                ('educational_attainment', models.CharField(blank=True, max_length=120)),
                ('occupation', models.CharField(blank=True, max_length=120)),
                ('income', models.CharField(blank=True, max_length=120)),
                ('relationship', models.CharField(blank=True, max_length=80)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('application', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='family_members', to='api.burialapplication')),
            ],
            options={'ordering': ['id']},
        ),
    ]
