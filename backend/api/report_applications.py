from collections import Counter
from django.db.models import Q
from django.utils import timezone
from .models import BurialApplication, InterviewSchedule


def application_report_details(start, end):
    appointments = InterviewSchedule.objects.filter(scheduled_date__range=(start, end)).values('application_id')
    applications = BurialApplication.objects.filter(
        Q(submitted_at__date__range=(start, end)) |
        Q(approved_at__date__range=(start, end)) |
        Q(rejected_at__date__range=(start, end)) |
        Q(burial_date__range=(start, end)) |
        Q(pk__in=appointments)
    ).order_by('-submitted_at', '-pk')
    def day(value):
        return timezone.localtime(value).date().isoformat() if value else None
    rows = [{
        'id': item.application_id, 'deceased_name': item.deceased_name,
        'applicant_name': item.applicant_name, 'funeral_home': item.funeral_home or 'Not recorded', 'status_code': item.status,
        'status': item.get_status_display(), 'submitted_date': day(item.submitted_at),
        'approved_date': day(item.approved_at), 'rejected_date': day(item.rejected_at),
        'burial_date': item.burial_date.isoformat() if item.burial_date else None,
    } for item in applications]
    counts = Counter(row['status_code'] for row in rows)
    labels = dict(BurialApplication.ApplicationStatus.choices)
    return {'application_records': rows, 'application_statuses': [
        {'code': code, 'label': labels.get(code, code.replace('_', ' ').title()), 'count': count}
        for code, count in counts.items()
    ]}
