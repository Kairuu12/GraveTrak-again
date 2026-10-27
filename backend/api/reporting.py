from datetime import date, datetime, time, timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError


VALID_REPORT_PERIODS = {'overall', 'today', 'week', 'month', 'year', 'custom'}


def get_report_date_range(period='month', from_date=None, to_date=None):
    """Return an inclusive local-date range and a timezone-safe half-open datetime range."""
    period = (period or 'month').lower()
    if period not in VALID_REPORT_PERIODS:
        raise ValidationError({'period': 'Period must be overall, today, week, month, year, or custom.'})

    today = timezone.localdate()
    if period == 'overall':
        start_date = date(1900, 1, 1)
        end_date = today
    elif period == 'today':
        start_date = end_date = today
    elif period == 'week':
        start_date = today - timedelta(days=today.weekday())
        end_date = start_date + timedelta(days=6)
    elif period == 'month':
        start_date = today.replace(day=1)
        next_month = (start_date.replace(day=28) + timedelta(days=4)).replace(day=1)
        end_date = next_month - timedelta(days=1)
    elif period == 'year':
        start_date = today.replace(month=1, day=1)
        end_date = today.replace(month=12, day=31)
    else:
        if not from_date or not to_date:
            raise ValidationError({'date_range': 'Both from and to dates are required for a custom range.'})
        try:
            start_date = datetime.strptime(from_date, '%Y-%m-%d').date()
            end_date = datetime.strptime(to_date, '%Y-%m-%d').date()
        except ValueError as exc:
            raise ValidationError({'date_range': 'Dates must use YYYY-MM-DD format.'}) from exc
        if start_date > end_date:
            raise ValidationError({'date_range': 'Start date cannot be later than end date.'})

    current_tz = timezone.get_current_timezone()
    start_datetime = timezone.make_aware(datetime.combine(start_date, time.min), current_tz)
    end_datetime_exclusive = timezone.make_aware(datetime.combine(end_date + timedelta(days=1), time.min), current_tz)
    return {
        'period': period,
        'start_date': start_date,
        'end_date': end_date,
        'start_datetime': start_datetime,
        'end_datetime_exclusive': end_datetime_exclusive,
    }
