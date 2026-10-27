"""Transactional notifications with opt-in, at-most-once PhilSMS submission."""
import re
from typing import Protocol

from django.db import transaction

from .models import Notification, SmsOutbox
from .user_preferences import get_preferences
from .sms_provider import PhilSmsProvider, sms_available


def normalize_ph_mobile(value):
    value = re.sub(r'[\s()\-]', '', str(value or ''))
    if re.fullmatch(r'09[0-9]{9}', value):
        return '+63' + value[1:]
    if re.fullmatch(r'9[0-9]{9}', value):
        return '+63' + value
    if re.fullmatch(r'\+?639[0-9]{9}', value):
        return '+' + value.lstrip('+')
    return None


def owner_contact(application):
    owner = application.submitted_by
    return getattr(getattr(owner, 'profile', None), 'contact_number', '')


def masked_owner_contact(application):
    number = normalize_ph_mobile(owner_contact(application))
    return number[:5] + '*' * (len(number) - 7) + number[-2:] if number else 'Missing or invalid mobile number'


class SmsProvider(Protocol):
    def send(self, *, recipient: str, message: str, idempotency_key: str):
        """Return submission status, provider ID, and a sanitized error."""
        ...


class SmsService:
    @staticmethod
    def prepare(*, application, notification, event_key, notification_type, message):
        number = normalize_ph_mobile(owner_contact(application))
        configured = sms_available()
        opted_in = get_preferences(application.submitted_by)['sms_notifications']
        eligible = bool(number and configured and opted_in)
        status = ('invalid_recipient' if not number else 'provider_not_configured' if not configured
                  else 'pending' if opted_in else 'opted_out')
        record, created = SmsOutbox.objects.get_or_create(event_key=event_key, defaults={
            'application': application, 'notification': notification,
            'recipient': application.submitted_by, 'notification_type': notification_type,
            'recipient_number': number or '', 'message': message,
            'status': status,
            'error_message': ('Application owner or valid Philippine mobile number is missing.' if not number
                              else 'SMS provider is not configured.' if not configured else ''),
            'eligible_for_delivery': eligible,
        })
        if created and eligible:
            transaction.on_commit(lambda: SmsService.deliver(record.pk), robust=True)
        return record

    @staticmethod
    def deliver(record_id):
        if not sms_available():
            return
        # Atomic compare-and-set works on SQLite too; concurrent invocations
        # cannot submit the same event twice. Historical rows are ineligible.
        claimed = SmsOutbox.objects.filter(pk=record_id, status='pending', eligible_for_delivery=True).update(
            status='processing', eligible_for_delivery=False, provider='philsms')
        if not claimed:
            return
        record = SmsOutbox.objects.select_related('recipient__profile').get(pk=record_id)
        if not record.recipient or not get_preferences(record.recipient)['sms_notifications']:
            SmsOutbox.objects.filter(pk=record_id).update(status='opted_out')
            return
        current = normalize_ph_mobile(getattr(getattr(record.recipient, 'profile', None), 'contact_number', ''))
        if not current or current != record.recipient_number:
            SmsOutbox.objects.filter(pk=record_id).update(status='invalid_recipient', error_message='Recipient number changed or is invalid; message was not sent.')
            return
        try:
            status, uid, error = PhilSmsProvider().send(recipient=current, message=record.message, idempotency_key=record.event_key)
        except Exception:
            status, uid, error = 'unknown', '', 'Provider outcome is unknown. Check PhilSMS before retrying.'
        SmsOutbox.objects.filter(pk=record_id).update(status=status, provider_message_id=uid, error_message=error)


class NotificationService:
    @staticmethod
    @transaction.atomic
    def create(application, kind, title, message, event_key, sms_message=None):
        notification = None
        if application.submitted_by_id:
            notification, created = Notification.objects.get_or_create(event_key=event_key, defaults={
                'recipient': application.submitted_by, 'application': application,
                'notification_type': kind, 'title': title, 'message': message,
                'send_via_email': get_preferences(application.submitted_by)['email_notifications'],
                'send_via_sms': bool(sms_message),
            })
            if created:
                from .email_notifications import EmailService
                EmailService.prepare(notification)
        if sms_message:
            SmsService.prepare(application=application, notification=notification,
                               event_key=event_key, notification_type=kind, message=sms_message)
        return notification

    @classmethod
    def interview(cls, schedule, rescheduled=False):
        app = schedule.application
        kind = 'interview_rescheduled' if rescheduled else 'interview_scheduled'
        title = 'Interview Rescheduled' if rescheduled else 'Interview Scheduled'
        details = f'{schedule.scheduled_date:%b %d, %Y} at {schedule.scheduled_time:%I:%M %p} at {schedule.location}'
        message = f'Your interview for Burial Application {app.application_id} has been {"rescheduled" if rescheduled else "scheduled"} for {details}. Please log in to GraveTrak for complete details.'
        return cls.create(app, kind, title, message,
                          f'interview:{schedule.pk}:{schedule.notification_version}', 'GraveTrak: ' + message)

    @classmethod
    def final_status(cls, application, audit):
        approved = audit.new_status == 'approved'
        title = 'Burial Application Approved' if approved else 'Burial Application Update'
        message = (f'Your Burial Application {application.application_id} has been approved.' if approved else
                   f'Your Burial Application {application.application_id} has an important status update.')
        message += ' Please log in to GraveTrak for complete details.'
        return cls.create(application, audit.new_status, title, message,
                          f'status:{audit.pk}', 'GraveTrak: ' + message)
