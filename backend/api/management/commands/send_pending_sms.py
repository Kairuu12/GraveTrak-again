from django.core.management.base import BaseCommand
from api.models import SmsOutbox
from api.notifications import SmsService
from api.sms_provider import sms_available


class Command(BaseCommand):
    help = 'Submit eligible pending SMS left by an interrupted process. Never replay historical or attempted messages.'

    def handle(self, *args, **options):
        if not sms_available():
            self.stdout.write('PhilSMS is disabled or incomplete. No SMS submitted.')
            return
        ids = list(SmsOutbox.objects.filter(status='pending', eligible_for_delivery=True).values_list('pk', flat=True)[:100])
        for pk in ids:
            SmsService.deliver(pk)
        self.stdout.write(f'Checked {len(ids)} pending records. Inspect outbox statuses for outcomes.')
