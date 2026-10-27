"""Brevo email outbox. No network requests inside application workflows."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone

from .models import EmailOutbox
from .sms_provider import NoRedirect
from .user_preferences import get_preferences
from .email_templates import render_email, render_notification_email


def valid_email(value):
    value = str(value or '').strip()
    try:
        validate_email(value)
        return value
    except ValidationError:
        return ''


def email_available():
    return bool(settings.BREVO_EMAIL_ENABLED and settings.BREVO_API_KEY.strip()
                and valid_email(settings.BREVO_SENDER_EMAIL))


def provider_http_error(error):
    # Classify a bounded response without storing provider text, keys or IPs.
    if error.code == 401:
        try:
            detail = json.loads(error.read(8192))
        except (ValueError, OSError):
            detail = {}
        message = str(detail.get('message', '')).lower() if isinstance(detail, dict) else ''
        if 'ip address' in message or 'unrecognized ip' in message or 'unrecognised ip' in message:
            return "Brevo HTTP 401: backend IP is not authorized. Authorize this server's IP in Brevo Security > Authorized IPs."
        return 'Brevo HTTP 401: API authentication rejected. Check the active backend/worker key and Brevo API key status.'
    return f'Brevo HTTP {error.code}. Check sender verification, account limits and provider logs.'


class BrevoEmailProvider:
    def send(self, *, recipient, subject, body, html_body=None):
        if not email_available():
            return 'provider_not_configured', '', 'Brevo email is disabled or incomplete.'
        payload = {'sender': {'name': settings.BREVO_SENDER_NAME, 'email': settings.BREVO_SENDER_EMAIL.strip()},
                   'to': [{'email': recipient}], 'subject': subject, 'textContent': body,
                   'htmlContent': html_body if html_body is not None else render_email(
                       title=subject.removeprefix('GraveTrak: '), message=body)}
        request = Request('https://api.brevo.com/v3/smtp/email', data=json.dumps(payload).encode('utf-8'),
                          headers={'api-key': settings.BREVO_API_KEY.strip(),
                                   'Content-Type': 'application/json', 'Accept': 'application/json'}, method='POST')
        try:
            with build_opener(NoRedirect()).open(request, timeout=10) as response:
                result = json.loads(response.read(1024 * 1024))
        except HTTPError as exc:
            # Never replay ambiguous submissions: the provider may have accepted them.
            state = 'failed' if 400 <= exc.code < 500 and exc.code != 408 else 'unknown'
            return state, '', provider_http_error(exc)
        except (URLError, TimeoutError, OSError, ValueError):
            return 'unknown', '', 'Submission outcome unknown. Check Brevo logs before retrying.'
        uid = result.get('messageId') if isinstance(result, dict) else None
        if not isinstance(uid, str) or not uid:
            return 'unknown', '', 'No provider message ID returned. Check Brevo logs.'
        return 'accepted', uid[:255], ''


class EmailService:
    @staticmethod
    def prepare(notification):
        from .email_verification import is_email_verified
        email = valid_email(notification.recipient.email)
        opted_in = get_preferences(notification.recipient)['email_notifications']
        status = ('opted_out' if not opted_in else 'invalid_recipient' if not email
                  else 'unverified_recipient' if not is_email_verified(notification.recipient)
                  else 'provider_not_configured' if not email_available() else 'pending')
        return EmailOutbox.objects.get_or_create(notification=notification, defaults={
            'recipient_email': email, 'subject': f'GraveTrak: {notification.title}'[:255],
            'body': f'{notification.message}\n\nPlease sign in to GraveTrak for complete details.\nGraveTrak Notifications',
            'status': status,
            'error_message': ('Email was disabled or incomplete when this event was created. '
                              'Review before explicitly requeuing.' if status == 'provider_not_configured' else ''),
        })[0]

    @staticmethod
    def deliver(pk):
        from .email_verification import is_email_verified
        if not email_available():
            return
        if not EmailOutbox.objects.filter(pk=pk, status='pending').update(status='processing', attempted_at=timezone.now()):
            return
        record = EmailOutbox.objects.select_related('notification__recipient__profile', 'notification__application').get(pk=pk)
        recipient = record.notification.recipient
        if not get_preferences(recipient)['email_notifications']:
            EmailOutbox.objects.filter(pk=pk).update(status='opted_out')
            return
        if not record.recipient_email or valid_email(recipient.email) != record.recipient_email:
            EmailOutbox.objects.filter(pk=pk).update(status='invalid_recipient', error_message='Recipient email changed or is invalid.')
            return
        if not is_email_verified(recipient):
            EmailOutbox.objects.filter(pk=pk).update(status='unverified_recipient',
                error_message='Verify the current account email before receiving application emails.')
            return
        try:
            state, uid, error = BrevoEmailProvider().send(recipient=record.recipient_email, subject=record.subject,
                body=record.body, html_body=render_notification_email(record))
        except Exception:
            state, uid, error = 'unknown', '', 'Unexpected provider outcome. Check Brevo logs before retrying.'
        EmailOutbox.objects.filter(pk=pk).update(status=state, provider_message_id=uid, error_message=error)
