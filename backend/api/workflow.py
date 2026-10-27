"""
GraveTrak API workflow helpers.

Encapsulates automated plot assignment, status transitions, and notification helpers.
"""

from django.db import transaction
from django.utils import timezone
from .models import BurialPlot, BurialApplication, StatusAuditLog, Notification
from .inventory_visibility import active_plots


class PlotAssignmentEngine:
    """Handle rule-based automatic burial plot allocation."""

    @staticmethod
    def get_next_available_plot(lock=False):
        plots = active_plots(BurialPlot.objects.all()).filter(
            status=BurialPlot.PlotStatus.AVAILABLE,
            assigned_to__isnull=True
        ).order_by('section', 'plot_number')
        return (plots.select_for_update() if lock else plots).first()

    @classmethod
    def assign_plot_to_application(cls, application):
        if application.assigned_plot:
            return None, False, 'Application already has an assigned plot.'

        if application.status not in [
            BurialApplication.ApplicationStatus.PENDING_REVIEW,
            BurialApplication.ApplicationStatus.SLOT_ASSIGNED,
        ]:
            return None, False, f'Plot assignment is not allowed when application is {application.status}'

        with transaction.atomic():
            plot = cls.get_next_available_plot(lock=True)
            if not plot:
                return None, False, 'No available plots to assign.'

            plot.assigned_to = application
            plot.save()

            application.assigned_plot = plot
            application.status = BurialApplication.ApplicationStatus.SLOT_ASSIGNED
            application.save()

            StatusAuditLog.objects.create(
                application=application,
                old_status=BurialApplication.ApplicationStatus.PENDING_REVIEW,
                new_status=BurialApplication.ApplicationStatus.SLOT_ASSIGNED,
                changed_by=None,
                reason='Automatic plot assignment by system.'
            )

            return plot, True, f'Plot {plot.plot_id} assigned successfully.'

    @staticmethod
    def release_plot(plot):
        plot.assigned_to = None
        if plot.status == BurialPlot.PlotStatus.MAINTENANCE:
            plot.maintenance_previous_status = BurialPlot.PlotStatus.AVAILABLE
        else:
            plot.status = BurialPlot.PlotStatus.AVAILABLE
        plot.save()

    @staticmethod
    def occupy_plot(plot, application):
        plot.status = BurialPlot.PlotStatus.OCCUPIED
        plot.occupied_by_application = application
        plot.assigned_to = None
        plot.save()


class ApplicationWorkflowEngine:
    """Manage allowed status transitions for burial applications."""

    VALID_TRANSITIONS = {
        BurialApplication.ApplicationStatus.PENDING_REVIEW: [
            BurialApplication.ApplicationStatus.ACTION_REQUIRED,
            BurialApplication.ApplicationStatus.DOCUMENTS_COMPLETE,
            BurialApplication.ApplicationStatus.SLOT_ASSIGNED,
        ],
        BurialApplication.ApplicationStatus.ACTION_REQUIRED: [
            BurialApplication.ApplicationStatus.PENDING_REVIEW,
        ],
        BurialApplication.ApplicationStatus.DOCUMENTS_COMPLETE: [
            BurialApplication.ApplicationStatus.FOR_INTERVIEW,
        ],
        BurialApplication.ApplicationStatus.SLOT_ASSIGNED: [
            BurialApplication.ApplicationStatus.APPROVED,
            BurialApplication.ApplicationStatus.REJECTED,
            BurialApplication.ApplicationStatus.COMPLETED,
        ],
        BurialApplication.ApplicationStatus.APPROVED: [
            BurialApplication.ApplicationStatus.FOR_INTERVIEW,
        ],
        BurialApplication.ApplicationStatus.FOR_INTERVIEW: [
            BurialApplication.ApplicationStatus.SCHEDULED,
        ],
        BurialApplication.ApplicationStatus.SCHEDULED: [
            BurialApplication.ApplicationStatus.COMPLETED,
        ],
        BurialApplication.ApplicationStatus.COMPLETED: [],
        BurialApplication.ApplicationStatus.REJECTED: [],
    }

    @classmethod
    def can_transition(cls, application, target_status):
        allowed = cls.VALID_TRANSITIONS.get(application.status, [])
        if target_status not in allowed:
            return False, f'Cannot transition from {application.status} to {target_status}.'
        return True, ''

    @classmethod
    @transaction.atomic
    def transition(cls, application, target_status, changed_by=None, reason=''):
        current = BurialApplication.objects.select_for_update().get(pk=application.pk)
        application.status = current.status
        if current.status == target_status:
            return True, 'Application already has this status.'
        allowed, message = cls.can_transition(application, target_status)
        if not allowed:
            return False, message

        if application.assigned_plot_id and target_status in (
            BurialApplication.ApplicationStatus.REJECTED, BurialApplication.ApplicationStatus.COMPLETED,
        ):
            plot = BurialPlot.objects.select_for_update().get(pk=application.assigned_plot_id)
            if target_status == BurialApplication.ApplicationStatus.COMPLETED:
                if plot.status == BurialPlot.PlotStatus.MAINTENANCE:
                    return False, 'Complete plot maintenance before recording the burial as completed.'
                PlotAssignmentEngine.occupy_plot(plot, application)
            else:
                PlotAssignmentEngine.release_plot(plot)

        if target_status == BurialApplication.ApplicationStatus.APPROVED:
            application.approved_at = timezone.now()
        if target_status == BurialApplication.ApplicationStatus.REJECTED:
            application.rejected_at = timezone.now()
        if target_status == BurialApplication.ApplicationStatus.COMPLETED:
            application.completed_at = timezone.now()
            application.burial_executed_date = timezone.now().date()

        old_status = application.status
        application.status = target_status
        application.reviewed_by = changed_by or application.reviewed_by
        application.reviewed_at = timezone.now()
        application.save()

        audit = StatusAuditLog.objects.create(
            application=application,
            old_status=old_status,
            new_status=target_status,
            changed_by=changed_by,
            reason=reason,
        )

        if target_status in ('approved', 'rejected'):
            from .notifications import NotificationService
            NotificationService.final_status(application, audit)

        return True, f'Application transitioned to {target_status}.'


class NotificationEngine:
    """Create simple notifications for status changes."""

    TEMPLATES = {
        BurialApplication.ApplicationStatus.PENDING_REVIEW: ('Application Received', 'Your burial application has been received.'),
        BurialApplication.ApplicationStatus.ACTION_REQUIRED: ('Action Required', 'Your application requires additional information.'),
        BurialApplication.ApplicationStatus.SLOT_ASSIGNED: ('Plot Assigned', 'A burial plot has been assigned to your application.'),
        BurialApplication.ApplicationStatus.APPROVED: ('Application Approved', 'Your application has been approved.'),
        BurialApplication.ApplicationStatus.REJECTED: ('Application Rejected', 'Your application has been rejected.'),
        BurialApplication.ApplicationStatus.FOR_INTERVIEW: ('Interview Scheduled', 'An interview has been scheduled for your application.'),
        BurialApplication.ApplicationStatus.SCHEDULED: ('Burial Scheduled', 'A burial date has been scheduled.'),
        BurialApplication.ApplicationStatus.COMPLETED: ('Burial Completed', 'The burial has been completed.'),
    }

    @classmethod
    def send_status_notification(cls, application, status):
        from .notifications import NotificationService
        audit = application.status_history.filter(new_status=status).first()
        if status in ('approved', 'rejected') and audit:
            return NotificationService.final_status(application, audit)
        if status == 'for_interview':
            # The scheduling service owns the precise schedule event.
            return None
        if not application.submitted_by:
            return None
        title, message = cls.TEMPLATES.get(status, ('Status Updated', 'Your application status has changed.'))
        kind = {'pending_review': 'application_received', 'slot_assigned': 'system_alert',
                'scheduled': 'burial_scheduled', 'completed': 'burial_completed'}.get(status, 'action_required')
        return NotificationService.create(application, kind, title, message,
            f'info:{application.pk}:{status}:{audit.pk if audit else 0}')
