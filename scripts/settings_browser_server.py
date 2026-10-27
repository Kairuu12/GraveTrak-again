"""Isolated API fixture for test_settings_browser.cjs; never opens the real DB."""
import json
import os
from pathlib import Path
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'gravetrak_backend.settings')
os.environ['DB_ENGINE'] = 'sqlite'
from django.conf import settings

output = root / '.tmp' / 'settings-browser-review'
output.mkdir(parents=True, exist_ok=True)
database_dir = Path(tempfile.mkdtemp(prefix='fixture-', dir=output))
settings.DATABASES['default']['NAME'] = database_dir / 'database.sqlite3'
settings.CORS_ALLOWED_ORIGINS = ['http://127.0.0.1:5179']
settings.CSRF_TRUSTED_ORIGINS = ['http://127.0.0.1:5179']
settings.BREVO_EMAIL_ENABLED = True
settings.BREVO_API_KEY = 'browser-test-only'
settings.BREVO_SENDER_EMAIL = 'sender@example.test'
settings.PHILSMS_ENABLED = False

import django
django.setup()
from django.core.management import call_command
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from api.models import UserProfile
from unittest.mock import patch

# This isolated fixture never sends real email. The predictable code is confined
# to this test process and is not used by the actual application server.
patch('api.email_notifications.BrevoEmailProvider.send', return_value=('accepted', 'browser-test-id', '')).start()
patch('api.email_verification.secrets.randbelow', return_value=123456).start()

call_command('migrate', verbosity=0, interactive=False)
user = get_user_model().objects.create_user(username='settings-review@example.test', email='settings-review@example.test',
    first_name='Settings', last_name='Reviewer', password='Original-Secure-Pass23!')
UserProfile.objects.create(user=user, contact_number='09123456789')
other = get_user_model().objects.create_user(username='taken@example.test', email='taken@example.test', password='Other-Secure-Pass23!')
UserProfile.objects.create(user=other)
token = Token.objects.create(user=user)
print(json.dumps({'ready': True, 'token': token.key}), flush=True)
call_command('runserver', '127.0.0.1:8016', use_reloader=False, verbosity=0)
