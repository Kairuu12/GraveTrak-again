"""Self-service settings using the existing Django user/profile and token auth."""
from collections.abc import Mapping
from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.views.decorators.debug import sensitive_post_parameters
from rest_framework import serializers
from rest_framework.authentication import TokenAuthentication
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import UserProfile
from .notifications import normalize_ph_mobile
from .user_preferences import get_preferences

User = get_user_model()


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            return super().to_internal_value(data)
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({key: 'This field cannot be updated here.' for key in unknown})
        return super().to_internal_value(data)


class ProfileUpdateSerializer(StrictSerializer):
    first_name = serializers.CharField(max_length=150, allow_blank=True)
    last_name = serializers.CharField(max_length=150, allow_blank=True)
    email = serializers.EmailField(max_length=150)
    contact_number = serializers.CharField(max_length=30)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.exclude(pk=self.context['user'].pk).filter(Q(username__iexact=value) | Q(email__iexact=value)).exists():
            raise serializers.ValidationError('This email address is already in use.')
        return value

    def validate_contact_number(self, value):
        number = normalize_ph_mobile(value)
        if not number:
            raise serializers.ValidationError('Enter a valid Philippine mobile number, such as 09XXXXXXXXX.')
        # The existing profile UI uses local 09 format; SMS preparation uses +63.
        return '0' + number[3:]

    def validate(self, attrs):
        user = self.context['user']
        if not (attrs.get('first_name', user.first_name).strip() or attrs.get('last_name', user.last_name).strip()):
            raise serializers.ValidationError({'first_name': 'Full name is required.'})
        return attrs


class PreferencesSerializer(StrictSerializer):
    email_notifications = serializers.BooleanField(required=False)
    cemetery_announcements = serializers.BooleanField(required=False)
    sms_notifications = serializers.BooleanField(required=False)
    theme = serializers.ChoiceField(choices=['light', 'dark', 'system'], required=False)
    text_size = serializers.ChoiceField(choices=['standard', 'medium', 'large'], required=False)
    high_contrast = serializers.BooleanField(required=False)

    def validate_sms_notifications(self, value):
        from .sms_provider import sms_available
        if value and not sms_available():
            raise serializers.ValidationError('SMS delivery is not configured yet.')
        return value


class PasswordChangeSerializer(StrictSerializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=4096)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=4096)
    confirm_password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=4096)

    def validate(self, attrs):
        user = self.context['user']
        if not user.check_password(attrs['current_password']):
            raise serializers.ValidationError({'current_password': 'Current password is incorrect.'})
        if attrs['new_password'] != attrs['confirm_password']:
            raise serializers.ValidationError({'confirm_password': 'New passwords do not match.'})
        if attrs['new_password'] == attrs['current_password']:
            raise serializers.ValidationError({'new_password': 'Choose a password different from your current password.'})
        try:
            password_validation.validate_password(attrs['new_password'], user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'new_password': list(exc.messages)})
        return attrs


def update_own_profile(request):
    """Called by the existing profile route, never by a client-supplied user ID."""
    from .serializers import UserSerializer
    try:
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=request.user.pk)
            serializer = ProfileUpdateSerializer(data=request.data, partial=True, context={'user': user})
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            for field in ('first_name', 'last_name'):
                if field in data:
                    setattr(user, field, data[field])
            if 'email' in data:
                from .email_verification import invalidate_email_verification, normalized_email
                if normalized_email(user.email) != normalized_email(data['email']):
                    invalidate_email_verification(user.pk)
                user.username = user.email = data['email']
            user.save(update_fields=['first_name', 'last_name', 'username', 'email'])
            if 'contact_number' in data:
                profile, _ = UserProfile.objects.get_or_create(user=user)
                profile.contact_number = data['contact_number']
                profile.save(update_fields=['contact_number'])
            return Response(UserSerializer(user).data)
    except IntegrityError:
        return Response({'email': ['This email address is already in use.']}, status=400)


@api_view(['GET', 'PATCH'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def preferences_view(request):
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        if request.method == 'PATCH':
            serializer = PreferencesSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            profile, _ = UserProfile.objects.get_or_create(user=user)
            user.profile = profile
            profile.preferences = {**get_preferences(user), **serializer.validated_data}
            profile.save(update_fields=['preferences'])
        return Response({'preferences': get_preferences(user)})


@sensitive_post_parameters('current_password', 'new_password', 'confirm_password')
@api_view(['POST'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        serializer = PasswordChangeSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data['new_password'])
        user.save(update_fields=['password'])
        # The existing auth uses one token per user. Rotate it and keep this
        # device signed in with the replacement; the former token is revoked.
        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)
    return Response({'detail': 'Password updated.', 'token': token.key})
