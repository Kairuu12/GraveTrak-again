"""GraveTrak business-role and DRF permission helpers.

The project intentionally retains its existing stored role values for account
compatibility: mayor=CMO Super Administrator, planning=CPDO Administrator,
staff=Cemetery Staff, and user=Citizen.
"""
from rest_framework.permissions import BasePermission

from .models import UserProfile


ROLE_ALIASES = {
    'mayor': UserProfile.SUPER_ADMIN,
    'super_admin': UserProfile.SUPER_ADMIN,
    'planning': UserProfile.CPDO_ADMIN,
    'cpdo_admin': UserProfile.CPDO_ADMIN,
    'staff': UserProfile.CEMETERY_STAFF,
    'cemetery_staff': UserProfile.CEMETERY_STAFF,
    'user': UserProfile.CITIZEN,
    'public': UserProfile.CITIZEN,
    'citizen': UserProfile.CITIZEN,
}

DEFAULT_PERMISSIONS = {
    UserProfile.SUPER_ADMIN: set(UserProfile.PERMISSION_CHOICES),
    UserProfile.CPDO_ADMIN: {'manage_gis', 'manage_zoning', 'manage_plots', 'allocate_plots'},
    UserProfile.CEMETERY_STAFF: {'manage_burial_records', 'manage_plots', 'manage_grave_status', 'generate_reports'},
    UserProfile.CITIZEN: set(),
}


def get_role(user):
    if not user or not user.is_authenticated:
        return None
    profile = getattr(user, 'profile', None)
    if profile:
        return ROLE_ALIASES.get(profile.role, profile.role)
    # Break-glass compatibility for pre-existing Django superusers without a
    # profile. Business Super Admins remain explicitly represented by profile.
    return UserProfile.SUPER_ADMIN if user.is_superuser else UserProfile.CITIZEN


def has_capability(user, capability):
    role = get_role(user)
    if role is None:
        return False
    profile = getattr(user, 'profile', None)
    overrides = getattr(profile, 'permissions', []) if profile else []
    granted = set(overrides) if overrides else DEFAULT_PERMISSIONS.get(role, set())
    return capability in granted


class HasCapability(BasePermission):
    capability = None

    def has_permission(self, request, view):
        return bool(self.capability and has_capability(request.user, self.capability))


class HasGraveTrakRole(BasePermission):
    roles = ()

    def has_permission(self, request, view):
        return get_role(request.user) in self.roles


class IsGraveTrakSuperAdmin(HasCapability):
    capability = 'manage_users'


class IsCPDOAdmin(HasGraveTrakRole):
    roles = (UserProfile.CPDO_ADMIN,)


class IsCemeteryStaff(HasGraveTrakRole):
    roles = (UserProfile.CEMETERY_STAFF,)


class IsCitizen(HasGraveTrakRole):
    roles = (UserProfile.CITIZEN,)


class IsCPDOOrSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return has_capability(request.user, 'manage_zoning') or has_capability(request.user, 'manage_users')


class IsCemeteryStaffOrSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return has_capability(request.user, 'manage_grave_status') or has_capability(request.user, 'manage_users')


class CanManagePlots(BasePermission):
    def has_permission(self, request, view):
        return has_capability(request.user, 'manage_plots') or has_capability(request.user, 'manage_users')


class CanManageApplications(BasePermission):
    def has_permission(self, request, view):
        return has_capability(request.user, 'manage_applications')
