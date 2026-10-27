from datetime import datetime, timedelta, time

from django.db import transaction
from django.utils import timezone

from .models import BurialApplication, InterviewSchedule, StatusAuditLog, SystemSettings


class SchedulingError(Exception):
    pass


class AppointmentScheduler:
    ACTIVE_STATUSES = ('scheduled',)
    LUNCH_START = time(12, 0)
    LUNCH_END = time(13, 0)
    # CMO interview appointments use one fixed schedule and do not depend on
    # optional SystemSettings records being present in a deployment database.
    OPENING_TIME = time(8, 0)
    CLOSING_TIME = time(17, 0)
    DURATION_MINUTES = 5
    SLOT_INTERVAL_MINUTES = 5

    @staticmethod
    def _setting(key, default=None):
        return SystemSettings.get_setting(f'appointment_{key}', default)

    @staticmethod
    def _lock_capacity_setting():
        SystemSettings.objects.get_or_create(
            setting_key='appointment_maximum_simultaneous',
            defaults={
                'setting_value': '1', 'value_type': 'integer',
                'description': 'Maximum overlapping active CMO appointments.',
            },
        )
        SystemSettings.objects.select_for_update().get(setting_key='appointment_maximum_simultaneous')

    @classmethod
    def configuration(cls):
        capacity = cls._setting('maximum_simultaneous', '1')
        working_days = cls._setting('working_days', '0,1,2,3,4,5')
        return {
            'opening_time': cls.OPENING_TIME,
            'closing_time': cls.CLOSING_TIME,
            'duration_minutes': cls.DURATION_MINUTES,
            'slot_interval_minutes': cls.SLOT_INTERVAL_MINUTES,
            'maximum_simultaneous': max(1, int(capacity)),
            'working_days': {int(day) for day in working_days.split(',') if day.strip()},
            'lunch_start': cls.LUNCH_START,
            'lunch_end': cls.LUNCH_END,
        }

    @staticmethod
    def interval(scheduled_date, scheduled_time, duration_minutes):
        naive = datetime.combine(scheduled_date, scheduled_time)
        start = timezone.make_aware(naive, timezone.get_current_timezone())
        return start, start + timedelta(minutes=duration_minutes)

    @classmethod
    def validate_interval(cls, scheduled_date, scheduled_time, duration_minutes, exclude_id=None):
        config = cls.configuration()
        if not duration_minutes or duration_minutes <= 0:
            raise SchedulingError('Appointment duration must be configured or provided.')
        if scheduled_date.weekday() == 6 or scheduled_date.weekday() not in config['working_days']:
            raise SchedulingError('Appointments are not available on Sunday or another configured closed day.')

        start, end = cls.interval(scheduled_date, scheduled_time, duration_minutes)
        if start <= timezone.now():
            raise SchedulingError('Appointments cannot be scheduled in the past.')
        lunch_start, lunch_end = cls.interval(scheduled_date, cls.LUNCH_START, 60)
        if start < lunch_end and end > lunch_start:
            raise SchedulingError('Appointments cannot overlap the 12:00 PM–1:00 PM lunch break.')
        if config['opening_time']:
            opening, _ = cls.interval(scheduled_date, config['opening_time'], 1)
            if start < opening:
                raise SchedulingError('Appointment starts before the configured opening time.')
        if config['closing_time']:
            closing, _ = cls.interval(scheduled_date, config['closing_time'], 1)
            if end > closing:
                raise SchedulingError('Appointment ends after the configured closing time.')

        overlapping = []
        queryset = InterviewSchedule.objects.filter(status__in=cls.ACTIVE_STATUSES)
        if exclude_id:
            queryset = queryset.exclude(pk=exclude_id)
        for existing in queryset.filter(scheduled_date=scheduled_date):
            existing_duration = existing.duration_minutes or config['duration_minutes']
            if not existing_duration:
                continue
            existing_start, existing_end = cls.interval(existing.scheduled_date, existing.scheduled_time, existing_duration)
            if start < existing_end and end > existing_start:
                overlapping.append(existing)
        if len(overlapping) >= config['maximum_simultaneous']:
            raise SchedulingError('This appointment slot is no longer available. Please select another time.')
        return start, end

    @classmethod
    def schedule(cls, application, scheduled_date, scheduled_time, location, user, notes='', duration_minutes=None):
        if not application.document_completeness['ready_for_further_processing']:
            raise SchedulingError('All required documents must be complete before scheduling.')
        # Duration is fixed for every CMO interview; callers cannot override it.
        duration = cls.DURATION_MINUTES
        with transaction.atomic():
            cls._lock_capacity_setting()
            locked_application = BurialApplication.objects.select_for_update().get(pk=application.pk)
            existing = InterviewSchedule.objects.select_for_update().filter(application=locked_application).first()
            if existing and existing.status == 'scheduled':
                if (existing.scheduled_date, existing.scheduled_time, existing.duration_minutes, existing.location, existing.notes) == (scheduled_date, scheduled_time, duration, location, notes):
                    application.status = locked_application.status
                    return existing
                raise SchedulingError('This application already has an active appointment. Use reschedule instead.')
            cls.validate_interval(scheduled_date, scheduled_time, duration, exclude_id=existing.pk if existing else None)
            if existing:
                existing.scheduled_date = scheduled_date
                existing.scheduled_time = scheduled_time
                existing.duration_minutes = duration
                existing.location = location
                existing.notes = notes
                existing.status = 'scheduled'
                existing.cancelled_at = None
                existing.cancellation_reason = ''
                existing.created_by = user
                existing.save()
                appointment = existing
            else:
                appointment = InterviewSchedule.objects.create(
                    application=locked_application, scheduled_date=scheduled_date,
                    scheduled_time=scheduled_time, duration_minutes=duration,
                    location=location, notes=notes, created_by=user,
                )
            from .workflow import ApplicationWorkflowEngine
            from .notifications import NotificationService
            success, message = ApplicationWorkflowEngine.transition(
                locked_application, BurialApplication.ApplicationStatus.FOR_INTERVIEW,
                changed_by=user, reason='Interview scheduled.')
            if not success:
                raise SchedulingError(message)
            application.status = locked_application.status
            appointment.notification_version += 1
            appointment.save(update_fields=['notification_version'])
            NotificationService.interview(appointment, rescheduled=bool(existing))
            return appointment

    @classmethod
    def reschedule(cls, appointment, scheduled_date, scheduled_time, location, user, notes='', duration_minutes=None):
        # Rescheduled appointments follow the same five-minute policy.
        duration = cls.DURATION_MINUTES
        with transaction.atomic():
            cls._lock_capacity_setting()
            locked = InterviewSchedule.objects.select_for_update().get(pk=appointment.pk)
            changed = (locked.scheduled_date, locked.scheduled_time, locked.location) != (scheduled_date, scheduled_time, location)
            old = f'{locked.scheduled_date} {locked.scheduled_time}'
            cls.validate_interval(scheduled_date, scheduled_time, duration, exclude_id=locked.pk)
            locked.scheduled_date = scheduled_date
            locked.scheduled_time = scheduled_time
            locked.duration_minutes = duration
            locked.location = location
            locked.notes = notes
            locked.status = 'scheduled'
            if changed:
                locked.notification_version += 1
            locked.save()
            StatusAuditLog.objects.create(
                application=locked.application, old_status=locked.application.status,
                new_status=locked.application.status, changed_by=user,
                reason=f'Appointment rescheduled from {old} to {scheduled_date} {scheduled_time}.',
            )
            if changed:
                from .notifications import NotificationService
                NotificationService.interview(locked, rescheduled=True)
            return locked

    @classmethod
    def available_slots(cls, start_date, days=14):
        config = cls.configuration()
        if not all((config['opening_time'], config['closing_time'], config['duration_minutes'], config['slot_interval_minutes'])):
            raise SchedulingError('Opening time, closing time, appointment duration, and slot interval must be configured before generating slots.')
        slots = []
        for offset in range(days):
            day = start_date + timedelta(days=offset)
            if day.weekday() == 6 or day.weekday() not in config['working_days']:
                continue
            cursor, closing = cls.interval(day, config['opening_time'], config['duration_minutes'])
            closing_at, _ = cls.interval(day, config['closing_time'], 1)
            while cursor + timedelta(minutes=config['duration_minutes']) <= closing_at:
                try:
                    cls.validate_interval(day, cursor.time(), config['duration_minutes'])
                    slots.append({'date': day.isoformat(), 'time': cursor.time().strftime('%H:%M'), 'duration_minutes': config['duration_minutes']})
                except SchedulingError:
                    pass
                cursor += timedelta(minutes=config['slot_interval_minutes'])
        return slots
