Burial Application notification implementation
=============================================

The system now creates persistent in-app notifications and prepares SMS outbox records for important Burial Application events. **No SMS provider, credentials, SDK, external SMS request, delivery worker, or simulated delivery was added.**

1. **Files modified**

   - `backend/api/models.py`: extends the existing notification model; adds the SMS outbox and schedule event version.
   - `backend/api/notifications.py` is new; see item 2.
   - `backend/api/workflow.py`: locks status transitions, creates approval/rejection events transactionally, and deduplicates existing informational notifications.
   - `backend/api/appointment_scheduler.py`: commits the schedule, workflow transition, in-app notification, and outbox together; distinguishes initial schedules from material reschedules.
   - `backend/api/views.py`: extends review completion; adds manual notification, unread count, and mark-read actions; makes approval/rejection transactional and preserves authorization checks.
   - `backend/api/serializers.py`: includes application IDs in notification responses and makes rejection/action details available to the authenticated applicant.
   - `backend/api/admin.py`: adds a read-only SMS outbox log with masked recipient numbers and no delivery controls.
   - `frontend/src/api.js`: adds notification APIs and changes manual Notify to its dedicated endpoint.
   - `frontend/src/components/admin/legacy/LegacyAdminWorkspace.jsx`: reuses the existing review and Notify modals; consolidates correction notifications; masks recipients; validates messages; preserves retry keys; reports API failures and the lack of SMS delivery honestly.
   - `frontend/src/pages/PublicMapPage.jsx`: connects the existing bell to backend notifications, adds read controls and application navigation, displays applicant interview notes, and uses backend application status instead of browser demo overrides.
   - Runtime artifacts: the local `backend/db.sqlite3` was migrated and `frontend/dist` was rebuilt.

2. **Files created**

   - `backend/api/notifications.py`: `NotificationService`, `SmsService`, future `SmsProvider` protocol, owner resolution, masking, and Philippine mobile normalization.
   - `backend/api/migrations/0025_burial_notification_outbox.py`.
   - `backend/api/test_notifications.py`: 17 notification tests.
   - `docs/burial-notifications-implementation.md`: this report.
   - `.tmp/db-before-notification-migration.sqlite3`: backup of the local database before applying the migration. Treat it as private application data.

3. **Database migration**

   `0025_burial_notification_outbox` depends on `0024_operations_reports` and has been applied to the local database. Existing notification rows remain compatible because their new event key is nullable. No historical notifications or application records were deleted or backfilled into SMS records.

   The existing database contained `api_notification` and no SMS table. Django's dry-run migration check also identified two unrelated, pre-existing model/migration differences: `ColumbariumSlot` display options and `UserProfile.role` choice labels. Those were deliberately excluded from this migration. A general `makemigrations --check --dry-run` still reports those differences.

4. **New tables and columns**

   - Existing `api_notification`: adds nullable, unique `event_key`; extends the type choices with `documents_correction`, `interview_rescheduled`, and `manual_notification`.
   - Existing `api_interviewschedule`: adds `notification_version`, initially zero.
   - New `api_smsoutbox`: `id`, unique `event_key`, nullable notification link, nullable recipient link, application link, `notification_type`, normalized `recipient_number`, `message`, `status`, `eligible_for_delivery`, `provider`, `provider_message_id`, `error_message`, `created_at`, and nullable `sent_at`.
   - No phone fields or duplicate notification table were added.

5. **Existing functionality reused**

   The existing `Notification` model and `/api/notifications/` route, authentication and capability helpers, application owner relationship, workflow engine, status audit history, appointment scheduler, document completeness review endpoint, applicant bell, tracking details modal, and staff Notify modal are reused.

6. **Exact in-app events**, and 7. **Exact SMS outbox events**

   | Event | In-app | SMS outbox |
   | --- | --- | --- |
   | Application submission | No new automatic behavior | No |
   | Opening/viewing documents, navigation, login/logout | No | No |
   | Individual Complete / Needs Correction clicks | No | No |
   | Documents reach 6/6, or completion proceeds to scheduling | No | No |
   | Finalize review with corrections, after all submitted documents have been reviewed | One `documents_correction` | One |
   | Successful Set Schedule & Notify | One `interview_scheduled` | One |
   | Successful automatic next-slot scheduling | One `interview_scheduled` | One |
   | Material interview date/time/location change | One `interview_rescheduled` | One |
   | Notes-only or duration-only schedule change | No | No |
   | Schedule created again after appointment cancellation | One `interview_rescheduled` | One |
   | Actual transition to `approved` through the workflow engine | One `approved` | One |
   | Actual transition to `rejected` through the workflow engine | One `rejected` | One |
   | Manual Notify | One `manual_notification` | One generic update notice |
   | Existing request-action endpoint | In-app `action_required`, deduplicated by audit event | No |
   | Existing plot assignment, burial scheduling, burial completion | Existing informational notification, deduplicated | No |
   | Appointment cancellation | Existing scheduling behavior preserved | No application-cancellation SMS |

   **There is no backend Burial Application `cancelled` status or cancellation endpoint.** The application statuses are `pending_review`, `action_required`, `documents_complete`, `slot_assigned`, `approved`, `for_interview`, `scheduled`, `completed`, and `rejected`. Appointment `cancelled` is a separate state and returns an interview-stage application to `documents_complete`; it is not an application cancellation. Browser-only cancellation labels were not promoted into a new backend workflow.

   In-app delivery requires a linked `submitted_by` account. Automated important events on legacy/public applications without an owner still create an `invalid_recipient` outbox record, but cannot create an in-app notification. Manual Notify reports this missing-account condition instead of claiming success.

8. **Duplicate protection and transaction safety**

   Both notification and outbox event keys have database uniqueness constraints. There is at most one SMS outbox record per linked notification.

   - Approval/rejection use the existing status audit ID. Repeating the same status action produces no new transition or event.
   - Schedules use schedule ID plus a persisted version. Only a material reschedule advances its notification version. An identical retry of Set Schedule & Notify returns the existing active schedule successfully; changing an active schedule must use reschedule.
   - Correction finalization uses application ID plus a hash of the reviewed documents' IDs, saved file identities, statuses, remarks, and upload timestamps. Repeated finalization of the same result creates no duplicate. A replacement file or changed review result can produce a new event. Including file identity matters because replacement uploads retain their original `uploaded_at` value.
   - Manual Notify requires a UUID `idempotency_key`. The modal retains it during retries; a newly opened modal starts a new intentional notification. Reusing a key with different text returns HTTP 409.
   - Relevant business saves and event/outbox creation run within database transactions. Failed schedule validation creates nothing; a persistence failure rolls back the schedule, transition, and notifications together. The project uses SQLite; row-lock semantics vary by database, while uniqueness constraints still enforce event deduplication.

9. **Applicant contact resolution**

   The backend resolves `BurialApplication.submitted_by.profile.contact_number`. It does not trust frontend recipient IDs or phone numbers and does not fall back to the application form's separate contact-phone snapshot. The Notify recipient endpoint returns a mask only.

10. **Philippine phone normalization**

    `normalize_ph_mobile()` accepts `09123456789`, `9123456789`, `+639123456789`, and `639123456789`, plus reasonable spaces, parentheses, and hyphens. All normalize to `+639123456789`. It validates the Philippine mobile shape, not carrier ownership or deliverability. It does not rewrite the profile's displayed value.

    Valid recipients produce `provider_not_configured`. Missing/invalid numbers produce `invalid_recipient` with an explanatory error and blank normalized number. The associated business action and in-app notification still work.

11. **Notify and applicant bell behavior**

    Notify opens the existing modal showing the application reference and a backend-resolved masked number. A trimmed message of 1–1000 characters is required. Saving creates the in-app message and a generic SMS outbox notice; arbitrary staff text stays in-app. The UI says external SMS delivery is not configured. Invalid numbers are reported. API errors are displayed instead of ignored, and Notify does not alter application status.

    The existing applicant bell fetches persistent notifications on activation/open and every 30 seconds. It shows newest first, an unread count, distinct unread styling, and explicit mark-as-read controls. Clicking a notification marks it read and opens the relevant existing tracking details when the application is loaded, otherwise the tracking panel. Opening the bell alone does not mark backend notifications read. Fetch failures show an error. Full correction remarks, rejection reasons, and interview notes remain in the authenticated application UI.

    Endpoints:

    - `GET /api/notifications/`
    - `GET /api/notifications/{id}/`
    - `GET /api/notifications/unread-count/`
    - `POST /api/notifications/{id}/mark-read/`
    - `GET /api/burial-applications/{id}/notify/` — masked recipient metadata, authorized staff only.
    - `POST /api/burial-applications/{id}/notify/` — `{ "message": "...", "idempotency_key": "UUID" }`, authorized staff only.
    - Existing `complete-document-review`, `schedule-interview`, `reschedule`, `approve`, and `reject` routes are retained.

12. **Commands**

    Local migration and build are already complete. Restart a running backend/frontend process if it does not reload changes automatically. On another checkout/deployment, run from the project root:

    ```powershell
    .\backend\venv\Scripts\python.exe .\backend\manage.py migrate
    .\backend\venv\Scripts\python.exe .\backend\manage.py test api --noinput
    cd frontend
    npm.cmd run build
    ```

    No package installation is needed. The existing Python environment and frontend dependencies were used. Python/Vite checks required execution outside the sandbox because the sandbox denied access to the Python installation and Vite parent-directory resolution.

13. **Environment variables**

    None added. No provider secrets or placeholder credentials exist in the new service or outbox.

14. **Validation performed**

    - Full API suite: **62 tests passed**, including existing document completeness and appointment tests.
    - Final focused rerun after the saved-file deduplication refinement: **17 notification tests passed**.
    - Production frontend build: **passed**. Vite reports its existing large-bundle warning.
    - Migration applied successfully to the local database after SQLite backup; it is also exercised when creating each test database.
    - Tests cover normalization, individual review silence, consolidated corrections, retries, later replacement/review cycles, 6/6 silence, successful/failed scheduling, notes-only edits, material reschedules including returning to an earlier location, approval/rejection retries, failed transitions, manual message validation, forged recipients, missing/invalid numbers, ownerless records, unread count, newest-first ordering, idempotent read timestamps, cross-user isolation, role restrictions, and transaction rollback.
    - No real SMS delivery was tested or expected. An interactive browser walkthrough was not performed; UI validation consists of the production build and review of the connected API behavior.

15. **Future provider connection**

    Implement the `SmsProvider.send(recipient, message, idempotency_key)` adapter boundary in `backend/api/notifications.py` after provider approval. `SmsService.prepare()` is the existing provider-independent outbox entry point used by the notification service. A future separately implemented dispatch worker/service should inject the approved adapter and explicitly select eligible records.

    Every current record has `eligible_for_delivery=False`, no provider/message ID, and no `sent_at`. Do not bulk-enable or automatically replay these historical records when adding a provider. Future work must explicitly define delivery eligibility, provider result handling, retries/idempotency, receipt tracking if supported, and protected environment-based credentials. Nothing currently sends externally or marks a notification/SMS as delivered.
