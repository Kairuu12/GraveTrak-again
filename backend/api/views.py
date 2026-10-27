import logging
import math
import re
import hashlib
import json
import uuid
from datetime import date, datetime
from django.contrib.auth import authenticate, get_user_model
from django.http import FileResponse
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q
from django.utils import timezone
from rest_framework import authentication, permissions, parsers, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from .models import (
    ColumbariumSlot,
    Cemetery,
    CemeterySection,
    RetiredCemeterySection,
    CemeteryPathway,
    Grave,
    Application,
    BurialApplication,
    BurialDocument,
    BurialPlot,
    InterviewSchedule,
    Notification,
    SystemSettings,
)
from .serializers import (
    GraveSerializer,
    RegisterSerializer,
    UserSerializer,
    UserUpdateSerializer,
    AdminUserCreateSerializer,
    ApplicationSerializer,
    BurialDocumentSerializer,
    ColumbariumSlotSerializer,
    CemeterySerializer,
    CemeterySectionSerializer,
    CemeteryPathwaySerializer,
    BurialDocumentUploadSerializer,
    BurialPlotSerializer,
    BurialPlotDetailSerializer,
    BurialApplicationCreateSerializer,
    BurialApplicationListSerializer,
    BurialApplicationDetailSerializer,
    BurialApplicationMayorSerializer,
    InterviewScheduleSerializer,
    NotificationSerializer,
    SystemSettingsSerializer,
)
from .workflow import PlotAssignmentEngine, ApplicationWorkflowEngine, NotificationEngine
from .notifications import NotificationService, masked_owner_contact
from .appointment_scheduler import AppointmentScheduler, SchedulingError
from .gis_validation import point_in_polygon
from .plot_maintenance import PlotMaintenanceMixin
from .inventory_visibility import active_niches, active_plots
from .reporting import get_report_date_range
from .permissions import (
    get_role, has_capability, IsGraveTrakSuperAdmin, IsCPDOOrSuperAdmin,
    IsCemeteryStaffOrSuperAdmin, CanManagePlots, CanManageApplications,
)

User = get_user_model()

logger = logging.getLogger(__name__)


@api_view(['GET'])
@authentication_classes([authentication.TokenAuthentication])
@permission_classes([permissions.IsAuthenticated])
def report_analytics_view(request):
    role = get_role(request.user)
    if role not in ('mayor', 'staff') or not has_capability(request.user, 'generate_reports'):
        return Response({'detail': 'You do not have permission to view reports.'}, status=status.HTTP_403_FORBIDDEN)

    date_range = get_report_date_range(
        request.query_params.get('period', 'month'),
        request.query_params.get('from'),
        request.query_params.get('to'),
    )
    start = date_range['start_datetime']
    end = date_range['end_datetime_exclusive']
    start_date = date_range['start_date']
    end_date = date_range['end_date']

    submitted = BurialApplication.objects.filter(submitted_at__gte=start, submitted_at__lt=end)
    approved = BurialApplication.objects.filter(approved_at__gte=start, approved_at__lt=end)
    rejected = BurialApplication.objects.filter(rejected_at__gte=start, rejected_at__lt=end)
    documents = BurialDocument.objects.filter(verified_at__gte=start, verified_at__lt=end)
    appointments = InterviewSchedule.objects.filter(scheduled_date__range=(start_date, end_date))
    burials = BurialApplication.objects.filter(burial_date__range=(start_date, end_date))

    scope = 'mayor' if role == 'mayor' else 'cemetery'
    rows_qs = submitted.order_by('-submitted_at') if scope == 'mayor' else burials.order_by('-burial_date')
    rows = [{
        'id': item.application_id,
        'deceased_name': item.deceased_name,
        'funeral_home': item.funeral_home or 'Not recorded',
        'status': item.get_status_display(),
        'event_date': timezone.localtime(item.submitted_at).date().isoformat() if scope == 'mayor' else item.burial_date.isoformat(),
    } for item in rows_qs[:250]]
    funeral_home_breakdown = list(
        submitted
        .values('funeral_home')
        .annotate(count=Count('id'))
        .order_by('-count', 'funeral_home')
    )
    funeral_home_breakdown = [
        {'funeral_home': item['funeral_home'] or 'Not recorded', 'count': item['count']}
        for item in funeral_home_breakdown
    ]

    from .report_applications import application_report_details
    from .staff_reports import staff_operations_report
    return Response({
        **({'staff_operations': staff_operations_report(start_date, end_date)} if scope == 'cemetery' else {}),
        **application_report_details(start_date, end_date),
        'scope': scope,
        'period': date_range['period'],
        'from': start_date.isoformat(),
        'to': end_date.isoformat(),
        'metrics': {
            'applications_submitted': submitted.count(),
            'applications_approved': approved.count(),
            'applications_rejected': rejected.count(),
            'documents_verified': documents.count(),
            'appointments_scheduled': appointments.count(),
            'burials': burials.count(),
        },
        'current_snapshot': {
            'available_graves': Grave.objects.filter(status='available').count(),
            'occupied_graves': Grave.objects.filter(status='occupied').count(),
            'available_plots': active_plots(BurialPlot.objects.filter(status='available')).count(),
            'occupied_plots': active_plots(BurialPlot.objects.filter(status='occupied')).count(),
            'available_columbarium_slots': active_niches(ColumbariumSlot.objects.filter(status='available')).count(),
            'occupied_columbarium_slots': active_niches(ColumbariumSlot.objects.filter(status='occupied')).count(),
        },
        'records': rows,
        'funeral_home_breakdown': funeral_home_breakdown,
    })


def get_user_role(user):
    return get_role(user)


def is_mayor(user):
    return get_user_role(user) == 'mayor'


def is_planning(user):
    return get_user_role(user) == 'planning'


def is_admin(user):
    # Compatibility name used by existing workflow code.
    return is_mayor(user)


class GraveViewSet(viewsets.ModelViewSet):
    queryset = Grave.objects.all().order_by('grave_id')
    serializer_class = GraveSerializer
    authentication_classes = [authentication.TokenAuthentication]

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsCemeteryStaffOrSuperAdmin()]
        return [permissions.AllowAny()]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)


class ColumbariumViewSet(PlotMaintenanceMixin, viewsets.ModelViewSet):
    queryset = ColumbariumSlot.objects.all().order_by('section', 'floor', 'col')
    serializer_class = ColumbariumSlotSerializer
    authentication_classes = [authentication.TokenAuthentication]

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'create_section', 'transfer', 'maintenance']:
            return [CanManagePlots()]
        return [permissions.AllowAny()]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get('scope') == 'active':
            queryset = active_niches(queryset)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        section_filter = self.request.query_params.get('section')
        if section_filter:
            queryset = queryset.filter(section=section_filter)
        return queryset

    @action(detail=True, methods=['post'], url_path='transfer')
    def transfer(self, request, pk=None):
        target_id = str(request.data.get('target_id', '')).strip()
        if not target_id:
            return Response({'detail': 'A destination niche is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if target_id == str(pk):
            return Response({'detail': 'The destination niche must be different from the source.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            slots = list(
                ColumbariumSlot.objects.select_for_update()
                .filter(pk__in=[pk, target_id])
                .order_by('pk')
            )
            slots_by_id = {slot.pk: slot for slot in slots}
            source = slots_by_id.get(str(pk))
            destination = slots_by_id.get(target_id)
            if source is None:
                return Response({'detail': 'The source niche was not found.'}, status=status.HTTP_404_NOT_FOUND)
            if destination is None:
                return Response({'detail': 'The destination niche was not found.'}, status=status.HTTP_404_NOT_FOUND)
            if source.status != 'occupied' or not source.name:
                return Response({'detail': 'Only an occupied niche with an occupant record can be transferred.'}, status=status.HTTP_409_CONFLICT)
            if destination.status != 'available':
                return Response({'detail': 'The destination niche is no longer available.'}, status=status.HTTP_409_CONFLICT)

            destination.status = 'occupied'
            destination.name = source.name
            source.status = 'available'
            source.name = ''
            source.save(update_fields=['status', 'name', 'updated_at'])
            destination.save(update_fields=['status', 'name', 'updated_at'])

        return Response({
            'source': self.get_serializer(source).data,
            'destination': self.get_serializer(destination).data,
        })

    @action(detail=False, methods=['post'], url_path='create-section')
    def create_section(self, request):
        section = str(request.data.get('section', '')).strip()[:50]
        previous_section = str(request.data.get('previous_section', '')).strip()[:50]
        cemetery_map = str(request.data.get('cemetery_map', 'old')).lower()
        try:
            floors = int(request.data.get('floors', 1))
            columns = int(request.data.get('columns', 1))
        except (TypeError, ValueError):
            return Response({'detail': 'Floors and columns must be valid numbers.'}, status=status.HTTP_400_BAD_REQUEST)
        if not section:
            return Response({'detail': 'Section name is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if cemetery_map not in {'old', 'new'}:
            return Response({'detail': 'Cemetery map must be old or new.'}, status=status.HTTP_400_BAD_REQUEST)
        saved_section = CemeterySection.objects.filter(cemetery__code=cemetery_map, name__iexact=section).first()
        # Older callers omit rows. Prefer the saved layout; retain two sides
        # only for legacy sections without an explicit layout configuration.
        raw_rows = request.data.get('rows', (saved_section.layout_rows if saved_section else None) or 2)
        if str(raw_rows) not in {'1', '2'}:
            return Response({'detail': 'Rows must be 1 (front only) or 2 (front and back).'}, status=status.HTTP_400_BAD_REQUEST)
        rows = int(raw_rows)
        if saved_section and saved_section.layout_rows is not None and (
            rows != saved_section.layout_rows or columns != saved_section.layout_columns
        ):
            return Response({'detail': 'Niche rows and columns must match the saved section layout.'}, status=status.HTTP_409_CONFLICT)
        retired = RetiredCemeterySection.objects.filter(cemetery__code=cemetery_map, name__iexact=section).exists()
        if (saved_section and not saved_section.is_active) or (retired and not saved_section):
            return Response({'detail': 'This section is archived or deleted. Restore or explicitly register an active section before generating niches.'}, status=status.HTTP_409_CONFLICT)
        if not 1 <= floors <= 10 or not 1 <= columns <= 132:
            return Response({'detail': 'Floors must be 1-10 and columns must be 1-132.'}, status=status.HTTP_400_BAD_REQUEST)
        total_columns = columns * rows
        if previous_section and previous_section.casefold() != section.casefold():
            previous_slots = ColumbariumSlot.objects.filter(section=previous_section, cemetery_map=cemetery_map)
            target_slots = ColumbariumSlot.objects.filter(section__iexact=section, cemetery_map=cemetery_map)
            if previous_slots.exists() and target_slots.exists():
                return Response({'detail': 'Niche records already use the new section name.'}, status=status.HTTP_409_CONFLICT)
            if previous_slots.exclude(floor__lte=floors, col__lte=total_columns).exclude(status='available', name='').exists():
                return Response({'detail': 'Occupied slots would fall outside the requested layout.'}, status=status.HTTP_409_CONFLICT)
            previous_slots.update(section=section)
        existing_slots = ColumbariumSlot.objects.filter(section=section, cemetery_map=cemetery_map)
        if existing_slots.exists():
            protected_outside_layout = existing_slots.exclude(floor__lte=floors, col__lte=total_columns).exclude(status='available', name='')
            if protected_outside_layout.exists():
                return Response({'detail': 'The columbarium cannot be reduced because occupied slots fall outside the requested floors or columns.'}, status=status.HTTP_409_CONFLICT)
            with transaction.atomic():
                existing_slots.exclude(floor__lte=floors, col__lte=total_columns).delete()
                existing_positions = set(existing_slots.values_list('floor', 'col'))
                safe_code = re.sub(r'[^A-Z0-9]+', '-', section.upper()).strip('-') or 'SECTION'
                prefix = f'{cemetery_map.upper()}-{safe_code}'[:35]
                missing_slots = [ColumbariumSlot(
                    id=f'{prefix}-F{floor}-C{column}', section=section, floor=floor, col=column,
                    cemetery_map=cemetery_map, status='available', name='',
                ) for floor in range(1, floors + 1) for column in range(1, total_columns + 1)
                  if (floor, column) not in existing_positions]
                ColumbariumSlot.objects.bulk_create(missing_slots)
            refreshed_slots = ColumbariumSlot.objects.filter(section=section, cemetery_map=cemetery_map)
            return Response(self.get_serializer(refreshed_slots, many=True).data, status=status.HTTP_200_OK)
        safe_code = re.sub(r'[^A-Z0-9]+', '-', section.upper()).strip('-') or 'SECTION'
        prefix = f'{cemetery_map.upper()}-{safe_code}'[:35]
        slots = [ColumbariumSlot(
            id=f'{prefix}-F{floor}-C{column}', section=section, floor=floor, col=column,
            cemetery_map=cemetery_map, status='available', name='',
        ) for floor in range(1, floors + 1) for column in range(1, total_columns + 1)]
        with transaction.atomic():
            ColumbariumSlot.objects.bulk_create(slots)
        return Response(self.get_serializer(slots, many=True).data, status=status.HTTP_201_CREATED)


class CemeteryViewSet(viewsets.ModelViewSet):
    serializer_class = CemeterySerializer
    authentication_classes = [authentication.TokenAuthentication]

    def get_queryset(self):
        return Cemetery.objects.annotate(
            section_count=Count('sections', distinct=True),
            plot_count=Count('ground_plots', distinct=True),
        ).order_by('name')

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsCPDOOrSuperAdmin()]
        return [permissions.AllowAny()]


class CemeterySectionViewSet(viewsets.ModelViewSet):
    queryset = CemeterySection.objects.all()
    serializer_class = CemeterySectionSerializer
    authentication_classes = [authentication.TokenAuthentication]

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsCPDOOrSuperAdmin()]
        return [permissions.AllowAny()]

    def perform_update(self, serializer):
        old_name = serializer.instance.name
        old_code = serializer.instance.zone_code
        with transaction.atomic():
            section = serializer.save()
            if old_name != section.name:
                if section.cemetery_id:
                    ColumbariumSlot.objects.filter(
                        cemetery_map=section.cemetery.code, section__iexact=old_name,
                    ).update(section=section.name)
            if old_name != section.name or old_code != section.zone_code:
                section.ground_plots.update(section=(section.zone_code or section.name)[:10])
                plots = list(section.ground_plots.all())
                for plot in plots:
                    if plot.location_description.startswith(f'{old_name}, '):
                        plot.location_description = f'{section.name}{plot.location_description[len(old_name):]}'
                BurialPlot.objects.bulk_update(plots, ['location_description'])

    def get_queryset(self):
        queryset = super().get_queryset().select_related('cemetery').annotate(
            total_plots=Count('ground_plots', distinct=True),
            available_plots=Count('ground_plots', filter=Q(ground_plots__status=BurialPlot.PlotStatus.AVAILABLE), distinct=True),
            occupied_plots=Count('ground_plots', filter=Q(ground_plots__status=BurialPlot.PlotStatus.OCCUPIED), distinct=True),
            maintenance_plots=Count('ground_plots', filter=Q(ground_plots__status=BurialPlot.PlotStatus.MAINTENANCE), distinct=True),
        )
        cemetery = self.request.query_params.get('cemetery')
        if cemetery:
            queryset = queryset.filter(cemetery_id=int(cemetery)) if cemetery.isdigit() else queryset.filter(cemetery__code=cemetery)
        active_filter = self.request.query_params.get('active')
        if active_filter in ('true', '1'):
            queryset = queryset.filter(is_active=True)
        elif active_filter in ('false', '0'):
            queryset = queryset.filter(is_active=False)
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(zone_code__icontains=search))
        return queryset

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        zone = CemeterySection.objects.select_for_update().get(pk=self.get_object().pk)
        list(zone.ground_plots.select_for_update())
        if zone.is_active:
            return Response(
                {'detail': 'Active zones cannot be permanently deleted. Archive the zone first.'},
                status=status.HTTP_409_CONFLICT,
            )
        protected_plots = zone.ground_plots.exclude(
            status=BurialPlot.PlotStatus.AVAILABLE,
            assigned_to__isnull=True,
            occupied_by_application__isnull=True,
        )
        if protected_plots.exists():
            return Response(
                {'detail': 'This archived zone contains occupied, assigned, or protected grave records and cannot be permanently deleted.'},
                status=status.HTTP_409_CONFLICT,
            )
        # Columbarium slots are not related to CemeterySection at the database
        # level; they are linked by the cemetery code and section name.  Remove
        # the unused slots with the section so a deleted CPDO trial section does
        # not remain visible in Apartment Niches.  A non-available slot is
        # protected for the same reason as an occupied or assigned ground plot.
        niche_slots = ColumbariumSlot.objects.none()
        if zone.cemetery_id:
            niche_slots = ColumbariumSlot.objects.filter(
                cemetery_map=zone.cemetery.code,
                section__iexact=zone.name,
            )
        list(niche_slots.select_for_update())
        protected_niche_slots = niche_slots.exclude(status='available') | niche_slots.exclude(name='').exclude(name__isnull=True)
        if protected_niche_slots.exists():
            return Response(
                {'detail': 'This archived zone contains occupied or protected apartment niche records and cannot be permanently deleted.'},
                status=status.HTTP_409_CONFLICT,
            )
        with transaction.atomic():
            deleted_graves = zone.ground_plots.count()
            deleted_niches = niche_slots.count()
            zone.ground_plots.all().delete()
            niche_slots.delete()
            if zone.cemetery_id:
                for name in (zone.name, zone.legacy_source_name):
                    if name:
                        RetiredCemeterySection.objects.get_or_create(cemetery_id=zone.cemetery_id, name=name)
            zone.delete()
        return Response({
            'detail': 'Archived zone permanently deleted.',
            'deleted_graves': deleted_graves,
            'deleted_niches': deleted_niches,
        }, status=status.HTTP_200_OK)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'type': 'FeatureCollection',
            'features': serializer.data,
            'retired_sections': list(RetiredCemeterySection.objects.values('id', 'name', 'cemetery_id', 'cemetery__code')),
        })


class CemeteryPathwayViewSet(viewsets.ModelViewSet):
    queryset = CemeteryPathway.objects.select_related('cemetery').all()
    serializer_class = CemeteryPathwaySerializer
    authentication_classes = [authentication.TokenAuthentication]

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsCPDOOrSuperAdmin()]
        return [permissions.AllowAny()]

    def get_queryset(self):
        queryset = super().get_queryset()
        cemetery = self.request.query_params.get('cemetery')
        if cemetery:
            queryset = queryset.filter(cemetery_id=int(cemetery)) if cemetery.isdigit() else queryset.filter(cemetery__code=cemetery)
        active_filter = self.request.query_params.get('active')
        if active_filter in ('true', '1'):
            queryset = queryset.filter(is_active=True)
        elif active_filter in ('false', '0'):
            queryset = queryset.filter(is_active=False)
        return queryset

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.filter_queryset(self.get_queryset()), many=True)
        return Response({'type': 'FeatureCollection', 'features': serializer.data})


class ApplicationViewSet(viewsets.ModelViewSet):
    queryset = Application.objects.all().order_by('-submitted')
    serializer_class = ApplicationSerializer
    authentication_classes = [authentication.TokenAuthentication]

    def get_permissions(self):
        return [IsGraveTrakSuperAdmin()]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        return queryset


class BurialApplicationViewSet(viewsets.ModelViewSet):
    queryset = BurialApplication.objects.all().order_by('-created_at')
    serializer_class = BurialApplicationListSerializer
    authentication_classes = [authentication.TokenAuthentication]
    parser_classes = [parsers.MultiPartParser, parsers.FormParser, parsers.JSONParser]

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.AllowAny()]
        if self.action in ['update', 'partial_update', 'destroy']:
            return [CanManageApplications()]
        return [permissions.IsAuthenticated()]

    def get_serializer_class(self):
        if self.action == 'create':
            return BurialApplicationCreateSerializer
        if self.action == 'list':
            return BurialApplicationListSerializer
        if self.action == 'retrieve':
            if is_mayor(self.request.user):
                return BurialApplicationMayorSerializer
            return BurialApplicationDetailSerializer
        return BurialApplicationMayorSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == 'list':
            queryset = queryset.select_related(
                'interview_schedule__created_by',
                'assigned_plot',
                'assigned_plot__cemetery',
                'assigned_plot__section_record',
            ).prefetch_related('documents__verified_by')
        else:
            queryset = queryset.prefetch_related('documents', 'interview_schedule', 'status_history')
        user = self.request.user
        if not user.is_authenticated:
            return BurialApplication.objects.none()
        if is_mayor(user) or is_planning(user):
            return queryset
        if get_user_role(user) == 'staff':
            return queryset.filter(status__in=['scheduled', 'completed'])
        return queryset.filter(submitted_by=user)

    @transaction.atomic
    def perform_create(self, serializer):
        application = serializer.save()
        NotificationEngine.send_status_notification(application, application.status)

    def create(self, request, *args, **kwargs):
        logger.info('BurialApplication create called: user=%s, data_keys=%s, files=%s',
                    request.user if request.user.is_authenticated else 'anonymous',
                    list(request.data.keys()),
                    list(request.FILES.keys()))
        response = super().create(request, *args, **kwargs)
        logger.info('BurialApplication created response status=%s, response_data=%s', response.status_code, response.data)
        return response

    @action(detail=True, methods=['post'], url_path='upload-documents')
    def upload_documents(self, request, pk=None):
        application = self.get_object()
        if application.submitted_by and application.submitted_by != request.user and not is_mayor(request.user):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        files = request.FILES
        created = []
        errors = []
        for field_name, upload in files.items():
            serializer = BurialDocumentUploadSerializer(data={'document_type': field_name, 'document_file': upload})
            if serializer.is_valid():
                document_type = field_name
                if field_name not in [choice[0] for choice in BurialDocument.DocumentType.choices]:
                    errors.append(f'Unknown document field: {field_name}')
                    continue
                BurialDocument.objects.update_or_create(
                    application=application,
                    document_type=document_type,
                    defaults={
                        'document_file': upload,
                        'uploaded_by': request.user if request.user.is_authenticated else None,
                        'verification_status': BurialDocument.VerificationStatus.PENDING_REVIEW,
                        'verified': False,
                        'verification_note': '',
                        'verified_by': None,
                        'verified_at': None,
                    }
                )
                created.append(field_name)
            else:
                errors.append({field_name: serializer.errors})

        if created and application.status == BurialApplication.ApplicationStatus.ACTION_REQUIRED:
            ApplicationWorkflowEngine.transition(
                application,
                BurialApplication.ApplicationStatus.PENDING_REVIEW,
                changed_by=request.user,
                reason='Corrected document uploaded; returned to document review.',
            )

        return Response({
            'uploaded': created,
            'errors': errors,
            'document_completeness': application.document_completeness,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='request-action')
    @transaction.atomic
    def request_action(self, request, pk=None):
        if not has_capability(request.user, 'review_documents'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        application = self.get_object()
        reason = request.data.get('reason', '')
        success, message = ApplicationWorkflowEngine.transition(
            application,
            BurialApplication.ApplicationStatus.ACTION_REQUIRED,
            changed_by=request.user,
            reason=reason,
        )
        if not success:
            return Response({'detail': message}, status=status.HTTP_400_BAD_REQUEST)

        application.action_required_reason = reason
        application.save()
        NotificationEngine.send_status_notification(application, application.status)
        return Response({'detail': message})

    @action(detail=True, methods=['post'], url_path='complete-document-review')
    @transaction.atomic
    def complete_document_review(self, request, pk=None):
        if not has_capability(request.user, 'review_documents') or not is_mayor(request.user):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        application = self.get_object()
        application = BurialApplication.objects.select_for_update().get(pk=application.pk)
        completeness = application.document_completeness
        documents = list(application.documents.order_by('pk').values('id', 'document_file', 'verification_status', 'verification_note', 'uploaded_at'))
        if any(doc['verification_status'] == 'needs_correction' for doc in documents):
            if application.status not in ('pending_review', 'action_required'):
                return Response({'detail': 'This application is no longer in document review.'}, status=400)
            if any(doc['verification_status'] == 'pending_review' for doc in documents):
                return Response({'detail': 'Review all submitted documents before finalizing corrections.'}, status=400)
            fingerprint = hashlib.sha256(json.dumps(documents, default=str, sort_keys=True).encode()).hexdigest()
            ApplicationWorkflowEngine.transition(application, 'action_required', changed_by=request.user,
                reason='Document review finalized with corrections.')
            message = f'Some documents in Burial Application {application.application_id} require correction. Please review the application and resubmit the requested documents.'
            NotificationService.create(application, 'documents_correction', 'Documents Need Correction', message,
                f'review:{application.pk}:{fingerprint}',
                f'GraveTrak: Action is required for Burial Application {application.application_id}. Some submitted documents need correction. Please log in to GraveTrak to review and resubmit them.')
            return Response({'detail': 'Review finalized. In-app notification created; external SMS delivery is not configured.',
                'status': application.status, 'document_completeness': completeness})
        if not completeness['ready_for_further_processing']:
            return Response({
                'detail': 'All required documents must be marked complete before finishing document review.',
                'document_completeness': completeness,
            }, status=status.HTTP_400_BAD_REQUEST)

        if application.status == BurialApplication.ApplicationStatus.DOCUMENTS_COMPLETE:
            return Response({
                'detail': 'Document review is already complete.',
                'status': application.status,
                'document_completeness': completeness,
            })

        success, message = ApplicationWorkflowEngine.transition(
            application,
            BurialApplication.ApplicationStatus.DOCUMENTS_COMPLETE,
            changed_by=request.user,
            reason='All required documents passed completeness review. Ready for appointment scheduling.',
        )
        if not success:
            return Response({'detail': message}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'detail': message,
            'status': application.status,
            'status_display': application.get_status_display(),
            'document_completeness': completeness,
        })

    @action(detail=True, methods=['get', 'post'], url_path='notify')
    @transaction.atomic
    def notify(self, request, pk=None):
        if not has_capability(request.user, 'manage_applications'):
            return Response({'detail': 'Permission denied.'}, status=403)
        application = self.get_object()
        if request.method == 'GET':
            return Response({'recipient': masked_owner_contact(application), 'has_owner': bool(application.submitted_by_id)})
        application = BurialApplication.objects.select_for_update().get(pk=application.pk)
        message = request.data.get('message')
        if not isinstance(message, str) or not 1 <= len(message.strip()) <= 1000:
            return Response({'detail': 'Message must contain 1 to 1000 characters.'}, status=400)
        try:
            key = str(uuid.UUID(str(request.data.get('idempotency_key', ''))))
        except ValueError:
            return Response({'detail': 'A valid idempotency_key UUID is required.'}, status=400)
        if not application.submitted_by_id:
            return Response({'detail': 'This application has no linked applicant account; an in-app notification cannot be delivered.'}, status=400)
        event_key = f'manual:{application.pk}:{request.user.pk}:{key}'
        existing = Notification.objects.filter(event_key=event_key).first()
        if existing and existing.message != message.strip():
            return Response({'detail': 'This request key was already used for a different message.'}, status=409)
        notification = NotificationService.create(application, 'manual_notification', 'Burial Application Update',
            message.strip(), event_key,
            f'GraveTrak: Your Burial Application {application.application_id} has an important update. Please log in to GraveTrak to review the details.')
        return Response({'detail': 'In-app notification created. SMS status: ' + notification.sms_outbox.get_status_display() + '.',
            'notification_id': notification.pk, 'sms_status': notification.sms_outbox.status})

    @action(detail=True, methods=['post'], url_path='approve-and-assign')
    def approve_and_assign(self, request, pk=None):
        if not has_capability(request.user, 'manage_applications') or not has_capability(request.user, 'allocate_plots'):
            return Response({'detail': 'Permission denied.'}, status=403)
        from .application_assignment import approve_and_assign
        application, item = approve_and_assign(self.get_object().pk,
            request.data.get('type'), request.data.get('target_id'), request.user)
        serializer = ColumbariumSlotSerializer if request.data.get('type') == 'columbarium' else GraveSerializer
        return Response({'application': BurialApplicationListSerializer(application).data,
                         'location': serializer(item).data})

    @action(detail=True, methods=['post'], url_path='assign-plot')
    def assign_plot(self, request, pk=None):
        if not has_capability(request.user, 'allocate_plots'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        application = self.get_object()
        if not application.document_completeness['ready_for_further_processing']:
            return Response({'detail': 'All required documents must be complete before further processing.'}, status=status.HTTP_400_BAD_REQUEST)
        plot, success, message = PlotAssignmentEngine.assign_plot_to_application(application)
        if not success:
            return Response({'detail': message}, status=status.HTTP_400_BAD_REQUEST)

        NotificationEngine.send_status_notification(application, application.status)
        return Response({'detail': message, 'plot_id': plot.plot_id})

    @action(detail=True, methods=['post'], url_path='approve')
    @transaction.atomic
    def approve(self, request, pk=None):
        if not has_capability(request.user, 'manage_applications'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        application = self.get_object()
        if not application.document_completeness['ready_for_further_processing']:
            return Response({'detail': 'All required documents must be complete before application approval.'}, status=status.HTTP_400_BAD_REQUEST)
        reason = request.data.get('reason', '')
        success, message = ApplicationWorkflowEngine.transition(
            application,
            BurialApplication.ApplicationStatus.APPROVED,
            changed_by=request.user,
            reason=reason,
        )
        if not success:
            return Response({'detail': message}, status=status.HTTP_400_BAD_REQUEST)

        NotificationEngine.send_status_notification(application, application.status)
        return Response({'detail': message})

    @action(detail=True, methods=['post'], url_path='reject')
    @transaction.atomic
    def reject(self, request, pk=None):
        if not has_capability(request.user, 'manage_applications'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        application = self.get_object()
        reason = request.data.get('reason', '')
        success, message = ApplicationWorkflowEngine.transition(
            application,
            BurialApplication.ApplicationStatus.REJECTED,
            changed_by=request.user,
            reason=reason,
        )
        if not success:
            return Response({'detail': message}, status=status.HTTP_400_BAD_REQUEST)

        application.rejection_reason = reason
        application.save(update_fields=['rejection_reason'])
        NotificationEngine.send_status_notification(application, application.status)
        return Response({'detail': message})

    @action(detail=True, methods=['post'], url_path='schedule-interview')
    def schedule_interview(self, request, pk=None):
        if not has_capability(request.user, 'manage_appointments'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        application = self.get_object()
        if application.status not in [
            BurialApplication.ApplicationStatus.DOCUMENTS_COMPLETE,
            BurialApplication.ApplicationStatus.APPROVED,
            BurialApplication.ApplicationStatus.FOR_INTERVIEW,
        ]:
            return Response({'detail': 'Document review must be complete before scheduling an interview.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = InterviewScheduleSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            schedule = AppointmentScheduler.schedule(
                application=application,
                scheduled_date=serializer.validated_data['scheduled_date'],
                scheduled_time=serializer.validated_data['scheduled_time'],
                duration_minutes=serializer.validated_data.get('duration_minutes'),
                location=serializer.validated_data['location'],
                notes=serializer.validated_data.get('notes', ''),
                user=request.user,
            )
        except SchedulingError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        message = 'Interview scheduled.'

        if application.status != BurialApplication.ApplicationStatus.FOR_INTERVIEW:
            success, message = ApplicationWorkflowEngine.transition(
                application,
                BurialApplication.ApplicationStatus.FOR_INTERVIEW,
                changed_by=request.user,
                reason='Interview scheduled.',
            )
            if not success:
                return Response({'detail': message}, status=status.HTTP_400_BAD_REQUEST)
        NotificationEngine.send_status_notification(application, application.status)
        return Response({'detail': message, 'schedule_id': schedule.id, 'status': application.status})

    @action(detail=True, methods=['get'], url_path='available-appointment-slots')
    def available_appointment_slots(self, request, pk=None):
        if not has_capability(request.user, 'manage_appointments'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
        application = self.get_object()
        if not application.document_completeness['ready_for_further_processing']:
            return Response({'detail': 'Documents must be complete before viewing appointment slots.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            start_date = date.fromisoformat(request.query_params.get('start_date', timezone.localdate().isoformat()))
            days = min(max(int(request.query_params.get('days', 14)), 1), 60)
            slots = AppointmentScheduler.available_slots(start_date, days)
        except (ValueError, SchedulingError) as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        config = AppointmentScheduler.configuration()
        return Response({'slots': slots, 'configuration': {
            'opening_time': config['opening_time'].strftime('%H:%M') if config['opening_time'] else None,
            'closing_time': config['closing_time'].strftime('%H:%M') if config['closing_time'] else None,
            'duration_minutes': config['duration_minutes'],
            'slot_interval_minutes': config['slot_interval_minutes'],
            'maximum_simultaneous': config['maximum_simultaneous'],
            'working_days': sorted(config['working_days']),
            'lunch_start': '12:00', 'lunch_end': '13:00',
        }})

    @action(detail=True, methods=['post'], url_path='auto-schedule-next')
    def auto_schedule_next(self, request, pk=None):
        if not has_capability(request.user, 'manage_appointments'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
        application = self.get_object()
        try:
            slots = AppointmentScheduler.available_slots(timezone.localdate(), 60)
            if not slots:
                raise SchedulingError('No available appointment slot was found in the configured range.')
            slot = slots[0]
            appointment = AppointmentScheduler.schedule(
                application, date.fromisoformat(slot['date']),
                datetime.strptime(slot['time'], '%H:%M').time(),
                request.data.get('location', ''), request.user,
                request.data.get('notes', ''), slot['duration_minutes'],
            )
        except SchedulingError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if application.status != BurialApplication.ApplicationStatus.FOR_INTERVIEW:
            ApplicationWorkflowEngine.transition(application, BurialApplication.ApplicationStatus.FOR_INTERVIEW, changed_by=request.user, reason='Next available interview slot automatically scheduled.')
        return Response({'detail': 'Next available appointment scheduled.', 'appointment': InterviewScheduleSerializer(appointment).data})

    @action(detail=True, methods=['post'], url_path='schedule-burial')
    def schedule_burial(self, request, pk=None):
        if not has_capability(request.user, 'manage_appointments'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        application = self.get_object()
        if application.status != BurialApplication.ApplicationStatus.FOR_INTERVIEW:
            return Response({'detail': 'Application must be in interview stage before burial scheduling.'}, status=status.HTTP_400_BAD_REQUEST)

        application.burial_date = request.data.get('burial_date')
        application.burial_time = request.data.get('burial_time')
        application.burial_location = request.data.get('burial_location', '')
        application.save()

        success, message = ApplicationWorkflowEngine.transition(
            application,
            BurialApplication.ApplicationStatus.SCHEDULED,
            changed_by=request.user,
            reason='Burial scheduled by mayor.',
        )
        NotificationEngine.send_status_notification(application, application.status)
        return Response({'detail': message})

    @action(detail=True, methods=['post'], url_path='mark-completed')
    def mark_completed(self, request, pk=None):
        if not has_capability(request.user, 'manage_grave_status'):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        application = self.get_object()
        if application.status not in [
            BurialApplication.ApplicationStatus.SCHEDULED,
            BurialApplication.ApplicationStatus.SLOT_ASSIGNED,
        ]:
            return Response({'detail': 'Application must have a scheduled burial or assigned burial location before marking completed.'}, status=status.HTTP_400_BAD_REQUEST)

        application.burial_notes = request.data.get('burial_notes', '')
        success, message = ApplicationWorkflowEngine.transition(
            application,
            BurialApplication.ApplicationStatus.COMPLETED,
            changed_by=request.user,
            reason='Burial completed by cemetery staff.',
        )
        if not success:
            return Response({'detail': message}, status=status.HTTP_400_BAD_REQUEST)
        NotificationEngine.send_status_notification(application, application.status)
        return Response({'detail': message})


class BurialPlotViewSet(PlotMaintenanceMixin, viewsets.ModelViewSet):
    queryset = BurialPlot.objects.all().order_by('section', 'plot_number')
    serializer_class = BurialPlotSerializer
    authentication_classes = [authentication.TokenAuthentication]

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'generate_layout', 'maintenance']:
            return [CanManagePlots()]
        return [permissions.AllowAny()]

    def get_queryset(self):
        queryset = super().get_queryset().select_related('cemetery', 'section_record')
        if self.request.query_params.get('scope') == 'active':
            queryset = active_plots(queryset)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        cemetery_filter = self.request.query_params.get('cemetery')
        if cemetery_filter:
            queryset = queryset.filter(cemetery_id=int(cemetery_filter)) if cemetery_filter.isdigit() else queryset.filter(cemetery__code=cemetery_filter)
        section_filter = self.request.query_params.get('section')
        if section_filter:
            queryset = queryset.filter(section_record_id=int(section_filter)) if section_filter.isdigit() else queryset.filter(Q(section__iexact=section_filter) | Q(section_record__name__iexact=section_filter))
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(Q(plot_id__icontains=search) | Q(legacy_plot_id__icontains=search) | Q(location_description__icontains=search) | Q(section_record__name__icontains=search))
        return queryset

    @action(detail=False, methods=['get'])
    def summary(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        # Listing order (section/plot number) must not split status aggregates.
        by_status = {row['status']: row['count'] for row in queryset.order_by().values('status').annotate(count=Count('id'))}
        section_rows = queryset.values('section', 'section_record__name').annotate(
            total=Count('id'),
            available=Count('id', filter=Q(status=BurialPlot.PlotStatus.AVAILABLE)),
            occupied=Count('id', filter=Q(status=BurialPlot.PlotStatus.OCCUPIED)),
            maintenance=Count('id', filter=Q(status=BurialPlot.PlotStatus.MAINTENANCE)),
        ).order_by('section')
        return Response({
            'total': queryset.count(),
            'available': by_status.get(BurialPlot.PlotStatus.AVAILABLE, 0),
            'occupied': by_status.get(BurialPlot.PlotStatus.OCCUPIED, 0),
            'maintenance': by_status.get(BurialPlot.PlotStatus.MAINTENANCE, 0),
            'by_status': by_status,
            'sections': list(section_rows),
        })

    @action(detail=False, methods=['post'], url_path='generate-layout')
    def generate_layout(self, request):
        try:
            section_id = int(request.data.get('section'))
            rows = int(request.data.get('rows'))
            columns = int(request.data.get('columns'))
            floors = int(request.data.get('floors'))
        except (TypeError, ValueError):
            return Response({'detail': 'Section, rows, columns, and floors must be valid numbers.'}, status=status.HTTP_400_BAD_REQUEST)

        if not 1 <= rows <= 50 or not 1 <= columns <= 132:
            return Response({'detail': 'Rows must be between 1 and 50 and columns between 1 and 132.'}, status=status.HTTP_400_BAD_REQUEST)
        if rows * columns > 500:
            return Response({'detail': 'A layout can contain at most 500 graves.'}, status=status.HTTP_400_BAD_REQUEST)
        if not 1 <= floors <= 10:
            return Response({'detail': 'Floors per grave must be between 1 and 10.'}, status=status.HTTP_400_BAD_REQUEST)
        orientation = str(request.data.get('orientation', 'horizontal')).lower()
        if orientation not in {'horizontal', 'vertical'}:
            return Response({'detail': 'Orientation must be horizontal or vertical.'}, status=status.HTTP_400_BAD_REQUEST)
        replace_existing = request.data.get('replace_existing') in (True, 'true', '1', 1)

        try:
            section = CemeterySection.objects.select_related('cemetery').get(pk=section_id)
        except CemeterySection.DoesNotExist:
            return Response({'detail': 'Section not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not section.cemetery_id or not section.geometry:
            return Response({'detail': 'The section must have a cemetery and saved polygon before graves can be generated.'}, status=status.HTTP_400_BAD_REQUEST)
        if not section.is_active:
            return Response({'detail': 'Restore the archived section before generating its layout.'}, status=status.HTTP_409_CONFLICT)
        existing_plots = section.ground_plots.all()
        if existing_plots.exists() and not replace_existing:
            return Response({'detail': 'This section already contains graves. Use layout update instead of duplicate generation.'}, status=status.HTTP_409_CONFLICT)
        if existing_plots.exclude(
            status=BurialPlot.PlotStatus.AVAILABLE,
            assigned_to__isnull=True,
            occupied_by_application__isnull=True,
        ).exists():
            return Response({'detail': 'A layout containing occupied, assigned, or protected graves cannot be regenerated.'}, status=status.HTTP_409_CONFLICT)

        protected_niches = ColumbariumSlot.objects.filter(
            cemetery_map=section.cemetery.code, section__iexact=section.name,
        ).exclude(status='available', name='')
        if protected_niches.exists():
            return Response({'detail': 'A layout containing occupied or protected niches cannot be regenerated.'}, status=status.HTTP_409_CONFLICT)

        ring = section.geometry.get('coordinates', [[]])[0]
        if len(ring) < 4:
            return Response({'detail': 'The saved section polygon is invalid.'}, status=status.HTTP_400_BAD_REQUEST)
        longitudes = [float(point[0]) for point in ring[:-1]]
        latitudes = [float(point[1]) for point in ring[:-1]]
        min_lng, max_lng = min(longitudes), max(longitudes)
        min_lat, max_lat = min(latitudes), max(latitudes)
        # Stable section reference: display names and editable zone codes must
        # not leak trial labels into permanent plot identifiers.
        code = f'S{section.pk:03d}'
        cemetery_code = re.sub(r'[^A-Z0-9]+', '-', section.cemetery.code.upper()).strip('-') or 'CEM'
        section_label = (section.zone_code or section.name)[:10]
        plots = []
        plot_number = 0
        vertices = ring[:-1]
        quadrilateral = vertices if len(vertices) == 4 else None

        def horizontal_score(start, end):
            dx = (float(end[0]) - float(start[0])) * math.cos(math.radians(float(start[1])))
            dy = float(end[1]) - float(start[1])
            return abs(dx) / max(math.hypot(dx, dy), 1e-12)

        if quadrilateral:
            p0, p1, _, p3 = quadrilateral
            first_edge_is_east_west = horizontal_score(p0, p1) > horizontal_score(p3, p0)
            use_first_to_fourth = first_edge_is_east_west if orientation == 'vertical' else not first_edge_is_east_west

        def interpolate(start, end, amount):
            return [start[0] + (end[0] - start[0]) * amount, start[1] + (end[1] - start[1]) * amount]

        for row in range(1, rows + 1):
            for column in range(1, columns + 1):
                if quadrilateral:
                    p0, p1, p2, p3 = quadrilateral
                    # Choose the grid axis by geographic direction rather
                    # than the first corner of the saved polygon.
                    along = (row - 0.5) / rows
                    across = (column - 0.5) / columns
                    if use_first_to_fourth:
                        left = interpolate(p0, p3, along)
                        right = interpolate(p1, p2, along)
                    else:
                        left = interpolate(p3, p2, along)
                        right = interpolate(p0, p1, along)
                    longitude, latitude = interpolate(left, right, across)
                else:
                    if orientation == 'vertical':
                        latitude = max_lat - ((row - 0.5) / rows) * (max_lat - min_lat)
                        longitude = min_lng + ((column - 0.5) / columns) * (max_lng - min_lng)
                    else:
                        latitude = max_lat - ((column - 0.5) / columns) * (max_lat - min_lat)
                        longitude = min_lng + ((row - 0.5) / rows) * (max_lng - min_lng)
                if not point_in_polygon([longitude, latitude], section.geometry):
                    continue
                plot_number += 1
                plots.append(BurialPlot(
                    cemetery=section.cemetery,
                    section_record=section,
                    plot_id=f'{cemetery_code}-{code}-R{row:02d}-C{column:02d}'[:50],
                    section=section_label,
                    plot_number=plot_number,
                    location_description=f'{section.name}, Row {row}, Column {column}',
                    latitude=latitude,
                    longitude=longitude,
                    status=BurialPlot.PlotStatus.AVAILABLE,
                ))
        if not plots:
            return Response({'detail': 'No grave center points fit inside this polygon. Adjust the layout or section boundary.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            if replace_existing:
                existing_plots.delete()
            BurialPlot.objects.bulk_create(plots)
            section.estimated_stack_height = floors
            section.layout_orientation = orientation
            section.layout_rows = rows
            section.layout_columns = columns
            # Explicit regeneration replaces the imported legacy grid ordering.
            section.geometry = {key: value for key, value in section.geometry.items() if key != 'plot_layout'}
            section.save(update_fields=['estimated_stack_height', 'layout_orientation', 'layout_rows', 'layout_columns', 'geometry', 'updated_at'])
        return Response({
            'section': section.pk,
            'rows': rows,
            'columns': columns,
            'graves_created': len(plots),
            'floors_per_grave': floors,
            'orientation': orientation,
            'total_floor_capacity': len(plots) * floors,
        }, status=status.HTTP_201_CREATED)

    def get_serializer_class(self):
        if self.action in ['retrieve', 'update', 'partial_update']:
            return BurialPlotDetailSerializer
        return BurialPlotSerializer


class BurialDocumentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = BurialDocument.objects.all().order_by('-uploaded_at')
    serializer_class = BurialDocumentSerializer
    authentication_classes = [authentication.TokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if is_mayor(user):
            return super().get_queryset()
        return self.queryset.filter(application__submitted_by=user)

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        if not has_capability(request.user, 'review_documents') or not is_mayor(request.user):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        document = self.get_object()
        review_status = request.data.get('verification_status')
        allowed = {
            BurialDocument.VerificationStatus.COMPLETE,
            BurialDocument.VerificationStatus.NEEDS_CORRECTION,
        }
        if review_status not in allowed:
            return Response(
                {'verification_status': 'Choose complete or needs_correction.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        document.verification_status = review_status
        document.verification_note = request.data.get('verification_remarks', request.data.get('verification_note', '')).strip()
        document.verified = review_status == BurialDocument.VerificationStatus.COMPLETE
        document.verified_by = request.user
        document.verified_at = timezone.now()
        document.save(update_fields=[
            'verification_status', 'verification_note', 'verified', 'verified_by', 'verified_at'
        ])
        return Response({
            'document': self.get_serializer(document).data,
            'document_completeness': document.application.document_completeness,
        })

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        document = self.get_object()
        if not document.document_file:
            return Response({'detail': 'Document file not found.'}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(
            document.document_file.open('rb'),
            as_attachment=False,
            filename=document.file_name.rsplit('/', 1)[-1],
        )


class InterviewScheduleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = InterviewSchedule.objects.all().order_by('-scheduled_date')
    serializer_class = InterviewScheduleSerializer
    authentication_classes = [authentication.TokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if is_mayor(user):
            return super().get_queryset()
        if get_user_role(user) == 'staff':
            return self.queryset.filter(application__status__in=['scheduled', 'completed'])
        return self.queryset.filter(application__submitted_by=user)

    @action(detail=True, methods=['post'])
    def reschedule(self, request, pk=None):
        if not has_capability(request.user, 'manage_appointments') or not is_mayor(request.user):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
        appointment = self.get_object()
        serializer = InterviewScheduleSerializer(appointment, data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            appointment = AppointmentScheduler.reschedule(
                appointment, serializer.validated_data['scheduled_date'],
                serializer.validated_data['scheduled_time'], serializer.validated_data['location'],
                request.user, serializer.validated_data.get('notes', ''),
                serializer.validated_data.get('duration_minutes'),
            )
        except SchedulingError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'detail': 'Appointment rescheduled.', 'appointment': self.get_serializer(appointment).data})

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        if not has_capability(request.user, 'manage_appointments') or not is_mayor(request.user):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
        appointment = self.get_object()
        if appointment.status != 'scheduled':
            return Response({'detail': 'Only a scheduled appointment can be cancelled.'}, status=status.HTTP_400_BAD_REQUEST)
        reason = request.data.get('reason', '').strip()
        appointment.status = 'cancelled'
        appointment.cancelled_at = timezone.now()
        appointment.cancellation_reason = reason
        appointment.save(update_fields=['status', 'cancelled_at', 'cancellation_reason', 'updated_at'])
        application = appointment.application
        old_status = application.status
        if application.status == BurialApplication.ApplicationStatus.FOR_INTERVIEW:
            application.status = BurialApplication.ApplicationStatus.DOCUMENTS_COMPLETE
            application.save(update_fields=['status', 'updated_at'])
        from .models import StatusAuditLog
        StatusAuditLog.objects.create(application=application, old_status=old_status, new_status=application.status, changed_by=request.user, reason=f'Appointment cancelled. {reason}'.strip())
        return Response({'detail': 'Appointment cancelled. The slot is available again.', 'appointment': self.get_serializer(appointment).data})


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Notification.objects.all().order_by('-created_at', '-id')
    serializer_class = NotificationSerializer
    authentication_classes = [authentication.TokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return self.queryset.filter(recipient=user)

    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        return Response({'count': self.get_queryset().filter(read=False).count()})

    @action(detail=True, methods=['post'], url_path='mark-read')
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if not notification.read:
            notification.mark_read()
        return Response(self.get_serializer(notification).data)


class SystemSettingsViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SystemSettings.objects.all().order_by('setting_key')
    serializer_class = SystemSettingsSerializer
    authentication_classes = [authentication.TokenAuthentication]
    permission_classes = [IsGraveTrakSuperAdmin]


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def login_view(request):
    email = request.data.get('email')
    password = request.data.get('password')
    if not email or not password:
        return Response({'detail': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

    user = authenticate(username=email, password=password)
    if not user:
        return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    token, _ = Token.objects.get_or_create(user=user)
    user.last_login = timezone.now()
    user.save(update_fields=['last_login'])
    serializer = UserSerializer(user)
    return Response({'token': token.key, 'user': serializer.data})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        token = Token.objects.create(user=user)
        return Response({'token': token.key, 'user': UserSerializer(user).data}, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH'])
@authentication_classes([authentication.TokenAuthentication])
@permission_classes([permissions.IsAuthenticated])
def profile_view(request):
    if request.method == 'PATCH':
        from .account_settings import update_own_profile
        return update_own_profile(request)
    serializer = UserSerializer(request.user)
    return Response(serializer.data)


@api_view(['POST'])
@authentication_classes([authentication.TokenAuthentication])
@permission_classes([permissions.IsAuthenticated])
def logout_view(request):
    Token.objects.filter(user=request.user).delete()
    return Response({'detail': 'Logged out.'}, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
@authentication_classes([authentication.TokenAuthentication])
@permission_classes([permissions.IsAuthenticated])
def user_list_view(request):
    if not has_capability(request.user, 'manage_users'):
        return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'POST':
        if request.data.get('role', 'user') != 'user' and not has_capability(request.user, 'assign_roles'):
            return Response({'detail': 'You do not have permission to assign roles.'}, status=status.HTTP_403_FORBIDDEN)
        if request.data.get('permissions') and not has_capability(request.user, 'manage_permissions'):
            return Response({'detail': 'You do not have permission to manage user permissions.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = AdminUserCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        try:
            user = serializer.save()
        except IntegrityError:
            return Response({'email': ['A user with this email already exists.']}, status=status.HTTP_400_BAD_REQUEST)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)
    queryset = User.objects.select_related('profile').all().order_by('id')
    serializer = UserSerializer(queryset, many=True)
    return Response(serializer.data)


@api_view(['PATCH'])
@authentication_classes([authentication.TokenAuthentication])
@permission_classes([permissions.IsAuthenticated])
def user_detail_view(request, pk):
    if not has_capability(request.user, 'manage_users'):
        return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)
    if 'role' in request.data and not has_capability(request.user, 'assign_roles'):
        return Response({'detail': 'You do not have permission to assign roles.'}, status=status.HTTP_403_FORBIDDEN)
    if 'permissions' in request.data and not has_capability(request.user, 'manage_permissions'):
        return Response({'detail': 'You do not have permission to manage user permissions.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        user = User.objects.select_related('profile').get(pk=pk)
    except User.DoesNotExist:
        return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    serializer = UserUpdateSerializer(user, data=request.data, partial=True, context={'request': request})
    serializer.is_valid(raise_exception=True)
    try:
        serializer.save()
    except IntegrityError:
        return Response({'email': ['A user with this email already exists.']}, status=status.HTTP_400_BAD_REQUEST)
    return Response(UserSerializer(user).data)
