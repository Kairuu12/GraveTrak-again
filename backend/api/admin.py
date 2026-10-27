from django.contrib import admin
from django.contrib.admin.sites import NotRegistered

from .models import Grave, ColumbariumSlot, UserProfile, Application, BurialApplication, BurialDocument, BurialPlot, FamilyCompositionMember, InterviewSchedule, SystemSettings
from .models import SmsOutbox, EmailOutbox


@admin.register(EmailOutbox)
class EmailOutboxAdmin(admin.ModelAdmin):
    list_display = ['id', 'notification', 'status', 'created_at', 'attempted_at']
    list_filter = ['status', 'created_at']
    readonly_fields = [field.name for field in EmailOutbox._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

try:
    admin.site.unregister(Grave)
except NotRegistered:
    pass

try:
    admin.site.unregister(BurialPlot)
except NotRegistered:
    pass


@admin.register(Grave)
class GraveAdmin(admin.ModelAdmin):
    list_display = ['grave_id', 'name', 'location', 'status', 'created_by', 'created_at']
    list_filter = ['status']
    search_fields = ['grave_id', 'name', 'location']
    readonly_fields = ['created_at', 'updated_at']
    ordering = ['grave_id']


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'role']
    search_fields = ['user__username', 'user__email', 'role']

@admin.register(ColumbariumSlot)
class ColumbariumSlotAdmin(admin.ModelAdmin):
    list_display = ['id', 'section', 'floor', 'col', 'status', 'name', 'created_at']
    list_display_links = ('id',)  # Explicitly set para maiwasan ang conflict sa list_editable
    list_filter = ['section', 'status', 'floor']
    search_fields = ['id', 'name', 'section']
    readonly_fields = ('created_at', 'updated_at')


@admin.register(Application)
class ApplicationAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'applicant', 'status', 'submitted']
    list_filter = ['status']
    search_fields = ['id', 'name', 'applicant']


@admin.register(BurialApplication)
class BurialApplicationAdmin(admin.ModelAdmin):
    list_display = ['application_id', 'deceased_name', 'applicant_name', 'status', 'created_at']
    list_filter = ['status', 'created_at']
    search_fields = ['application_id', 'deceased_name', 'place_of_birth', 'funeral_home', 'applicant_name', 'applicant_contact_email']


@admin.register(BurialDocument)
class BurialDocumentAdmin(admin.ModelAdmin):
    list_display = ['application', 'document_type', 'file_name', 'verification_status', 'verified_by', 'uploaded_at']
    list_filter = ['document_type', 'verification_status', 'uploaded_at']
    search_fields = ['application__application_id', 'file_name']


@admin.register(FamilyCompositionMember)
class FamilyCompositionMemberAdmin(admin.ModelAdmin):
    list_display = ['name', 'application', 'age', 'sex', 'relationship']
    search_fields = ['name', 'application__application_id', 'relationship']


@admin.register(InterviewSchedule)
class InterviewScheduleAdmin(admin.ModelAdmin):
    list_display = ['application', 'scheduled_date', 'scheduled_time', 'duration_minutes', 'status', 'created_by']
    list_filter = ['status', 'scheduled_date']


@admin.register(SystemSettings)
class SystemSettingsAdmin(admin.ModelAdmin):
    list_display = ['setting_key', 'setting_value', 'description', 'updated_at']


@admin.register(SmsOutbox)
class SmsOutboxAdmin(admin.ModelAdmin):
    """Read-only operational log. Delivery cannot be enabled from the admin UI."""
    list_display = ['id', 'application', 'notification_type', 'masked_recipient', 'status', 'created_at']
    list_filter = ['status', 'notification_type', 'created_at']
    search_fields = ['application__application_id', 'event_key']
    exclude = ['recipient_number']
    readonly_fields = [field.name for field in SmsOutbox._meta.fields if field.name != 'recipient_number'] + ['masked_recipient']

    @admin.display(description='Recipient mobile')
    def masked_recipient(self, obj):
        number = obj.recipient_number
        return number[:5] + '*' * (len(number) - 7) + number[-2:] if number else 'Missing / invalid'

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
