"""Explicit mailbox verification; codes are hashed, expire and have bounded retries."""
import math
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from rest_framework import serializers
from rest_framework.authentication import TokenAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .account_settings import StrictSerializer
from .models import EmailVerification

CODE_LIFETIME = timedelta(minutes=10)
RESEND_DELAY = timedelta(seconds=60)
SEND_WINDOW = timedelta(hours=24)
MAX_SENDS = 5
MAX_ATTEMPTS = 5
User = get_user_model()


def normalized_email(value):
    return str(value or '').strip().lower()


def is_email_verified(user):
    if not user or not user.pk or not normalized_email(user.email):
        return False
    return EmailVerification.objects.filter(user_id=user.pk,
        verified_email=normalized_email(user.email), verified_at__isnull=False).exists()


def invalidate_email_verification(user_id):
    # Preserve the send budget and cooldown when an address is changed.
    EmailVerification.objects.filter(user_id=user_id).update(verified_email='', verified_at=None,
        pending_email='', code_hash='', expires_at=None, attempts=0, delivery_status='')


def verification_state(user):
    record = EmailVerification.objects.filter(user_id=user.pk).first()
    now = timezone.now()
    verified = bool(record and record.verified_at and record.verified_email == normalized_email(user.email))
    active_window = bool(record and record.window_started_at and now < record.window_started_at + SEND_WINDOW)
    remaining = max(0, MAX_SENDS - record.send_count) if active_window else MAX_SENDS
    next_send = record.requested_at + RESEND_DELAY if record and record.requested_at else now
    if not remaining:
        next_send = max(next_send, record.window_started_at + SEND_WINDOW)
    pending = bool(record and record.code_hash and record.pending_email == normalized_email(user.email)
                   and record.expires_at and record.expires_at > now and record.attempts < MAX_ATTEMPTS)
    return {'verified': verified, 'verified_at': record.verified_at if verified else None,
            'code_pending': pending, 'expires_at': record.expires_at if pending else None,
            'resend_available_at': max(now, next_send), 'remaining_requests': remaining}


def verification_response(user, detail, status=200):
    data = {'detail': detail, 'email_verification': verification_state(user)}
    response = Response(data, status=status)
    if status == 429:
        response['Retry-After'] = str(max(1, math.ceil(
            (data['email_verification']['resend_available_at'] - timezone.now()).total_seconds())))
    return response


@sensitive_variables('code', 'code_hash')
@api_view(['POST'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def request_email_verification(request):
    from .email_notifications import BrevoEmailProvider, email_available, valid_email
    from .email_templates import render_email
    serializer = StrictSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        if is_email_verified(user):
            return verification_response(user, 'Your current email address is already verified.')
        if not valid_email(user.email):
            return verification_response(user, 'Save a valid email address in your profile first.', 400)
        if not email_available():
            return verification_response(user, 'Email verification is temporarily unavailable. Please try again later.', 503)
        record, _ = EmailVerification.objects.get_or_create(user=user)
        now = timezone.now()
        state = verification_state(user)
        if state['resend_available_at'] > timezone.now():
            detail = ('Daily verification limit reached. Try again after the displayed time.'
                      if not state['remaining_requests'] else 'Please wait before requesting another code.')
            return verification_response(user, detail, 429)
        if not record.window_started_at or now >= record.window_started_at + SEND_WINDOW:
            record.window_started_at, record.send_count = now, 0
        code = f'{secrets.randbelow(1000000):06d}'
        code_hash = make_password(code)
        record.pending_email = normalized_email(user.email)
        record.code_hash = code_hash
        record.expires_at = now + CODE_LIFETIME
        record.requested_at = now
        record.attempts = 0
        record.send_count += 1
        record.delivery_status = 'processing'
        record.save()
    # Persist the budget before contacting Brevo. A timeout never automatically
    # triggers another send, and concurrent clicks cannot bypass the cooldown.
    try:
        state, _, _ = BrevoEmailProvider().send(recipient=record.pending_email,
            subject='Verify your GraveTrak email address',
            body=f'Your GraveTrak verification code is: {code}\n\n'
                 'Enter this code in Settings to verify your email address. It expires in 10 minutes. '
                 'Only the most recently requested code works. Do not share this code.\n\n'
                 'If you did not request this code, you can ignore this email.',
            html_body=render_email(title='Verify your email address',
                message='Confirm your email address to receive important updates about your burial application.',
                kind='verification', name=user.first_name.strip(), code=code))
    except Exception:
        state = 'unknown'
    updates = {'delivery_status': state}
    if state in ('failed', 'provider_not_configured'):
        updates.update(code_hash='', expires_at=None)
    EmailVerification.objects.filter(pk=record.pk, code_hash=code_hash).update(**updates)
    user.refresh_from_db()
    if state != 'accepted':
        return verification_response(user,
            'We could not confirm that the verification email was sent. Check your inbox and Spam; '
            'if no code arrives, try again after the cooldown.', 503)
    return verification_response(user, 'Verification code sent. Check your inbox or Spam folder.')


class ConfirmEmailSerializer(StrictSerializer):
    code = serializers.RegexField(r'^[0-9]{6}$', min_length=6, max_length=6, write_only=True)


@sensitive_post_parameters('code')
@api_view(['POST'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def confirm_email_verification(request):
    from .serializers import UserSerializer
    serializer = ConfirmEmailSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=request.user.pk)
        record = EmailVerification.objects.filter(user=user).first()
        now = timezone.now()
        if (not record or not record.code_hash or not record.expires_at or record.expires_at <= now
                or record.pending_email != normalized_email(user.email) or record.attempts >= MAX_ATTEMPTS):
            return verification_response(user, 'This code is expired or no longer valid. Request a new code.', 400)
        if not check_password(serializer.validated_data['code'], record.code_hash):
            record.attempts += 1
            if record.attempts >= MAX_ATTEMPTS:
                record.code_hash = ''
            record.save(update_fields=['attempts', 'code_hash'])
            return verification_response(user,
                'Too many incorrect attempts. Request a new code.' if record.attempts >= MAX_ATTEMPTS
                else 'Incorrect code. Check the most recent verification email.', 400)
        record.verified_email = normalized_email(user.email)
        record.verified_at = now
        record.code_hash = ''
        record.expires_at = None
        record.save(update_fields=['verified_email', 'verified_at', 'code_hash', 'expires_at'])
        return Response({'detail': 'Email address verified.', 'user': UserSerializer(user).data})
