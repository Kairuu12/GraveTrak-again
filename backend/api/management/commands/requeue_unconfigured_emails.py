from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.email_notifications import email_available, valid_email
from api.models import EmailOutbox
from api.user_preferences import get_preferences
from api.email_verification import is_email_verified


class Command(BaseCommand):
    help = 'Preview selected never-attempted, configuration-blocked emails. --apply queues them for the worker.'

    def add_arguments(self, parser):
        parser.add_argument('--ids', type=int, nargs='+', required=True)
        parser.add_argument('--apply', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        if not email_available():
            raise CommandError('Email is disabled or incomplete. Nothing requeued.')
        ids = set(options['ids'])
        rows = list(EmailOutbox.objects.select_for_update().filter(pk__in=ids))
        if len(rows) != len(ids):
            raise CommandError('One or more email IDs do not exist. Nothing requeued.')
        for row in rows:
            recipient = row.notification.recipient
            eligible = (row.status == 'provider_not_configured' and row.attempted_at is None
                        and not row.provider_message_id
                        and bool(valid_email(row.recipient_email))
                        and valid_email(recipient.email) == row.recipient_email
                        and is_email_verified(recipient)
                        and get_preferences(recipient)['email_notifications'])
            if not eligible:
                raise CommandError(f'Email {row.pk} is not eligible. Nothing requeued.')
        for row in rows:
            self.stdout.write(f'Email {row.pk}: {row.notification.notification_type}, '
                              f'application={row.notification.application_id}, created={row.created_at.isoformat()}')
        if options['apply']:
            EmailOutbox.objects.filter(pk__in=ids).update(status='pending', error_message='')
            self.stdout.write(f'Requeued {len(rows)} emails. The worker will submit them once.')
        else:
            self.stdout.write('Preview only. Review event dates and recipients in Admin; use --apply to queue delivery.')
