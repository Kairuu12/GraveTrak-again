"""Account preferences shared by settings and notification delivery preparation."""

DEFAULT_PREFERENCES = {
    'email_notifications': True,
    'sms_notifications': False,
    'cemetery_announcements': True,
    'theme': 'light',
    'text_size': 'standard',
    'high_contrast': False,
}


def get_preferences(user):
    profile = getattr(user, 'profile', None)
    stored = getattr(profile, 'preferences', {}) or {}
    return {**DEFAULT_PREFERENCES, **{key: stored[key] for key in DEFAULT_PREFERENCES if key in stored}}
