from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.response import Response

from .models import SavedGrave


class CitizenOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and getattr(getattr(request.user, 'profile', None), 'role', None) == 'user'


class GraveDetailsSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    location = serializers.CharField(max_length=500, allow_blank=True, required=False)
    dates = serializers.CharField(max_length=200, allow_blank=True, required=False)
    section = serializers.CharField(max_length=200, allow_blank=True, required=False)
    latlng = serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2)
    floor = serializers.IntegerField(min_value=1, max_value=100, required=False)

    def validate_latlng(self, value):
        if not (-90 <= value[0] <= 90 and -180 <= value[1] <= 180):
            raise serializers.ValidationError('Invalid map coordinates.')
        return value


class SavedGraveSerializer(serializers.ModelSerializer):
    details = GraveDetailsSerializer()

    class Meta:
        model = SavedGrave
        fields = ['id', 'grave_id', 'cemetery', 'details', 'created_at']
        read_only_fields = ['id', 'created_at']
        validators = []


class SavedGraveViewSet(mixins.ListModelMixin, mixins.CreateModelMixin,
                        mixins.RetrieveModelMixin, mixins.DestroyModelMixin,
                        viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated, CitizenOnly]
    serializer_class = SavedGraveSerializer
    pagination_class = None

    def get_queryset(self):
        return SavedGrave.objects.filter(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        saved, created = SavedGrave.objects.get_or_create(
            user=request.user, grave_id=data['grave_id'], cemetery=data['cemetery'],
            defaults={'details': data['details']},
        )
        return Response(self.get_serializer(saved).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
