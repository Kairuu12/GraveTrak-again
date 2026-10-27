from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .saved_graves import SavedGraveViewSet
from .operations_reports import OperationsReportViewSet
from .account_settings import preferences_view, change_password_view

from .views import (
    BurialApplicationViewSet,
    CemeteryViewSet,
    CemeterySectionViewSet,
    CemeteryPathwayViewSet,
    ColumbariumViewSet,
    BurialPlotViewSet,
    BurialDocumentViewSet,
    InterviewScheduleViewSet,
    NotificationViewSet,
    SystemSettingsViewSet,
    GraveViewSet,
    ApplicationViewSet,
    login_view,
    logout_view,
    profile_view,
    register_view,
    user_detail_view,
    user_list_view,
    report_analytics_view,
)

router = DefaultRouter()
router.register('operations-reports', OperationsReportViewSet, basename='operations-report')
router.register('saved-graves', SavedGraveViewSet, basename='saved-grave')
router.register('graves', GraveViewSet, basename='grave')
router.register('columbariums', ColumbariumViewSet, basename='columbarium')
router.register('cemeteries', CemeteryViewSet, basename='cemetery')
router.register('cemetery-sections', CemeterySectionViewSet, basename='cemeterysection')
router.register('cemetery-pathways', CemeteryPathwayViewSet, basename='cemeterypathway')
router.register('applications', ApplicationViewSet, basename='application')
router.register('burial-applications', BurialApplicationViewSet, basename='burialapplication')
router.register('burial-plots', BurialPlotViewSet, basename='burialplot')
router.register('burial-documents', BurialDocumentViewSet, basename='burialdocument')
router.register('interview-schedules', InterviewScheduleViewSet, basename='interviewschedule')
router.register('notifications', NotificationViewSet, basename='notification')
router.register('system-settings', SystemSettingsViewSet, basename='systemsettings')

from .email_verification import request_email_verification, confirm_email_verification

urlpatterns = [
    path('profile/email-verification/request/', request_email_verification, name='request-email-verification'),
    path('profile/email-verification/confirm/', confirm_email_verification, name='confirm-email-verification'),
    path('', include(router.urls)),
    path(
        'cemetery-sections/',
        CemeterySectionViewSet.as_view({'get': 'list', 'post': 'create'}),
        name='api-cemetery-sections',
    ),
    path(
        'cemetery-sections/<int:pk>/',
        CemeterySectionViewSet.as_view({'get': 'retrieve', 'patch': 'partial_update', 'put': 'update', 'delete': 'destroy'}),
        name='api-cemetery-section-detail',
    ),
    path('login/', login_view, name='api-login'),
    path('logout/', logout_view, name='api-logout'),
    path('register/', register_view, name='api-register'),
    path('profile/', profile_view, name='api-profile'),
    path('profile/preferences/', preferences_view, name='api-profile-preferences'),
    path('profile/change-password/', change_password_view, name='api-change-password'),
    path('users/', user_list_view, name='api-users'),
    path('users/<int:pk>/', user_detail_view, name='api-user-detail'),
    path('reports/analytics/', report_analytics_view, name='api-report-analytics'),
]
