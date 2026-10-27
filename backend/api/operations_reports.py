from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from .models import OperationsReport, BurialApplication, InterviewSchedule
from .permissions import get_role, has_capability
from .report_applications import application_report_details
from .staff_reports import staff_operations_report


class ReportAccess(permissions.BasePermission):
    def has_permission(self, request, view):
        return get_role(request.user) in ('staff', 'mayor') and has_capability(request.user, 'generate_reports')


class OperationsReportSerializer(serializers.ModelSerializer):
    author = serializers.SerializerMethodField()
    acknowledged_by_name = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    def get_author(self, obj):
        return obj.submitted_by.get_full_name() or obj.submitted_by.username

    def get_acknowledged_by_name(self, obj):
        return (obj.acknowledged_by.get_full_name() or obj.acknowledged_by.username) if obj.acknowledged_by else None

    def get_status(self, obj):
        return 'acknowledged' if obj.acknowledged_at else 'pending'

    def validate(self, data):
        if data['period_from'] > data['period_to']:
            raise serializers.ValidationError('Start date must not exceed end date.')
        if data['period_to'] > timezone.localdate():
            raise serializers.ValidationError('Future report dates are not allowed.')
        return data

    class Meta:
        model = OperationsReport
        fields = ['id', 'title', 'notes', 'period_from', 'period_to', 'snapshot', 'author', 'submitted_at', 'status', 'acknowledged_at', 'acknowledged_by_name']
        read_only_fields = ['id', 'snapshot', 'author', 'submitted_at', 'status', 'acknowledged_at', 'acknowledged_by_name']
        extra_kwargs = {'notes': {'max_length': 10000}}


class OperationsReportViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                              mixins.CreateModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated, ReportAccess]
    serializer_class = OperationsReportSerializer
    pagination_class = None

    def get_queryset(self):
        queryset = OperationsReport.objects.select_related('submitted_by', 'acknowledged_by')
        return queryset if get_role(self.request.user) == 'mayor' else queryset.filter(submitted_by=self.request.user)

    def perform_create(self, serializer):
        if get_role(self.request.user) != 'staff':
            raise PermissionDenied('Only Cemetery Staff can submit operations reports.')
        start = serializer.validated_data['period_from']
        end = serializer.validated_data['period_to']
        burials = BurialApplication.objects.filter(burial_date__range=(start, end)).order_by('burial_date', 'pk')
        snapshot = {
            'staff_operations': staff_operations_report(start, end),
            **application_report_details(start, end),
            'metrics': {
                'burials': burials.count(),
                'appointments_scheduled': InterviewSchedule.objects.filter(scheduled_date__range=(start, end)).count(),
                'applications_submitted': BurialApplication.objects.filter(submitted_at__date__range=(start, end)).count(),
                'applications_approved': BurialApplication.objects.filter(approved_at__date__range=(start, end)).count(),
                'applications_rejected': BurialApplication.objects.filter(rejected_at__date__range=(start, end)).count(),
            },
            'records': [{'id': item.application_id, 'deceased_name': item.deceased_name,
                         'event_date': item.burial_date.isoformat(), 'status': item.get_status_display()} for item in burials],
        }
        serializer.save(submitted_by=self.request.user, snapshot=snapshot)

    @action(detail=True, methods=['post'])
    def acknowledge(self, request, pk=None):
        if get_role(request.user) != 'mayor':
            raise PermissionDenied('Only the Mayor’s Office can acknowledge reports.')
        with transaction.atomic():
            report = self.get_queryset().select_for_update().get(pk=self.get_object().pk)
            if report.acknowledged_at is None:
                report.acknowledged_by = request.user
                report.acknowledged_at = timezone.now()
                report.save(update_fields=['acknowledged_by', 'acknowledged_at'])
        return Response(self.get_serializer(report).data)
