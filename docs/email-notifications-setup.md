# GraveTrak email notifications (Brevo)

Email integration is implemented but disabled by default. A Brevo account,
verified sender and API key are required before actual email can be sent.
No API key is included in this repository.

## 1. Create your account and sender

1. Open https://www.brevo.com/ and sign up for the Free plan using an email your team controls.
2. Complete the verification email and any onboarding requirements yourself.
3. In Brevo's sender settings, add **GraveTrak** and your sender email address.
   Verify that address. Complete domain authentication if required by Brevo.
4. Confirm transactional sending is enabled/approved in your account.

## 2. Create the API key

Open **Settings → SMTP & API → API Keys & MCP**, then generate a standard API key
named `GraveTrak backend`. Do not enable MCP access for this integration.
Copy it to your password manager. Use an **API key**, not an SMTP key.
Do not paste it into chat, frontend code, screenshots, or version control.

Official instructions:
- https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys
- https://developers.brevo.com/docs/send-a-transactional-email

## 3. Configure the backend

Set these environment variables in the backend process and worker process:

```text
BREVO_EMAIL_ENABLED=1
BREVO_API_KEY=<your private API key>
BREVO_SENDER_EMAIL=<verified sender email>
BREVO_SENDER_NAME=GraveTrak
BREVO_TEST_RECIPIENT=<your own mailbox for tests only>
```

For local setup, put these settings in `backend/.env.email` (ignored by Git).
The backend and email worker automatically load this file. Only the five Brevo
settings above are read, and existing process environment variables take priority.
File values are not exported into the process environment, so the development
auto-reloader cannot accidentally preserve a previous key or disabled flag.
`runserver` watches `.env.email` and reloads when it changes; the scheduled worker
reads it on every run. After installing this fix, stop and restart any already
running backend once to clear values inherited from the old loader.
Keep `BREVO_EMAIL_ENABLED=0` until you are ready to enable sending. Restart deployed
backend/worker processes after changes. On hosting, use the service's secret/environment
settings. Keep the key out of shell history and screenshots.

Run `python backend/manage.py migrate` before starting the updated backend.

## 4. Run the email worker

For this Windows development computer, install the per-user scheduled task from
the project root (replace the Python path with the interpreter used by Django):

```powershell
.\scripts\install-email-worker.ps1 -PythonExecutable 'C:\path\to\python.exe'
```

The task **GraveTrak Email Notifications** runs every minute while the Windows
user is logged in, without opening a console window. It reads the persistent
Windows user/system `DB_ENGINE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`
and `DB_PORT` settings; these must match the backend. It reloads `.env.email` on
each run. It skips overlapping runs and keeps the latest worker output in
`.tmp/email-worker.log`. Check Task Scheduler's Last Run Result (`0` means the
command completed) and Django Admin's Email outbox for individual email outcomes.
Sleeping/shutting down the computer pauses local delivery until it runs again.
Disable the task in Task Scheduler or set `BREVO_EMAIL_ENABLED=0` to pause sending.
Restart Django after changing that flag so new events use the updated setting.
The scheduled task launches `pythonw.exe`; its helper starts PowerShell with
`CREATE_NO_WINDOW`, preventing the console flash that can occur when Task
Scheduler launches `powershell.exe -WindowStyle Hidden` directly. Re-run the
installer above to update an existing task to the windowless launcher.

For a deployed server, configure its own scheduler instead of relying on this PC:

Schedule `python backend/manage.py send_pending_emails` once per minute with your
hosting scheduler or Windows Task Scheduler. Use the same Python environment,
database configuration and Brevo environment variables as the backend.
Each run processes at most 50 pending messages. Application requests only queue
messages, so a slow or unavailable provider does not block application processing.

For a controlled live test, use a test applicant account whose email you own,
verify its email in Settings, enable its Email notifications preference, generate a new workflow notification,
then run the worker once. Check the inbox and Brevo transactional logs.

`BREVO_SENDER_EMAIL` is the verified address sending messages. It is not the test
destination. `BREVO_TEST_RECIPIENT` is a separate mailbox for manual test sends;
workflow emails still go to the submitting user's account email.

## Scope and delivery status

### Email appearance

Outgoing notifications include a branded HTML version and the existing plain-text
fallback in the same Brevo API request (`htmlContent` and `textContent`). This is
one message, not two sends. The layout includes GraveTrak branding, the event
title, application reference, account greeting and next-step instructions.
Verification emails use the same layout with a prominent code and expiry notice.

Templates use inline styles, presentation tables and system fonts, with no external
images, tracking pixels or scripts. User content is HTML-escaped. Notification
wording comes from the queued message, so later workflow changes do not rewrite
the event being emailed. No public website URL is configured, so the email gives
navigation instructions instead of a nonworking localhost button.

Render fictional previews without sending mail:
`python scripts/preview_emails.py`. Files appear in `.tmp/email-design-preview/`.
Run `node scripts/preview_email_screenshots.cjs` to inspect desktop/mobile layouts
in local Chrome. Browser previews do not certify rendering in every mailbox client.
The design change does not alter notification frequency, verification checks or
user preferences, and does not resend historical messages.

New notifications created through NotificationService (including application
receipt, action required, interview schedule/reschedule, approval/status changes,
burial scheduling and completion) create one email outbox record per event.
Successful application submission now queues its receipt transactionally with the
application and documents. Final Mayor approval through `approve-and-assign` also
queues one approval email; repeating the same approval does not queue another.
Recipients use the submitting account's email; guest applications without an
account are not emailed by this implementation. Existing historical notifications
are never backfilled. Messages created while disabled are not automatically sent
later. User opt-out and changed addresses are checked again before submission.

## User email verification

All existing and new accounts start unverified; previous provider acceptance is
not proof of mailbox ownership. In **Settings > Profile**, the user selects
**Send verification code** and enters the six-digit code from their inbox.
The only email sent before verification is this explicitly requested verification
message. Registration and profile editing do not automatically send email.

Codes expire after 10 minutes, can be used once, and are stored as password hashes.
A new code replaces the old code. Five incorrect attempts invalidate a code.
Requests require a signed-in account, have a 60-second cooldown and are limited
to five per account per 24-hour window starting with the first request. Failed/unknown submissions also
consume this budget; changing an email does not reset it. No automatic retries
are performed. Verification messages are independent of the optional notification
preference, because the user explicitly requests them.

Successful confirmation marks only that account's current email as verified.
Changing it in Settings or the staff user editor clears verification and pending
codes. Both queue creation and worker delivery check verification; blocked
application emails are recorded as `unverified_recipient`. In-app notifications
continue normally. Verifying later does not replay old blocked notifications.

Endpoints (token authentication required):
- `POST /api/profile/email-verification/request/` with `{}`
- `POST /api/profile/email-verification/confirm/` with `{"code":"123456"}` (example only)

Migration `0036_email_verification` adds the verification state and outbox status.
The profile API exposes a verification badge/state, expiry and resend availability,
never the code or its hash. The email channel availability now reflects the actual
provider configuration instead of always reporting unavailable.

View **Email outbox** in Django Admin for pending, accepted, failed, unknown,
opted-out, invalid-recipient or provider-not-configured records. Accepted means
Brevo accepted the submission, not proof that it reached the inbox. Delivered/bounce
webhook processing is not included; consult Brevo logs for final delivery status.

Failed, unknown and interrupted processing rows are not automatically retried,
preventing duplicate emails after timeouts. Inspect provider logs first. No automatic
top-up or paid upgrade is configured. The free plan currently allows 300 emails/day;
provider-side queuing, limits or rejection remain visible through its logs and our
submission status. In-app notifications continue independently.

## Diagnosing missing email after enabling or rotating credentials

A successful direct API-key test does not send older application notifications.
Brevo can also reject a valid key with HTTP 401 when the backend's outbound IP
is not authorized. The outbox now distinguishes that response from generic key
authentication failure. Review the blocked request in Brevo's Security >
Authorized IPs and authorize the recognized backend IP; keep unknown-IP blocking
enabled. See https://developers.brevo.com/docs/ip-security.
Check the Email outbox status and `.tmp/email-worker.log`. The worker reports
actual outcomes (for example `accepted=1`) and warns when earlier notifications
remain `provider_not_configured`. Those records have never been submitted.

Review the event date, recipient and relevance in Admin before recovering a
specific blocked email. Preview first (replace `123` with its **email outbox ID**):

```powershell
python backend/manage.py requeue_unconfigured_emails --ids 123
```

Only after deciding that this old notification should still be delivered:

```powershell
python backend/manage.py requeue_unconfigured_emails --ids 123 --apply
```

The next worker run submits it once. This command refuses previously attempted
or accepted records, ambiguous outcomes, changed email addresses and opt-outs.
Without `--apply` it changes nothing. It never backfills historical notifications.
An `accepted` result still requires checking the recipient inbox/spam folder or
Brevo transactional logs to confirm delivery.
