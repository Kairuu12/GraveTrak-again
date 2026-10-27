# GraveTrak Django Backend

This backend is built with Django and Django REST Framework. It exposes a simple REST API for graves and user authentication.

## Setup

1. Create a Python virtual environment in `backend`.
2. Install dependencies:
   ```powershell
   pip install -r requirements.txt
   ```
3. Select local SQLite and start Django:
   ```powershell
   $env:DJANGO_DEBUG = "1"
   $env:DB_ENGINE = "sqlite"
   python manage.py runserver
   ```

## Database configuration

Django reads database settings from the backend process environment. The
`backend/.env.example` file is a reference only; it is not loaded automatically.
Local development can use SQLite at `backend/db.sqlite3` by setting
`DJANGO_DEBUG=1` or explicitly setting `DB_ENGINE=sqlite`. To select
PostgreSQL, set `DB_ENGINE=postgresql` and provide
`DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_HOST`; `DB_PORT` defaults to `5432`.
`DJANGO_DEBUG` defaults to `0`. When `DB_ENGINE` is omitted, the backend uses
the local SQLite database so `python manage.py runserver` works in a fresh
checkout. For PostgreSQL, explicitly set `DB_ENGINE=postgresql` and provide
`DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_HOST`; missing connection settings
cause startup to fail rather than falling back to SQLite. Set real credentials
in your hosting provider's environment settings, never in source control.

PowerShell example for selecting PostgreSQL in the current terminal:
```powershell
$env:DB_ENGINE = "postgresql"
$env:DJANGO_DEBUG = "0"
$env:DB_NAME = "your_database_name"
$env:DB_USER = "your_database_user"
$env:DB_PASSWORD = "your_secret"
$env:DB_HOST = "your_database_host"
$env:DB_PORT = "5432"
python manage.py runserver
```

For Render later, configure those variables in the backend service environment
using the PostgreSQL instance's connection details. Do not run migrations or
transfer data as part of simply switching the engine: `migrate` creates schema
but does not copy existing SQLite records. Keep the original SQLite file and
media directory as rollback sources until a separately approved transfer has
been validated.

To switch back to SQLite locally, set `DB_ENGINE=sqlite` and
`DJANGO_DEBUG=1`, or remove `DB_ENGINE` while explicitly setting
`DJANGO_DEBUG=1`. The SQLite database must be the intended local database;
changing the engine does not synchronize data between databases.

## Start the server

```powershell
$env:DJANGO_DEBUG = "1"
$env:DB_ENGINE = "sqlite"
python manage.py runserver
```

## Demo Accounts

- Admin: `admin@lgu.gov.ph` / `adminpass`
- Mayor: `mayor@lgu.gov.ph` / `mayorpass`
- Planning: `planner@lgu.gov.ph` / `planningpass`
- Public User: `user@lgu.gov.ph` / `userpass`

These demo accounts may not exist in a fresh database. Seed data is available
only through the explicit `python manage.py seed_demo_data` command when
`DEBUG=True`.

## API Endpoints

- `POST /api/login/`
- `POST /api/register/`
- `POST /api/logout/`
- `GET /api/profile/`
- `GET /api/graves/`
- `POST /api/graves/`
- `PATCH /api/graves/{id}/`
- `DELETE /api/graves/{id}/`
- `GET /api/users/` (staff/admin only)
