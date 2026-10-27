import urllib.request
import json
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','gravetrak_backend.settings')
import django
django.setup()
from api.models import BurialApplication

app = BurialApplication.objects.first()
app_id = app.id
url = f'http://127.0.0.1:8000/api/burial-applications/{app_id}/'
print(f'Testing URL: {url}')

# Create request with authentication header
req = urllib.request.Request(url)
req.add_header('Authorization', 'Token d34f7b6ebc838d969ad40da479a438697f8af09f')
req.add_header('Content-Type', 'application/json')

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        print("Full API Response:")
        print(json.dumps(data, indent=2))

        # Check different possible field names
        docs = data.get('documents') or data.get('burial_documents') or []
        print(f"\nFound {len(docs)} documents in field 'documents' or 'burial_documents'")
        for doc in docs:
            doc_type = doc.get('document_type_display')
            doc_url = doc.get('document_file')
            print(f'  - {doc_type}: {doc_url}')
except Exception as e:
    print(f'Error: {e}')