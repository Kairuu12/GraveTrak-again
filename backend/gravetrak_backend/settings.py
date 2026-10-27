import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
from .email_config import email_settings
email_config = email_settings(BASE_DIR / '.env.email')
# SMS credentials are backend process environment variables, never frontend values.
PHILSMS_ENABLED = os.environ.get('PHILSMS_ENABLED', '0') == '1'
BREVO_EMAIL_ENABLED = email_config.get('BREVO_EMAIL_ENABLED', '0') == '1'
BREVO_API_KEY = email_config.get('BREVO_API_KEY', '')
BREVO_SENDER_EMAIL = email_config.get('BREVO_SENDER_EMAIL', '')
BREVO_SENDER_NAME = email_config.get('BREVO_SENDER_NAME', 'GraveTrak')
BREVO_TEST_RECIPIENT = email_config.get('BREVO_TEST_RECIPIENT', '')
PHILSMS_API_TOKEN = os.environ.get('PHILSMS_API_TOKEN', '')
PHILSMS_SENDER_ID = os.environ.get('PHILSMS_SENDER_ID', '')
PHILSMS_BASE_URL = os.environ.get('PHILSMS_BASE_URL', 'https://dashboard.philsms.com/api/v3').rstrip('/')
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'change-me-to-a-secure-key')
DEBUG = os.environ.get('DJANGO_DEBUG', '0') == '1'
ON_RENDER = os.environ.get('RENDER', '').lower() == 'true'
if ON_RENDER and (SECRET_KEY == 'change-me-to-a-secure-key' or len(SECRET_KEY) < 50):
    raise ImproperlyConfigured('Set a random DJANGO_SECRET_KEY of at least 50 characters on Render.')
if ON_RENDER and DEBUG:
    raise ImproperlyConfigured('DJANGO_DEBUG must be 0 on Render.')


def env_list(name, default):
    return [value.strip() for value in os.environ.get(name, default).split(',') if value.strip()]


ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS', '127.0.0.1,localhost')
if os.environ.get('RENDER_EXTERNAL_HOSTNAME'):
    ALLOWED_HOSTS.append(os.environ['RENDER_EXTERNAL_HOSTNAME'])

# Render terminates TLS at its proxy. Preserve HTTPS document links and cookies.
if ON_RENDER:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.middleware.gzip.GZipMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'gravetrak_backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'gravetrak_backend.wsgi.application'

DATABASES = {
    'default': {},
}

# Use the local SQLite database when DB_ENGINE is omitted so a fresh checkout
# can start with `python manage.py runserver`. Deployments must select
# PostgreSQL explicitly and provide its connection settings.
db_engine = os.environ.get('DB_ENGINE', 'sqlite').strip().lower()
if ON_RENDER and db_engine not in ('postgres', 'postgresql', 'django.db.backends.postgresql'):
    raise ImproperlyConfigured('Set DB_ENGINE=postgresql on Render; its local SQLite file is not durable.')

if db_engine in ('sqlite', 'django.db.backends.sqlite3'):
    DATABASES['default'] = {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
elif db_engine in ('postgres', 'postgresql', 'django.db.backends.postgresql'):
    required_db_settings = ('DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST')
    missing_db_settings = [name for name in required_db_settings if not os.environ.get(name)]
    if missing_db_settings:
        raise ImproperlyConfigured(
            'PostgreSQL is selected, but the following environment variables are missing: '
            + ', '.join(missing_db_settings)
        )

    db_port = os.environ.get('DB_PORT', '5432')
    if not db_port.isdigit() or not 1 <= int(db_port) <= 65535:
        raise ImproperlyConfigured('DB_PORT must be an integer between 1 and 65535.')

    DATABASES['default'] = {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ['DB_NAME'],
        'USER': os.environ['DB_USER'],
        'PASSWORD': os.environ['DB_PASSWORD'],
        'HOST': os.environ['DB_HOST'],
        'PORT': db_port,
        'CONN_MAX_AGE': 600,
        'CONN_HEALTH_CHECKS': True,
    }
else:
    raise ImproperlyConfigured(
        "DB_ENGINE must be 'sqlite' or 'postgresql' (also accepts 'postgres')."
    )

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Manila'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}
MEDIA_URL = '/media/'
MEDIA_ROOT = Path(os.environ.get('DJANGO_MEDIA_ROOT', str(BASE_DIR / 'media')))
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
}

CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
]

CSRF_TRUSTED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]

CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = env_list('CORS_ALLOWED_ORIGINS', ','.join(CORS_ALLOWED_ORIGINS))
CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS', ','.join(CSRF_TRUSTED_ORIGINS))
