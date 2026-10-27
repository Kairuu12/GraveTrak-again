from django.core.management.base import BaseCommand
from django.db.models import Count
from api.email_notifications import EmailService, email_available
from api.models import EmailOutbox


class Command(BaseCommand):
    help = 'Submit up to 50 new queued emails. Never replay disabled, failed or ambiguous events.'

    def handle(self, *args, **options):
        if not email_available():
            self.stdout.write('Email is disabled or incomplete. No emails submitted.')
            return
        ids = list(EmailOutbox.objects.filter(status='pending').order_by('pk').values_list('pk', flat=True)[:50])
        for pk in ids:
            EmailService.deliver(pk)
        outcomes = EmailOutbox.objects.filter(pk__in=ids).values('status').annotate(count=Count('pk')).order_by('status')
        summary = ', '.join(f'{row["status"]}={row["count"]}' for row in outcomes) or 'none'
        self.stdout.write(f'Checked {len(ids)} pending emails. Outcomes: {summary}.')
        blocked = EmailOutbox.objects.filter(status='provider_not_configured', attempted_at__isnull=True).count()
        if blocked:
            self.stdout.write(f'{blocked} unattempted emails remain blocked by earlier configuration. '
                              'Review with requeue_unconfigured_emails --ids ID before explicitly requeuing.')
