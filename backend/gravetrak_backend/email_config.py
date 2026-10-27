"""Load only local Brevo settings; never evaluate file contents or expose values."""
import os

KEYS = {'BREVO_EMAIL_ENABLED', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME', 'BREVO_TEST_RECIPIENT'}


def email_settings(path, environ=None):
    # Do not export file values into os.environ: runserver's reloader inherits
    # them and otherwise mistakes an old file value for a hosting override.
    config = dict(os.environ if environ is None else environ)
    load_email_config(path, config)
    return {key: config[key] for key in KEYS if key in config}


def watch_email_config(sender, **kwargs):
    from django.conf import settings
    sender.extra_files.add(settings.BASE_DIR / '.env.email')


def load_email_config(path, environ=None):
    environ = os.environ if environ is None else environ
    if not path.is_file():
        return
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        key = key.strip()
        if not separator or key not in KEYS:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        # Hosting/process configuration takes priority over the local file.
        environ.setdefault(key, value)
