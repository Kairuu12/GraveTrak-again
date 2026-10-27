"""Local presentation checks. Never migrate the working database or send messages.

Run with a Python environment containing backend/requirements.txt:
    python scripts/check_presentation.py
Tests use a fresh test DB and disposable upload/static folders. All DB work
outside the tests targets a disposable snapshot of backend/db.sqlite3.
"""
import gzip
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'backend'))
os.environ.update(DJANGO_SETTINGS_MODULE='gravetrak_backend.settings', DB_ENGINE='sqlite',
                  DJANGO_DEBUG='0', BREVO_EMAIL_ENABLED='0', PHILSMS_ENABLED='0', RENDER='false')

import django
from django.conf import settings
from django.core.management import call_command

output = root / '.tmp' / 'presentation-review'
output.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(dir=output) as temporary:
    temporary = Path(temporary)
    database = temporary / 'snapshot.sqlite3'
    source = root / 'backend' / 'db.sqlite3'
    if source.exists():
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as original:
            with closing(sqlite3.connect(database)) as snapshot:
                original.backup(snapshot)
    settings.DATABASES['default']['NAME'] = database
    settings.MEDIA_ROOT = temporary / 'media'
    settings.STATIC_ROOT = temporary / 'static'
    settings.ALLOWED_HOSTS = ['testserver', 'localhost']
    django.setup()
    call_command('collectstatic', interactive=False, verbosity=0)
    call_command('check')
    call_command('makemigrations', check=True, dry_run=True, verbosity=1)
    try:
        call_command('test', 'api', interactive=False, verbosity=1)
    finally:
        from django.db import connections
        connections.close_all()

    # Only the disposable snapshot is migrated to allow profiling older local data.
    call_command('migrate', interactive=False, verbosity=0)
    from django.contrib.auth import get_user_model
    from django.db import connection
    from django.test.utils import CaptureQueriesContext
    from rest_framework.test import APIClient
    from api.models import BurialApplication, BurialPlot, ColumbariumSlot

    client = APIClient()
    mayor = get_user_model().objects.filter(profile__role='mayor').first()
    measurements = []
    for route in ['/api/columbariums/?scope=active', '/api/burial-plots/?scope=active',
                  '/api/cemetery-sections/', '/api/burial-applications/', '/api/users/']:
        if route in ('/api/burial-applications/', '/api/users/'):
            if mayor is None:
                continue
            client.force_authenticate(mayor)
        with CaptureQueriesContext(connection) as queries:
            start = time.perf_counter()
            response = client.get(route)
            elapsed = time.perf_counter() - start
        measurements.append(dict(route=route, status=response.status_code,
            ms=round(elapsed * 1000, 1), queries=len(queries),
            json_bytes=len(response.content), gzip_bytes=len(gzip.compress(response.content))))
    report = dict(database='disposable copy of local SQLite; not hosted PostgreSQL',
        records=dict(niches=ColumbariumSlot.objects.count(), plots=BurialPlot.objects.count(),
                     applications=BurialApplication.objects.count()), measurements=measurements)
    (output / 'measurements.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    connection.close()
