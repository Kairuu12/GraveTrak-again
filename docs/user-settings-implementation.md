User Settings implementation report
===================================

The registered/public user Settings page now has working Profile, Security, Notifications, Appearance & Accessibility, and Account cards. The existing sidebar, green palette, theme variables, cards, and authentication flow are retained. The Mayor/Admin settings page was not redesigned.

1. **Files modified**

   | File | Change |
   | --- | --- |
   | `backend/api/models.py` | Adds preferences to the existing user profile. |
   | `backend/api/serializers.py` | Includes account preferences, initialization state, channel availability, and a masked SMS destination in authenticated user responses. |
   | `backend/api/views.py` | Extends the existing `/profile/` endpoint with self-service PATCH. |
   | `backend/api/urls.py` | Adds profile preference and password-change routes. |
   | `backend/api/notifications.py` | Reads the email preference when preparing important notifications, while keeping critical in-app notifications and the SMS outbox. |
   | `frontend/src/api.js` | Adds self-profile, preferences, and password API calls; saves the replacement authentication token after a password change. |
   | `frontend/src/App.jsx` | Uses the shared appearance hook and passes real account data to Settings; keeps the displayed profile synchronized after edits. |
   | `frontend/src/pages/PublicMapPage.jsx` | Replaces the UI-only settings block, removes its old contrast filter and unsaved controls, and applies public-user accessibility attributes. |
   | `frontend/src/components/shared/Modal.jsx` | Reuses the existing modal with dialog semantics, keyboard focus containment, Escape, focus restoration, scroll handling, busy state, and an optional portal target. |

   Runtime artifacts changed: local `backend/db.sqlite3` and the rebuilt `frontend/dist` output. No package/dependency manifest was changed.

2. **Files created**

   - `backend/api/account_settings.py` — current-user profile, preference, and password validation/API behavior.
   - `backend/api/user_preferences.py` — preference defaults and shared preference reader.
   - `backend/api/migrations/0026_userprofile_preferences.py`.
   - `backend/api/test_account_settings.py` — 14 API tests.
   - `frontend/src/components/UserSettings.jsx`.
   - `frontend/src/components/UserSettings.css`.
   - `frontend/src/hooks/useAccountPreferences.js`.
   - `scripts/settings_browser_server.py` — isolated Django API fixture for browser testing.
   - `scripts/test_settings_browser.cjs` — reproducible end-to-end browser checks.
   - `docs/user-settings-implementation.md` — this report.

   Local generated artifacts: `.tmp/db-before-user-settings.sqlite3` is the pre-migration database backup. `.tmp/settings-browser-review/` contains screenshots, test results, temporary Chrome profiles, and isolated test databases. Browser fixture users are created only in those test databases, never in the application database or production UI.

3. **Migration**

   `0026_userprofile_preferences` depends on `0025_burial_notification_outbox`. It was applied successfully to the local database after making a SQLite backup. Django's system check reported no issues.

4. **Schema changes**

   One JSON column, `api_userprofile.preferences`, was added with a callable empty-dictionary default. Existing users and profiles are preserved. No new preferences table, profile identity fields, phone fields, password fields, notification table, or login-history table was created.

   Inspection found the existing profile columns `id`, `role`, `user_id`, `contact_number`, and `permissions`. The existing `api_systemsettings` table holds system-wide settings, not per-account preferences, so it was not repurposed.

5. **Reused components/services**

   Django User and UserProfile; existing first/last name and username/email conventions; token authentication and logout; configured Django password validators and hashing; the Philippine mobile normalizer from the notification work; the existing NotificationService, Notification model and SMS outbox; the existing shared Modal; GraveTrak CSS variables/buttons; the existing public sidebar and profile-menu Settings entry.

6. **Database-backed settings**

   The preferences JSON stores validated keys only:

   | Preference | Default | Behavior |
   | --- | --- | --- |
   | `email_notifications` | `true` | Optional email delivery preference. |
   | `sms_notifications` | `false` | Reserved for future availability; enabling it is rejected today. |
   | `cemetery_announcements` | `true` | Saved preference for future announcements. |
   | `theme` | `light` | `light`, `dark`, or `system`. |
   | `text_size` | `standard` | `standard`, `medium`, or `large`. |
   | `high_contrast` | `false` | Public-user contrast enhancement. |

   Profile identity and contact changes continue using their original database fields. Passwords continue using Django's original hashed password field.

7. **Browser storage**

   Account-backed choices become authoritative after their first preference save. Before that first save, pre-existing device appearance choices (`theme`, `gravetrak_ui_scale`, `gravetrak_high_contrast`) are preserved for backward compatibility. The first preference save includes those effective appearance choices and persists them to the account.

   The existing `theme` local-storage key continues to serve guest/admin device appearance. Authenticated public-user preferences are loaded from the API on refresh/login, not stored in another competing browser settings object. Existing `authToken`/`token` storage remains unchanged in structure; password changes replace those tokens. Password input values are never stored in local storage.

8. **Profile editing**

   Settings fetches the current authenticated profile with a loading state and retryable error state. Profile details begin read-only. Edit Profile reveals fields; Cancel discards the draft; Save Profile performs frontend checks and submits to the existing `/api/profile/` route using PATCH.

   Editing retains separate first-name/middle-initial and last-name/suffix fields, matching the registration convention rather than guessing how to split a full name. Values are trimmed; a combined empty name is rejected. Email must be valid, is normalized to lowercase, and is checked against other users' username/email values case-insensitively. Django's existing unique username constraint also protects conflicting writes. Updating email synchronizes the original username and email fields, so the new email is used for later login.

   Field errors appear next to their inputs. Successful saves update the account and visible portal identity. No sample profile information is hardcoded into the settings page.

9. **Contact number validation**

   Backend validation reuses `normalize_ph_mobile()` from `api/notifications.py`. It accepts Philippine mobile numbers starting with `09`, `9`, `+639`, or `639`, including reasonable spaces, hyphens, and parentheses. The profile saves the equivalent local `09XXXXXXXXX` representation; SMS preparation still uses `+639XXXXXXXXX`. This validates number format, not carrier ownership or actual reachability.

   Notification-related UI uses a backend-generated mask, such as `0912*****89`. There is no second SMS phone field.

10. **Password changes**

    The Security card opens the shared modal with Current Password, New Password, and Confirm New Password. The API verifies the current password with `check_password()`, requires matching confirmation, rejects reuse of the current password, and calls Django's configured validators. The frontend provides immediate confirmation/minimum-length feedback; the backend remains authoritative.

    `set_password()` hashes the password. Password fields are write-only, sensitive form parameters are marked for Django's error reporting, and no new password logging is added. Responses never include a password/hash. On success, the existing token is revoked and a replacement returned to keep the current device signed in. Other devices using the previous shared token must sign in again. Password form values are cleared on close/success.

    The existing `last_login` field is displayed only when populated. The token login endpoint does not currently populate it, and no separate login-history feature was invented.

11. **Notification preference integration**

    Critical in-app application notifications remain enabled regardless of optional channel choices. Settings does not reproduce any Burial Application event logic.

    The existing NotificationService reads `email_notifications` when setting `send_via_email` for important notification events. This is a delivery preference flag, not proof of sending. No email sender/worker exists in this checkout, so the UI explicitly explains that email delivery is not yet available. Historical records are not replayed or rewritten when preferences change.

    Cemetery Announcements is stored and ready for future use. No announcement delivery functionality was found, and no announcement system was added.

12. **SMS without a provider**

    SMS displays **Coming Soon**, a masked future destination if valid, and no active toggle. The backend rejects `sms_notifications: true`. No SDK, provider, credential, HTTP SMS call, or fake success state was introduced.

    The existing SMS event/outbox preparation remains intact. Outbox records still start ineligible for delivery, and no historical SMS records are sent. Future provider work must separately activate the preference/availability handling and enforce delivery eligibility.

13. **Theme persistence**

    The shared `useAccountPreferences` hook is the public user's single theme source. Selection applies immediately, saves to the account, and restores the previous setting with a visible error if the API fails. Controls show subtle Saving/Saved feedback. Refresh and login load the saved account choice. Existing guest/admin theme controls retain device-local behavior.

14. **System Theme**

    `system` resolves through `matchMedia('(prefers-color-scheme: dark)')`. A change listener updates the effective Light/Dark appearance when the operating-system/browser setting changes. The stored value remains `system` rather than being overwritten by its currently resolved color.

15. **Text size**

    Standard, Medium, and Large persist as account preferences and use CSS text scaling of 1.0, 1.1, and 1.2. Settings text and relevant public form/table text use this scale. It does not use browser zoom, whole-page transforms, or resize map geometry.

16. **High contrast**

    High Contrast persists to the account and changes public-portal text/border tokens. Dark mode gets corresponding light text/border adjustments. The old public settings contrast/saturation filter was removed; status color tokens remain unchanged. These enhancements are scoped to the public portal instead of changing the Mayor/Admin settings implementation.

17. **Authorization and APIs**

    All self-service settings operations use TokenAuthentication and IsAuthenticated, resolving `request.user` on the backend. No target user ID is accepted. Unknown fields, including role, permissions, user IDs, and plaintext password updates on the profile route, are rejected.

    - `GET /api/profile/` — existing authenticated profile route, expanded response.
    - `PATCH /api/profile/` — own name, email, and contact details.
    - `GET /api/profile/preferences/` — own effective preference values.
    - `PATCH /api/profile/preferences/` — validated partial preference update.
    - `POST /api/profile/change-password/` — current/new/confirmation password flow.

    The existing `/api/users/{id}/` admin permissions and `/api/logout/` behavior are retained. The Account card uses the existing logout callback. No Delete Account action exists.

18. **Commands**

    Local migration and production build are already complete. On another checkout/deployment, run from the project root:

    ```powershell
    .\backend\venv\Scripts\python.exe .\backend\manage.py migrate
    .\backend\venv\Scripts\python.exe .\backend\manage.py test api --noinput
    cd frontend
    npm.cmd run build
    ```

    To rerun browser verification from the project root after building:

    ```powershell
    node scripts/test_settings_browser.cjs
    ```

    Browser verification uses the existing Python environment, Node 22+ and Chrome, ports 8016/5179/9346, and a separate fixture database. `CHROME_PATH` can optionally point to a different local Chrome executable for this test only. No application environment variables or dependencies were added. Restart running application processes if they do not reload code automatically.

19. **Tests and verification**

    - Full API regression suite: **76 tests passed**.
    - Focused settings/notification run: **31 tests passed** (14 new settings tests and 17 existing notification tests).
    - Production frontend build: **passed**. Vite retains its large-bundle advisory.
    - Local migration and Django system check: **passed**.
    - Browser checks use real settings API calls against an isolated Django database. They cover actual profile loading, editing, invalid/duplicate email, invalid phone, wrong/current password validation, successful password change, token/session continuity, Light/Dark/System themes including OS preference changes, text size, contrast, email/announcement preferences, save-failure rollback, refresh persistence, logout/login persistence, and desktop/tablet/mobile layout.
    - Responsive checks cover widths of **1365, 768, 390, and 320 pixels**, including Large text and High Contrast. Dialog checks cover keyboard containment, Escape, focus restoration, and a full-viewport backdrop.
    - Browser runtime/console/API checks distinguish intentional validation errors and the deliberately injected save failure from unexpected failures. Test results and screenshots are saved in `.tmp/settings-browser-review/`.
    - External map tiles, remote fonts, and Turf are excluded from the isolated settings browser run; it does not claim to retest external mapping services.

20. **Remaining integration work and limitations**

    External SMS delivery requires the separately approved future provider. Email delivery and cemetery announcements also have no sender/system in this checkout; their preferences are stored honestly for future integration. Last-login display depends on an already populated `last_login`, and is otherwise omitted. No new login tracking, account deletion, notification event implementation, or unrelated portal redesign was added.

    Existing unrelated migration-state differences for columbarium display options and role choice labels were already present before this task; the settings migration does not include them. The changed settings schema itself applies successfully without resetting the database.
