from django.db import migrations


def backfill_canonical_old_cemetery_niches(apps, schema_editor):
    """Restore only missing canonical Old Cemetery niche positions.

    The original A–N map is a fixed legacy layout.  Some installations kept
    its geometry but never persisted slots for sections C–N, so those sections
    disappeared from Apartment Niches once browser-only placeholders were
    removed.  This migration adds missing available positions without changing
    any existing section, occupant, or trial-named record.
    """
    ColumbariumSlot = apps.get_model('api', 'ColumbariumSlot')
    for letter in 'ABCDEFGHIJKLMN':
        section = f'Section {letter}'
        existing_positions = set(
            ColumbariumSlot.objects.filter(cemetery_map='old', section__iexact=section)
            .values_list('floor', 'col')
        )
        missing_slots = [
            ColumbariumSlot(
                id=f'OLD-SECTION-{letter}-F{floor}-C{column}',
                section=section,
                floor=floor,
                col=column,
                cemetery_map='old',
                status='available',
                name='',
            )
            for floor in range(1, 5)
            for column in range(1, 85)
            if (floor, column) not in existing_positions
        ]
        ColumbariumSlot.objects.bulk_create(missing_slots, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [('api', '0029_cemeterysection_legacy_source_name')]

    operations = [migrations.RunPython(backfill_canonical_old_cemetery_niches, migrations.RunPython.noop)]
