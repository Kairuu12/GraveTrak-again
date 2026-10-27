from django.contrib.auth import get_user_model
from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone

User = get_user_model()


class OperationsReport(models.Model):
    submitted_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name='operations_reports')
    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True)
    period_from = models.DateField()
    period_to = models.DateField()
    snapshot = models.JSONField(default=dict)
    submitted_at = models.DateTimeField(auto_now_add=True)
    acknowledged_by = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True, related_name='acknowledged_operations_reports')
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-submitted_at', '-pk']


class SavedGrave(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='saved_graves')
    grave_id = models.CharField(max_length=200)
    cemetery = models.CharField(max_length=3, choices=[('old', 'Old'), ('new', 'New')])
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.UniqueConstraint(fields=['user', 'cemetery', 'grave_id'], name='unique_user_saved_grave')]


class UserProfile(models.Model):
    # Keep the original stored values.  These are used by existing accounts and
    # the frontend; their business meaning is defined by ROLE_LABELS below.
    SUPER_ADMIN = 'mayor'
    CPDO_ADMIN = 'planning'
    CEMETERY_STAFF = 'staff'
    CITIZEN = 'user'

    ROLE_CHOICES = [
        (CITIZEN, 'Citizen'),
        (CEMETERY_STAFF, 'Cemetery Staff / Administrator'),
        (SUPER_ADMIN, "CMO Super Administrator"),
        (CPDO_ADMIN, 'CPDO Administrator'),
    ]

    # These capabilities cover modules that exist today. An empty list means
    # the role defaults apply; a non-empty list is a Super Admin override.
    PERMISSION_CHOICES = (
        'manage_users', 'assign_roles', 'manage_permissions',
        'manage_applications', 'review_documents', 'manage_burial_records',
        'manage_appointments', 'manage_gis', 'manage_zoning', 'manage_plots',
        'allocate_plots', 'manage_grave_status', 'generate_reports',
    )

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default='user')
    contact_number = models.CharField(max_length=20, blank=True)
    permissions = models.JSONField(default=list, blank=True)
    preferences = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f'{self.user.username} ({self.role})'


class EmailVerification(models.Model):
    """Mailbox ownership and a bounded, single-use verification challenge."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='email_verification')
    verified_email = models.EmailField(blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    pending_email = models.EmailField(blank=True)
    code_hash = models.CharField(max_length=128, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    requested_at = models.DateTimeField(null=True, blank=True)
    window_started_at = models.DateTimeField(null=True, blank=True)
    send_count = models.PositiveSmallIntegerField(default=0)
    delivery_status = models.CharField(max_length=32, blank=True)


class Grave(models.Model):
    STATUS_CHOICES = [
        ('available', 'Available'),
        ('occupied', 'Occupied'),
        ('maintenance', 'Maintenance'),
    ]

    grave_id = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=128)
    dates = models.CharField(max_length=64, blank=True)
    location = models.CharField(max_length=128)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='available')
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='created_graves')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['grave_id']

    def __str__(self):
        return f'{self.grave_id} — {self.location}'


class ColumbariumSlot(models.Model):
    STATUS_CHOICES = [
        ('available', 'Available'),
        ('occupied', 'Occupied'),
        ('maintenance', 'Maintenance'),
    ]
    CEMETERY_MAP_CHOICES = [
        ('old', 'Old Cemetery Map'),
        ('new', 'New Cemetery Map'),
    ]
    id = models.CharField(max_length=50, primary_key=True)
    section = models.CharField(max_length=50)
    floor = models.IntegerField()
    col = models.IntegerField() # Column number within the section
    cemetery_map = models.CharField(max_length=16, choices=CEMETERY_MAP_CHOICES, default='old')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='available')
    name = models.CharField(max_length=255, blank=True, null=True)
    maintenance_previous_status = models.CharField(max_length=20, blank=True, default='')
    maintenance_notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Columbarium Slot"
        verbose_name_plural = "Columbarium Slots"
        unique_together = ('section', 'floor', 'col', 'cemetery_map')
        ordering = ['section', 'floor', 'col']

    def __str__(self):
        return self.id


class Cemetery(models.Model):
    """A cemetery represented by one of GraveTrak's existing map datasets."""

    code = models.SlugField(max_length=32, unique=True)
    name = models.CharField(max_length=128)
    is_active = models.BooleanField(default=True)
    boundary_geometry = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'Cemeteries'

    def __str__(self):
        return self.name


class CemeterySection(models.Model):
    STATUS_CHOICES = [
        ('planned', 'Planned'),
        ('active', 'Active'),
        ('maintenance', 'Maintenance'),
    ]
    LAYOUT_ORIENTATION_CHOICES = [
        ('horizontal', 'Horizontal'),
        ('vertical', 'Vertical'),
    ]

    cemetery = models.ForeignKey(Cemetery, null=True, blank=True, on_delete=models.PROTECT, related_name='sections')
    name = models.CharField(max_length=128)
    legacy_source_name = models.CharField(max_length=128, blank=True, default='')
    zone_code = models.CharField(max_length=32, blank=True, db_index=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    display_order = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default='planned')
    estimated_stack_height = models.PositiveIntegerField(default=1)
    layout_orientation = models.CharField(max_length=16, choices=LAYOUT_ORIENTATION_CHOICES, default='horizontal')
    layout_rows = models.PositiveIntegerField(null=True, blank=True)
    layout_columns = models.PositiveIntegerField(null=True, blank=True)
    geometry = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['display_order', 'name']
        constraints = [
            models.UniqueConstraint(fields=['cemetery', 'name'], name='unique_section_name_per_cemetery'),
            models.UniqueConstraint(
                fields=['cemetery', 'zone_code'],
                condition=~models.Q(zone_code=''),
                name='unique_zone_code_per_cemetery',
            ),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.pk and self.cemetery_id:
            conflicting_plots = self.ground_plots.exclude(cemetery_id=self.cemetery_id)
            if conflicting_plots.exists():
                raise ValidationError({'cemetery': 'This zone contains plots belonging to another cemetery.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class RetiredCemeterySection(models.Model):
    """Remember removed map names so legacy geometry cannot resurrect them."""
    cemetery = models.ForeignKey(Cemetery, on_delete=models.PROTECT, related_name='retired_sections')
    name = models.CharField(max_length=128)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['cemetery', 'name'], name='unique_retired_section_name')]


class CemeteryPathway(models.Model):
    """A CPDO-planned pedestrian or vehicle route stored as GeoJSON."""

    PATHWAY_TYPE_CHOICES = [
        ('walkway', 'Walkway'),
        ('road', 'Road'),
        ('access', 'Access Path'),
    ]

    cemetery = models.ForeignKey(Cemetery, on_delete=models.PROTECT, related_name='pathways')
    name = models.CharField(max_length=128)
    pathway_type = models.CharField(max_length=24, choices=PATHWAY_TYPE_CHOICES, default='walkway')
    width_meters = models.DecimalField(max_digits=5, decimal_places=2, default=2)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    geometry = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['cemetery', 'name'], name='unique_pathway_name_per_cemetery')]

    def __str__(self):
        return self.name


class Application(models.Model):
    id = models.CharField(max_length=32, primary_key=True)
    name = models.CharField(max_length=128)
    applicant = models.CharField(max_length=128)
    submitted = models.CharField(max_length=64)
    status = models.CharField(max_length=32, default='Review')


class BurialPlot(models.Model):
    class PlotStatus(models.TextChoices):
        AVAILABLE = 'available', 'Available'
        OCCUPIED = 'occupied', 'Occupied'
        MAINTENANCE = 'maintenance', 'Maintenance'

    cemetery = models.ForeignKey(Cemetery, null=True, blank=True, on_delete=models.PROTECT, related_name='ground_plots')
    section_record = models.ForeignKey(CemeterySection, null=True, blank=True, on_delete=models.PROTECT, related_name='ground_plots')
    plot_id = models.CharField(max_length=50, unique=True, db_index=True)
    legacy_plot_id = models.CharField(max_length=50, blank=True, default='', db_index=True)
    section = models.CharField(max_length=10, db_index=True)
    plot_number = models.IntegerField()
    location_description = models.CharField(max_length=255, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=PlotStatus.choices, default=PlotStatus.AVAILABLE, db_index=True)
    assigned_to = models.OneToOneField(
        'BurialApplication',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='assigned_plot_burial',
        help_text='Application currently assigned to this plot (pending approval)'
    )
    occupied_by_application = models.OneToOneField(
        'BurialApplication',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='occupied_plot_burial',
        help_text='Application that used this plot (after burial completed)'
    )
    notes = models.TextField(blank=True)
    maintenance_previous_status = models.CharField(max_length=20, blank=True, default='')
    maintenance_notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Grave Plot"
        verbose_name_plural = "Grave Plots"
        ordering = ['section', 'plot_number']
        indexes = [
            models.Index(fields=['section', 'plot_number']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f'Plot {self.plot_id} ({self.status})'

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.section_record and self.cemetery and self.section_record.cemetery_id != self.cemetery_id:
            raise ValidationError({'section_record': 'The selected section belongs to a different cemetery.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    @property
    def is_available(self):
        return self.status == self.PlotStatus.AVAILABLE


class BurialApplication(models.Model):
    class ApplicationStatus(models.TextChoices):
        PENDING_REVIEW = 'pending_review', 'Pending Review'
        ACTION_REQUIRED = 'action_required', 'Action Required'
        DOCUMENTS_COMPLETE = 'documents_complete', 'Documents Complete — Ready for Scheduling'
        SLOT_ASSIGNED = 'slot_assigned', 'Slot Assigned'
        APPROVED = 'approved', 'Approved'
        FOR_INTERVIEW = 'for_interview', 'For Interview'
        SCHEDULED = 'scheduled', 'Scheduled'
        COMPLETED = 'completed', 'Completed'
        REJECTED = 'rejected', 'Rejected'

    id = models.AutoField(primary_key=True)
    application_id = models.CharField(max_length=50, unique=True, db_index=True)
    deceased_name = models.CharField(max_length=255)
    deceased_age = models.IntegerField(null=True, blank=True)
    deceased_date_of_birth = models.DateField(null=True, blank=True)
    place_of_birth = models.CharField(max_length=255, null=True, blank=True)
    deceased_date_of_death = models.DateField()
    deceased_gender = models.CharField(
        max_length=10,
        choices=[('M', 'Male'), ('F', 'Female'), ('O', 'Other')],
        null=True,
        blank=True
    )
    applicant_name = models.CharField(max_length=255)
    applicant_relationship = models.CharField(
        max_length=50,
        choices=[
            ('spouse', 'Spouse'),
            ('child', 'Child'),
            ('parent', 'Parent'),
            ('sibling', 'Sibling'),
            ('grandchild', 'Grandchild'),
            ('relative', 'Other Relative'),
            ('other', 'Other'),
        ]
    )
    applicant_contact_email = models.EmailField()
    applicant_contact_phone = models.CharField(max_length=20)
    applicant_address = models.TextField()
    client_age = models.PositiveSmallIntegerField(null=True, blank=True)
    client_gender = models.CharField(max_length=10, choices=[('M', 'Male'), ('F', 'Female'), ('O', 'Other')], null=True, blank=True)
    client_civil_status = models.CharField(max_length=20, blank=True)
    client_educational_attainment = models.CharField(max_length=120, blank=True)
    client_occupation = models.CharField(max_length=120, blank=True)
    client_income = models.CharField(max_length=120, blank=True)
    client_address = models.TextField(blank=True)
    funeral_home = models.CharField(max_length=255, null=True, blank=True)
    submitted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='burial_applications',
        help_text='User who submitted the application (nullable for public submission)'
    )
    status = models.CharField(max_length=20, choices=ApplicationStatus.choices, default=ApplicationStatus.PENDING_REVIEW, db_index=True)
    assigned_plot = models.OneToOneField(
        BurialPlot,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='burial_application',
        help_text='Burial plot assigned to this application'
    )
    reviewed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='reviewed_applications',
        help_text='Mayor/staff who reviewed this application'
    )
    rejection_reason = models.TextField(blank=True)
    action_required_reason = models.TextField(blank=True)
    burial_date = models.DateField(null=True, blank=True)
    burial_time = models.TimeField(null=True, blank=True)
    burial_location = models.CharField(max_length=255, blank=True)
    burial_executed_date = models.DateField(null=True, blank=True)
    burial_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['submitted_by']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return f'{self.application_id} - {self.deceased_name}'

    def save(self, *args, **kwargs):
        if not self.application_id:
            timestamp = timezone.now()
            self.application_id = f'BUR-{timestamp.year}-{timestamp.month:02d}-{timestamp.day:02d}-{int(timestamp.timestamp()) % 100000}'
        super().save(*args, **kwargs)

    @property
    def is_terminal_state(self):
        return self.status in [self.ApplicationStatus.COMPLETED, self.ApplicationStatus.REJECTED]

    @property
    def document_completeness(self):
        required = BurialDocument.required_document_types()
        documents = {doc.document_type: doc for doc in self.documents.all() if doc.document_type in required}
        missing = [document_type for document_type in required if document_type not in documents]
        pending = [doc for doc in documents.values() if doc.verification_status == BurialDocument.VerificationStatus.PENDING_REVIEW]
        complete = [doc for doc in documents.values() if doc.verification_status == BurialDocument.VerificationStatus.COMPLETE]
        corrections = [doc for doc in documents.values() if doc.verification_status == BurialDocument.VerificationStatus.NEEDS_CORRECTION]

        if missing:
            overall = 'incomplete'
        elif corrections:
            overall = 'needs_correction'
        elif pending:
            overall = 'under_review'
        else:
            overall = 'complete'

        labels = dict(BurialDocument.DocumentType.choices)
        return {
            'state': overall,
            'required_count': len(required),
            'uploaded_count': len(documents),
            'pending_review_count': len(pending),
            'complete_count': len(complete),
            'needs_correction_count': len(corrections),
            'missing_document_types': missing,
            'missing_documents': [labels[item] for item in missing],
            'ready_for_further_processing': overall == 'complete',
        }


class FamilyCompositionMember(models.Model):
    application = models.ForeignKey(BurialApplication, on_delete=models.CASCADE, related_name='family_members')
    name = models.CharField(max_length=255)
    age = models.PositiveSmallIntegerField(null=True, blank=True)
    sex = models.CharField(max_length=10, choices=[('M', 'Male'), ('F', 'Female'), ('O', 'Other')], blank=True)
    civil_status = models.CharField(max_length=20, blank=True)
    educational_attainment = models.CharField(max_length=120, blank=True)
    occupation = models.CharField(max_length=120, blank=True)
    income = models.CharField(max_length=120, blank=True)
    relationship = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f'{self.name} — {self.application.application_id}'


class BurialDocument(models.Model):
    class DocumentType(models.TextChoices):
        DEATH_CERTIFICATE = 'death_certificate', 'Certified True Copy of Death Certificate'
        CITIZENSHIP_PROOF = 'citizenship_proof', 'Proof of Citizenship'
        FAMILY_RELATIONSHIP = 'family_relationship', 'Proof of Family Relationship'
        BURIAL_PERMIT = 'burial_permit', 'Burial Permit'
        LIST_PERMIT = 'list_permit', 'List Permit'
        VALID_ID = 'valid_id', 'Valid ID of Applicant'
        FUNERAL_CONTRACT = 'funeral_contract', 'Funeral Contract'
        DECEASED_VALID_ID = 'deceased_valid_id', 'Valid ID of Deceased'
        INDIGENCY = 'indigency', 'Indigency'
        OTHER = 'other', 'Other Document'

    class VerificationStatus(models.TextChoices):
        PENDING_REVIEW = 'pending_review', 'Pending Review'
        COMPLETE = 'complete', 'Complete'
        NEEDS_CORRECTION = 'needs_correction', 'Needs Correction'

    application = models.ForeignKey(BurialApplication, on_delete=models.CASCADE, related_name='documents')
    document_type = models.CharField(max_length=30, choices=DocumentType.choices)
    document_file = models.FileField(
        upload_to='burial_applications/%Y/%m/%d/',
        validators=[FileExtensionValidator(allowed_extensions=['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'])]
    )
    file_name = models.CharField(max_length=255, blank=True)
    file_size = models.IntegerField(default=0)
    mime_type = models.CharField(max_length=100, blank=True)
    verified = models.BooleanField(default=False)
    verification_note = models.TextField(blank=True)
    verification_status = models.CharField(
        max_length=24,
        choices=VerificationStatus.choices,
        default=VerificationStatus.PENDING_REVIEW,
        db_index=True,
    )
    verified_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='verified_documents')
    verified_at = models.DateTimeField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    uploaded_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='uploaded_documents')

    class Meta:
        ordering = ['document_type', '-uploaded_at']
        unique_together = ('application', 'document_type')
        indexes = [
            models.Index(fields=['application']),
            models.Index(fields=['document_type']),
        ]

    def __str__(self):
        return f'{self.application.application_id} - {self.get_document_type_display()}'

    def save(self, *args, **kwargs):
        if self.document_file:
            self.file_name = self.document_file.name
            self.file_size = self.document_file.size
            underlying_file = getattr(self.document_file, 'file', None)
            self.mime_type = getattr(underlying_file, 'content_type', self.mime_type or '')
        super().save(*args, **kwargs)

    @classmethod
    def required_document_types(cls):
        return [
            cls.DocumentType.FUNERAL_CONTRACT,
            cls.DocumentType.DEATH_CERTIFICATE,
            cls.DocumentType.DECEASED_VALID_ID,
            cls.DocumentType.VALID_ID,
            cls.DocumentType.INDIGENCY,
            cls.DocumentType.LIST_PERMIT,
        ]


class InterviewSchedule(models.Model):
    notification_version = models.PositiveIntegerField(default=0)
    INTERVIEW_STATUS = [
        ('scheduled', 'Scheduled'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
        ('no_show', 'No Show'),
    ]

    application = models.OneToOneField(BurialApplication, on_delete=models.CASCADE, related_name='interview_schedule')
    scheduled_date = models.DateField()
    scheduled_time = models.TimeField()
    duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    location = models.CharField(max_length=255)
    notes = models.TextField(blank=True)
    required_documents = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=INTERVIEW_STATUS, default='scheduled')
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)
    completion_notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='created_interviews')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['scheduled_date', 'scheduled_time']

    def __str__(self):
        return f'Interview {self.application.application_id} - {self.scheduled_date}'

    def mark_completed(self, notes=''):
        self.completed = True
        self.status = 'completed'
        self.completed_at = timezone.now()
        self.completion_notes = notes
        self.save()


class StatusAuditLog(models.Model):
    application = models.ForeignKey(BurialApplication, on_delete=models.CASCADE, related_name='status_history')
    old_status = models.CharField(max_length=20)
    new_status = models.CharField(max_length=20)
    changed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    changed_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)

    class Meta:
        ordering = ['-changed_at']
        indexes = [
            models.Index(fields=['application']),
            models.Index(fields=['changed_at']),
        ]

    def __str__(self):
        return f'{self.application.application_id}: {self.old_status} → {self.new_status}'


class Notification(models.Model):
    event_key = models.CharField(max_length=160, unique=True, null=True, blank=True)
    NOTIFICATION_TYPE = [
        ('application_received', 'Application Received'),
        ('action_required', 'Action Required'),
        ('approved', 'Application Approved'),
        ('rejected', 'Application Rejected'),
        ('interview_scheduled', 'Interview Scheduled'),
        ('burial_scheduled', 'Burial Scheduled'),
        ('burial_completed', 'Burial Completed'),
        ('system_alert', 'System Alert'),
        ('documents_correction', 'Documents Need Correction'),
        ('interview_rescheduled', 'Interview Rescheduled'),
        ('manual_notification', 'Manual Notification'),
    ]

    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    application = models.ForeignKey(BurialApplication, null=True, blank=True, on_delete=models.CASCADE, related_name='notifications')
    notification_type = models.CharField(max_length=30, choices=NOTIFICATION_TYPE)
    title = models.CharField(max_length=255)
    message = models.TextField()
    read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    sent = models.BooleanField(default=False)
    sent_at = models.DateTimeField(null=True, blank=True)
    send_via_email = models.BooleanField(default=True)
    send_via_sms = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', '-created_at']),
            models.Index(fields=['read']),
        ]

    def __str__(self):
        return f'Notification to {self.recipient.username}: {self.title}'

    def mark_read(self):
        self.read = True
        self.read_at = timezone.now()
        self.save()


class SmsOutbox(models.Model):
    """SMS event audit; only new opted-in events can become eligible."""
    event_key = models.CharField(max_length=160, unique=True)
    notification = models.OneToOneField(Notification, null=True, blank=True, on_delete=models.SET_NULL, related_name='sms_outbox')
    recipient = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    application = models.ForeignKey(BurialApplication, on_delete=models.CASCADE, related_name='sms_outbox')
    notification_type = models.CharField(max_length=30)
    recipient_number = models.CharField(max_length=20, blank=True)
    message = models.TextField()
    status = models.CharField(max_length=32, default='provider_not_configured', choices=[
        ('provider_not_configured', 'Provider Not Configured'),
        ('invalid_recipient', 'Invalid Recipient'), ('pending', 'Pending'),
        ('sent', 'Sent'), ('failed', 'Failed'),
        ('processing', 'Processing'), ('accepted', 'Accepted by Provider'),
        ('unknown', 'Unknown Outcome'), ('opted_out', 'Opted Out'),
    ])
    eligible_for_delivery = models.BooleanField(default=False)
    provider = models.CharField(max_length=100, blank=True)
    provider_message_id = models.CharField(max_length=255, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']


class EmailOutbox(models.Model):
    """One delivery attempt per new notification; historical notices are never replayed."""
    notification = models.OneToOneField(Notification, on_delete=models.CASCADE, related_name='email_outbox')
    recipient_email = models.EmailField(blank=True)
    subject = models.CharField(max_length=255)
    body = models.TextField()
    status = models.CharField(max_length=32, default='pending', db_index=True, choices=[
        ('pending', 'Pending'), ('processing', 'Processing'),
        ('accepted', 'Accepted by provider (delivery not confirmed)'),
        ('failed', 'Failed'), ('unknown', 'Unknown outcome'),
        ('provider_not_configured', 'Provider not configured'),
        ('invalid_recipient', 'Invalid or changed recipient'), ('opted_out', 'Opted out'),
        ('unverified_recipient', 'Email address not verified'),
    ])
    provider_message_id = models.CharField(max_length=255, blank=True)
    error_message = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    attempted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']


class SystemSettings(models.Model):
    setting_key = models.CharField(max_length=100, unique=True, primary_key=True)
    setting_value = models.TextField()
    description = models.TextField(blank=True)
    value_type = models.CharField(
        max_length=20,
        choices=[
            ('string', 'String'),
            ('integer', 'Integer'),
            ('boolean', 'Boolean'),
            ('json', 'JSON'),
        ],
        default='string'
    )
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        verbose_name_plural = 'System Settings'

    def __str__(self):
        return f'{self.setting_key}: {self.setting_value}'

    @classmethod
    def get_setting(cls, key, default=None):
        try:
            return cls.objects.get(setting_key=key).setting_value
        except cls.DoesNotExist:
            return default
