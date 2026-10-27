"""Individual inventory maintenance, preserving occupancy and assignments."""
from django.db import transaction
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .permissions import CanManagePlots


class MaintenanceRequestSerializer(serializers.Serializer):
    operation = serializers.ChoiceField(choices=['start', 'update', 'complete'])
    notes = serializers.CharField(allow_blank=True, max_length=5000)
    expected_updated_at = serializers.DateTimeField()


class PlotMaintenanceMixin:
    @action(detail=True, methods=['post'], permission_classes=[CanManagePlots])
    def maintenance(self, request, pk=None):
        payload = MaintenanceRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        with transaction.atomic():
            # Lock the same inventory record used by assignment and transfer.
            item = self.get_queryset().select_related(None).select_for_update().get(pk=self.get_object().pk)
            if item.updated_at != data['expected_updated_at']:
                return Response({'detail': 'This record changed. Refresh the list and try again.'}, status=status.HTTP_409_CONFLICT)
            operation = data['operation']
            if operation == 'start':
                if item.status not in ('available', 'occupied'):
                    return Response({'detail': 'This unit cannot start maintenance in its current status.'}, status=status.HTTP_409_CONFLICT)
                if not data['notes'].strip():
                    raise serializers.ValidationError({'notes': 'Enter a maintenance reason.'})
                item.maintenance_previous_status = item.status
                item.status = 'maintenance'
            else:
                if item.status != 'maintenance':
                    return Response({'detail': 'This unit is not under maintenance.'}, status=status.HTTP_409_CONFLICT)
                if operation == 'complete':
                    previous = item.maintenance_previous_status
                    # Legacy maintenance records may not have a saved status.
                    occupied = bool(getattr(item, 'name', None) or getattr(item, 'occupied_by_application_id', None))
                    item.status = 'occupied' if occupied else (previous or 'available')
                    item.maintenance_previous_status = ''
            item.maintenance_notes = data['notes']
            item.save(update_fields=['status', 'maintenance_previous_status', 'maintenance_notes', 'updated_at'])
        return Response(self.get_serializer(item).data)


def validate_maintenance_status(instance, attrs):
    """Require the maintenance action so status restoration cannot be bypassed."""
    next_status = attrs.get('status')
    current = getattr(instance, 'status', None)
    if next_status and next_status != current and 'maintenance' in (next_status, current):
        raise serializers.ValidationError({'status': 'Use the individual maintenance action to start or complete maintenance.'})
    if current == 'maintenance' and 'name' in attrs and attrs['name'] != instance.name:
        raise serializers.ValidationError({'name': 'Complete maintenance before changing the occupant.'})
