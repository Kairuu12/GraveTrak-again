"""Persist the Mayor's final approval and location assignment together."""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .inventory_visibility import active_niches
from .models import BurialApplication, ColumbariumSlot, Grave, StatusAuditLog
from .notifications import NotificationService


def assignment_location(item, kind):
    if kind == 'columbarium':
        return f'{item.get_cemetery_map_display()}: {item.section}, Floor {item.floor}, Column {item.col} [{item.pk}]'[:255]
    return f'{item.location} [{item.grave_id}]'[:255]


def occupant_label(application):
    def date_label(value):
        return f'{value.month}/{value.day}/{value.year}' if value else '?'
    return f'{application.deceased_name} ({date_label(application.deceased_date_of_birth)} - {date_label(application.deceased_date_of_death)})'


@transaction.atomic
def approve_and_assign(application_id, kind, target_id, actor):
    if kind not in ('columbarium', 'grave') or not target_id:
        raise ValidationError('A valid location type and target ID are required.')
    application = BurialApplication.objects.select_for_update().get(pk=application_id)
    queryset = active_niches(ColumbariumSlot.objects.all()) if kind == 'columbarium' else Grave.objects.all()
    try:
        item = queryset.select_for_update().filter(pk=target_id).first()
    except (ValueError, TypeError, OverflowError):
        raise ValidationError('A valid location ID is required.')
    if item is None:
        raise ValidationError('This location is not in the current inventory. Refresh and try again.')
    location = assignment_location(item, kind)
    name = occupant_label(application) if kind == 'columbarium' else application.deceased_name
    if (application.status in ('slot_assigned', 'completed') and application.approved_at
            and application.burial_location == location and item.status == 'occupied' and item.name == name):
        return application, item
    if application.status not in ('for_interview', 'scheduled', 'approved') or application.assigned_plot_id or application.burial_location:
        raise ValidationError('This application is not ready for a new location assignment. Refresh its status first.')
    if not application.document_completeness['ready_for_further_processing']:
        raise ValidationError('Complete the required document review before final approval and assignment.')
    if item.status != 'available' or (item.name or '').strip() not in ('', '— Available —'):
        raise ValidationError('This location is no longer available. Refresh and choose the next available slot.')
    if len(name) > item._meta.get_field('name').max_length:
        raise ValidationError('The occupant name is too long for this location record.')
    item.name = name
    item.status = 'occupied'
    item.save(update_fields=['name', 'status', 'updated_at'])
    old_status = application.status
    newly_approved = application.approved_at is None
    application.approved_at = application.approved_at or timezone.now()
    application.status = 'slot_assigned'
    application.burial_location = location
    application.reviewed_by = actor
    application.reviewed_at = timezone.now()
    application.save(update_fields=['approved_at', 'status', 'burial_location', 'reviewed_by', 'reviewed_at', 'updated_at'])
    audit = StatusAuditLog.objects.create(application=application, old_status=old_status,
        new_status='approved' if newly_approved else 'slot_assigned', changed_by=actor,
        reason=f'Final approval and location assignment: {location}. Actual burial completion is recorded separately.')
    if newly_approved:
        NotificationService.final_status(application, audit)
    return application, item
