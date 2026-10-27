"""Escaped, self-contained transactional email layouts with no remote assets."""
from django.template.loader import render_to_string


EVENT_LABELS = {
    'application_received': 'APPLICATION RECEIVED',
    'approved': 'APPLICATION APPROVED',
    'rejected': 'APPLICATION UPDATE',
    'action_required': 'ACTION REQUIRED',
    'documents_correction': 'DOCUMENT REVIEW',
    'interview_scheduled': 'INTERVIEW SCHEDULE',
    'interview_rescheduled': 'SCHEDULE UPDATED',
    'burial_scheduled': 'BURIAL SCHEDULE',
    'burial_completed': 'BURIAL UPDATE',
}
TEXT_FOOTER = '\n\nPlease sign in to GraveTrak for complete details.\nGraveTrak Notifications'


def render_email(*, title, message, kind='', reference='', name='', code=''):
    # Everything passed to the template is plain text; Django escapes it.
    # The verification code is intentionally excluded from the inbox preheader.
    verification = kind == 'verification'
    return render_to_string('api/emails/transactional.html', {
        'title': title, 'name': name,
        'paragraphs': [part.strip() for part in message.split('\n\n') if part.strip()],
        'label': 'EMAIL VERIFICATION' if verification else EVENT_LABELS.get(kind, 'ACCOUNT UPDATE'),
        'reference': reference, 'code': code if verification else '',
        'verification': verification,
        'preheader': 'Confirm your email address to receive GraveTrak updates.' if verification else f'{title}. View the details in your GraveTrak account.',
    })


def render_notification_email(record):
    notification = record.notification
    # Preserve the queued event's wording, even if the application changes later.
    message = record.body.removesuffix(TEXT_FOOTER)
    message = message.removesuffix(' Please log in to GraveTrak for complete details.')
    return render_email(title=record.subject.removeprefix('GraveTrak: '), message=message,
        kind=notification.notification_type,
        reference=notification.application.application_id if notification.application_id else '',
        name=notification.recipient.first_name.strip())
