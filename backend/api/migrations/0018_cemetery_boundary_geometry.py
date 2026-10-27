from django.db import migrations, models


OLD_BOUNDARY = {
    'type': 'LineString',
    'coordinates': [[121.61999124131529, 13.939027053437371], [121.62007237222542, 13.939175273283041], [121.62190497632531, 13.938989998461224], [121.62189304530955, 13.938716717827049], [121.62177373514606, 13.9383484832412], [121.62134421856115, 13.93810994102634], [121.62129172208887, 13.93778107659736], [121.62085546962476, 13.93740466564428], [121.61999960200598, 13.939015847139046]],
}

NEW_BOUNDARY = {
    'type': 'LineString',
    'coordinates': [[121.620802, 13.932831], [121.620487, 13.932164], [121.62023, 13.93216], [121.620106, 13.931941], [121.620026, 13.931707], [121.620139, 13.931539], [121.620179, 13.931412], [121.620137, 13.931177], [121.620207, 13.930755], [121.620586, 13.930267], [121.62064, 13.930065], [121.620699, 13.929622], [121.621146, 13.929746], [121.621338, 13.929863], [121.621598, 13.930236], [121.62176, 13.930552], [121.621775, 13.930692], [121.621714, 13.930831], [121.621557, 13.931065], [121.621504, 13.931295], [121.621485, 13.931508], [121.621517, 13.932017], [121.62144, 13.9323], [121.621496, 13.932715], [121.621356, 13.932674], [121.621257, 13.932692], [121.621188, 13.93269], [121.621099, 13.932719], [121.620985, 13.932739], [121.620803, 13.932831], [121.620802, 13.932831]],
}


def reuse_existing_boundaries(apps, schema_editor):
    Cemetery = apps.get_model('api', 'Cemetery')
    Cemetery.objects.filter(code='old').update(boundary_geometry=OLD_BOUNDARY)
    Cemetery.objects.filter(code='new').update(boundary_geometry=NEW_BOUNDARY)


class Migration(migrations.Migration):
    dependencies = [('api', '0017_cpdo_phase2_zoning_management')]

    operations = [
        migrations.AddField(
            model_name='cemetery', name='boundary_geometry',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(reuse_existing_boundaries, migrations.RunPython.noop),
    ]
