"""Operational reports: dated burial records and explicitly current inventory."""
import re
from django.utils import timezone
from .models import BurialApplication, BurialPlot, ColumbariumSlot
from .inventory_visibility import active_niches, active_plots


def staff_operations_report(start, end):
    sections = {}
    maintenance = []
    checks = []
    for slot in active_niches(ColumbariumSlot.objects.all()).order_by('cemetery_map', 'section', 'floor', 'col'):
        key = (slot.cemetery_map, slot.section)
        counts = sections.setdefault(key, dict(cemetery=slot.cemetery_map, section=slot.section,
            total=0, available=0, occupied=0, reserved=0, maintenance=0, other=0))
        counts['total'] += 1
        counts[slot.status if slot.status in ('available', 'occupied', 'reserved', 'maintenance') else 'other'] += 1
        location = dict(reference=slot.pk, cemetery=slot.cemetery_map, section=slot.section,
                        position=f'Floor {slot.floor}, Column {slot.col}')
        if slot.status == 'maintenance':
            maintenance.append(dict(**location, kind='Niche', notes=slot.maintenance_notes))
        if slot.status == 'occupied':
            people = [name.strip() for name in re.split(r',\s*(?!\d)', slot.name or '') if name.strip()]
            missing_name = not people
            missing_date = not people
            for person in people:
                match = re.match(r'^(.*?)\s+\(([\d/?.,\s-]+)\s+[-–]\s+([\d/?.,\s-]+)\)$', person)
                missing_name |= bool(match and not match[1].strip())
                missing_date |= not bool(match and re.search(r'\d', match[3]))
            if missing_name or missing_date:
                checks.append(dict(**location, occupant=slot.name or '', reason='; '.join(filter(None, [
                    'Missing occupant name' if missing_name else '',
                    'Death date not detected in recorded name' if missing_date else '',
                ]))))
    for plot in active_plots(BurialPlot.objects.filter(status='maintenance')).select_related('cemetery', 'section_record'):
        maintenance.append(dict(reference=plot.plot_id, cemetery=plot.cemetery.code if plot.cemetery else 'old',
            section=plot.section_record.name if plot.section_record else plot.section,
            position=plot.location_description, kind='Ground layout', notes=plot.maintenance_notes))
    burials = [dict(reference=app.application_id, deceased=app.deceased_name,
        date=app.burial_executed_date.isoformat(), status=app.get_status_display(), funeral_home=app.funeral_home or 'Not recorded')
        for app in BurialApplication.objects.filter(status=BurialApplication.ApplicationStatus.COMPLETED,
            burial_executed_date__range=(start, end)).order_by('burial_executed_date', 'pk')]
    return dict(generated_at=timezone.now().isoformat(), burials=burials, burials_basis='actual_completion',
                sections=list(sections.values()), maintenance=maintenance, checks=checks)
