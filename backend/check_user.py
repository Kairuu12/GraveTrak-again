import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','gravetrak_backend.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from api.views import is_mayor, is_planning, is_admin

User = get_user_model()
user = User.objects.get(username='admin@lgu.gov.ph')
print(f'User: {user.username}')
print(f'Is superuser: {user.is_superuser}')
print(f'Is staff: {user.is_staff}')
print(f'Is mayor: {is_mayor(user)}')
print(f'Is planning: {is_planning(user)}')
print(f'Is admin: {is_admin(user)}')

# Check profile
profile = getattr(user, 'profile', None)
if profile:
    print(f'Profile role: {profile.role}')
else:
    print('No profile found')