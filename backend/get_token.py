import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','gravetrak_backend.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
User=get_user_model()
u=User.objects.filter(is_superuser=True).first() or User.objects.first()
print('NOUSER' if not u else u.username)
print('TOKEN', Token.objects.get_or_create(user=u)[0].key)