"""Active inventory follows saved zoning, with explicit legacy-map fallback."""
from django.db.models.functions import Lower, Trim
import re

from .models import Cemetery, CemeterySection, RetiredCemeterySection

# Canonical polygons in the shipped Old A–N and New A–X cemetery maps.
LEGACY_SECTION_NAMES = {
    'old': {f'section {letter.lower()}' for letter in 'ABCDEFGHIJKLMN'},
    'new': {f'section {letter.lower()}' for letter in 'ABCDEFGHIJKLMNOPQRSTUVWX'},
}


def normalized_section(name):
    name = str(name or '').strip().casefold()
    match = re.fullmatch(r'(?:sec(?:tion)?\s*)?([a-z])', name)
    return f'section {match[1]}' if match else name


def active_section_names():
    names = {code: set(values) for code, values in LEGACY_SECTION_NAMES.items()}
    for retired in RetiredCemeterySection.objects.select_related('cemetery'):
        names.setdefault(retired.cemetery.code, set()).discard(normalized_section(retired.name))
    sections = list(CemeterySection.objects.select_related('cemetery'))
    # All saved sections supersede their legacy names, including archived ones.
    for section in sections:
        if not section.cemetery_id:
            continue
        current = names.setdefault(section.cemetery.code, set())
        current.discard(normalized_section(section.name))
        current.discard(normalized_section(section.legacy_source_name))
    for section in sections:
        if section.cemetery_id and section.cemetery.is_active and section.is_active:
            names.setdefault(section.cemetery.code, set()).add(normalized_section(section.name))
    for code in Cemetery.objects.filter(is_active=False).values_list('code', flat=True):
        names[code] = set()
    return names


def active_niches(queryset):
    from django.db.models import Q
    condition = Q(pk__in=[])
    for code, names in active_section_names().items():
        aliases = set(names)
        for name in names:
            match = re.fullmatch(r'section ([a-z])', name)
            if match:
                aliases.update([match[1], f'section{match[1]}', f'sec {match[1]}'])
        condition |= Q(cemetery_map=code, normalized_section_name__in=aliases)
    return queryset.annotate(normalized_section_name=Lower(Trim('section'))).filter(condition)


def active_plots(queryset):
    return queryset.filter(section_record__is_active=True, cemetery__is_active=True)
