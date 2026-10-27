# Render client-presentation review

Review date: 27 October 2026 (Asia/Manila).

Verdict: suitable to prepare for a small, controlled client demo, but do not treat
the old deployment or an unconfigured upload of this folder as presentation-ready.
The local changes need deployment and an online rehearsal with the actual accounts,
PostgreSQL database and uploaded documents before a final go-ahead.

## Observed live performance

Read-only requests to the existing public services, measured from this computer:

| Request | Elapsed | Decoded response size |
| --- | ---: | ---: |
| First backend `/api/` request | 13.34 s | 1.1 KB |
| Next backend `/api/` request | 1.52 s | 1.1 KB |
| `/api/columbariums/?scope=active` | 7.04 s | 2.91 MB |
| `/api/burial-plots/` | 4.21 s | 849 KB |
| `/api/cemetery-sections/` | 0.89 s | 14 KB |

These are individual end-to-end observations, not load-test averages. The server
reported gzip encoding: the sizes above are decoded JSON, not bytes transmitted
over the network. The deployed niche endpoint is old code and may not implement
the current active-scope behavior. No authenticated hosted records were accessed.

The first-request delay is consistent with a wake-up or startup delay, but this
does not prove the service is on the free plan. Render dashboard logs, service
plan and region were not available. Render documents that free web services sleep
after 15 idle minutes and take about a minute to wake:
https://render.com/docs/free

The deployed frontend loads an older main JavaScript bundle of about 1.08 MB.
The current production entry is about 169 KB (55 KB gzip), with separate page
chunks. This is an entry-bundle comparison, not total page download size. Admin
and spreadsheet-export chunks remain large; the spreadsheet library is loaded
on demand. Frontend inventory processing on 15,328 synthetic records measured
49.5 ms median here; that excludes map rendering and does not predict mobile speed.

Other contributors: complete niche/plot inventories are downloaded and processed
client-side; regular-user applications previously polled every five seconds;
some admin effects load overlapping inventory datasets. More filtering, pagination
and map-specific payloads are future performance work, not part of this small fix.

## Changes prepared locally

- Environment-configured allowed hosts, CORS and CSRF origins; Render's hostname
  is accepted automatically. HTTPS proxy handling preserves secure document links.
- Render rejects debug mode, the placeholder secret and SQLite configuration.
  Local development can still use SQLite.
- Gunicorn dependency, WhiteNoise static assets, static collection build script,
  gzip middleware, database health endpoint `/healthz/`, and Python 3.12 selection.
- Configurable media directory for a persistent disk. No document data was moved.
- Application polling every 15 seconds, skipped in hidden tabs and while a poll
  is pending. Returning to a visible tab triggers a refresh.
- The service worker no longer caches API responses/documents or returns a prior
  account's data offline. Activation removes the previous API cache.
- Updated an obsolete reporting-test fixture to use a completed burial with its
  actual execution date. Business report behavior was not changed.

## Completed validation

Follow-up database verification: the actual running Django processes in this
project's backend directory have `DB_ENGINE=postgresql` and `DB_NAME=gravetrak_dev`.
A read-only connection with the current project configuration successfully queried
PostgreSQL 17.11 on Windows. That database contains 39 applications, 16,450 niches
and 3,559 ground plots. The old SQLite file remains on disk (last modified
18 October 2026) but is not selected by those running processes. The SQLite tests
and profiling below used an older disposable snapshot, not this active database.
No database migration or data changes were made during this verification.
The separate hosted Render database engine has not been verified.

- Frontend production build: passed. The existing large admin/export chunk warning
  remains; this does not fail the build.
- Frontend utilities and cache regression checks: 89 passed.
- Backend API, workflows, permissions, email-provider mocks and deployment checks:
  199 passed with Django 4.2.30 and DRF 3.17.2 resolved from requirements.txt.
- Django system check, static collection and missing-migration check: passed.
- Tests ran on Windows/Python 3.13; Linux/Python 3.12 is the recommended Render
  runtime and still needs a deployment smoke test. The copied `backend/venv`
  points to a different computer and cannot be reused here.
- No connected browser was available for a visual hosted walkthrough. Public HTTP
  availability and timings were checked; no full browser or authenticated hosted
  workflow pass is claimed.

The disposable local SQLite snapshot contained 14,800 niches, 2,192 ground plots
and 32 applications. These are not asserted to be the current hosted data:

| Endpoint | Local elapsed | Queries | JSON / gzip estimate |
| --- | ---: | ---: | ---: |
| Active niches | 523 ms | 4 | 3.65 MB / 134 KB |
| Active ground plots | 183 ms | 1 | 1.06 MB / 70 KB |
| Sections | 23 ms | 2 | 14.8 KB / 1.7 KB |
| Applications | 26 ms | 4 | 109 KB / 6.4 KB |
| Users | 12 ms | 18 | 12 KB / 1 KB |

The main inventory/application queries are already batched. User-list email
verification still performs a query per user; this is a smaller remaining
optimization for a large account directory. Local times include API rendering
but exclude internet latency, Render CPU limits and browser map drawing. Gzip
estimates do not remove the cost of parsing/rendering the full decoded inventory.

When running locally after these changes, install the updated backend requirements
in the intended virtual environment first (WhiteNoise is a new runtime dependency).
Validation dependencies were installed only in `.tmp`; the global Python
installation was not changed.

## Configure the existing Render services

This directory is not a Git checkout. Transfer the reviewed source changes into
the repository actually connected to Render. Do not upload `venv`, `node_modules`,
`.tmp`, local credential files, database files or real client uploads to Git.

### Backend web service

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Build command | `bash build.sh` |
| Start command | `gunicorn gravetrak_backend.wsgi:application --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 60 --access-logfile - --error-logfile -` |
| Health check | `/healthz/` |
| Python | `.python-version` selects 3.12; remove any conflicting dashboard `PYTHON_VERSION` override |

Start with one worker and four threads for a small demo and inspect memory/latency
in Render. These settings are not a claim that the instance can handle production
load. Do not use Django `runserver` or Vite's development server for hosting.

Set environment variables in the backend service:

```text
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<random secret at least 50 characters>
DJANGO_ALLOWED_HOSTS=gravetrak-backend.onrender.com
CORS_ALLOWED_ORIGINS=https://gravetrak-frontend.onrender.com
CSRF_TRUSTED_ORIGINS=https://gravetrak-frontend.onrender.com
DB_ENGINE=postgresql
DB_NAME=<database name>
DB_USER=<database user>
DB_PASSWORD=<database password>
DB_HOST=<Render internal database hostname>
DB_PORT=5432
```

Use the internal connection details of a database in the same Render region.
`DATABASE_URL` alone is not consumed by these settings. Merely selecting Postgres
does not copy your local accounts, cemetery sections, applications or uploads.
Confirm which database is authoritative before any data transfer.

Before migrating an existing hosted database, take its backup and review
`python manage.py migrate --plan`. After review, use
`python manage.py migrate --noinput` as the pre-deploy command when available.
If the plan has no pre-deploy command, prepend that migration command with `&&`
to the start command only after reviewing the migration plan and backing up.
The build script intentionally does not run database migrations.

### Frontend static site

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |
| Environment | `VITE_API_BASE=https://gravetrak-backend.onrender.com/api` |
| Rewrite | `/*` to `/index.html`, action **Rewrite** |

The API URL is baked into the Vite build. Changing it requires a rebuild. Use the
actual service URLs if different from the existing names above. Directly opening
`/map`, `/login` and `/admin` requires the SPA rewrite. On a previously used browser,
reload after the updated worker activates and verify the latest UI appears.

### Uploads and notifications

For durable uploads, attach a disk at `/var/data` and set
`DJANGO_MEDIA_ROOT=/var/data/media`. Copy approved demo documents into the matching
relative paths if the database already refers to existing files. PostgreSQL stores
file references, not the uploaded PDF/image bytes. Protected downloads continue to
use the authenticated API; do not expose the private media directory through
WhiteNoise or a public static route.

Free services cannot attach a disk. If using free hosting, uploads are temporary
and are lost on restart, redeploy or sleep. A paid backend with durable uploads
is the more dependable client-demo choice, but nothing paid has been provisioned.
See https://render.com/docs/disks and https://render.com/docs/free.

Application emails are queued. The Windows Task Scheduler worker does not run on
Render. Configure a scheduler/worker that invokes
`python manage.py send_pending_emails` against the same database if demonstrating
email delivery. Set Brevo environment values on that process and the backend;
use a verified demo account and an opted-in recipient. The verification-code API
contacts Brevo synchronously and can wait up to its 10-second provider timeout.
No real email or SMS was sent during this review.

Support/transfer-message and some legacy cancellation/interview overlays remain
in browser localStorage. Do not demonstrate them as cross-device synchronized
workflows. Use database-backed burial submission, review, scheduling, assignment,
completion and operations reports for the main presentation. Rehearse with clean
browser profiles so old `gravetrak_demo_*` values do not mask server state.

## Final rehearsal before the client

1. Confirm the deployed commit and `/healthz/` return success; verify frontend API
   requests target the backend and have no CORS/400/500 errors.
2. Test real demo logins for citizen, CMO, CPDO and cemetery staff. Do not rely on
   hard-coded quick-demo accounts unless those accounts exist in the demo database.
3. Check both cemetery maps, section selection, niche/plot search and route display.
   GPS needs browser permission and HTTPS; rehearse the entrance fallback indoors.
4. Submit a synthetic application, preview its uploaded PDF, review documents,
   schedule, assign an available plot/niche and confirm completion. Verify the
   citizen sees the resulting status. Use separate browser profiles for roles.
5. Export the report and confirm completed burials use their actual completion date.
6. Restart the backend and confirm records and documents still open. This validates
   database and upload persistence independently.
7. Open the system several minutes before presenting. On a free backend, returning
   after 15 idle minutes can trigger another wake-up. Warming it once is not a
   guarantee against future delays.

Validation script: `python scripts/check_presentation.py` using a Python environment
with backend requirements installed. It uses a temporary snapshot/test database,
temporary uploads and disabled providers. Performance measurements are written to
`.tmp/presentation-review/measurements.json` without personal records.

Not verified here: Linux Gunicorn execution, hosted Postgres migrations, authenticated
end-to-end hosted workflow, real provider delivery, Render CPU/memory under load,
and document persistence after a real hosted restart. No deployment was performed.

Official deployment reference: https://render.com/docs/deploy-django
