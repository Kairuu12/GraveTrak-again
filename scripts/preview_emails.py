"""Render fictional email samples locally; never connect to Brevo or the database."""
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'gravetrak_backend.settings')
import django
django.setup()
from api.email_templates import render_email

output = root / '.tmp/email-design-preview'
output.mkdir(parents=True, exist_ok=True)
samples = {
    'approval': dict(title='Burial Application Approved', kind='approved', name='Maria',
        reference='GT-2026-00128', message='Your Burial Application GT-2026-00128 has been approved.'),
    'interview': dict(title='Your interview has been scheduled', kind='interview_scheduled', name='Maria',
        reference='GT-2026-00128', message='Your interview for Burial Application GT-2026-00128 has been scheduled for November 05, 2026 at 10:00 AM at CMO Office.'),
    'verification': dict(title='Verify your email address', kind='verification', name='Maria', code='482915',
        message='Confirm your email address to receive important updates about your burial application.'),
}
for label, context in samples.items():
    (output / f'{label}.html').write_text(render_email(**context), encoding='utf-8')
print(f'Rendered {len(samples)} fictional previews in {output}. No email sent.')
