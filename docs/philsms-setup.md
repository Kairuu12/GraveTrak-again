# PhilSMS setup

The integration is implemented but disabled until backend credentials are configured.
No other provider SDK or dependency is required.

1. Create a PhilSMS account, confirm available credits, and obtain the API token
   and a sender ID authorized for your account. Do not assume `GraveTrak` is approved.
2. Set the following **backend process environment variables** using your deployment
   settings or the PowerShell terminal that launches Django:

   ```powershell
   $env:PHILSMS_ENABLED = '1'
   $env:PHILSMS_SENDER_ID = 'YOUR_APPROVED_SENDER'
   $env:PHILSMS_BASE_URL = 'https://dashboard.philsms.com/api/v3'
   $smsSecret = Read-Host 'PhilSMS API token' -AsSecureString
   $env:PHILSMS_API_TOKEN = [System.Net.NetworkCredential]::new('', $smsSecret).Password
   backend\venv\Scripts\python.exe backend\manage.py runserver
   ```

   Use your actual approved sender (at most 11 characters). The template above
   intentionally does not contain a real credential. Do not put credentials in
   frontend `.env`, source code, screenshots, or chat. `.env.sms.example` is a
   reference; Django does not automatically load `.env` files.
3. For legacy accounts, use `https://app.philsms.com/api/v3` if that is the API host
   specified in your account's developer documentation. Only these two official
   HTTPS hosts are accepted; redirects are blocked to protect the token.
4. In User Settings, save a valid Philippine mobile number and turn on **SMS
   Notifications**. Existing users default to off. Refresh settings after changing
   backend configuration.
5. Test one new interview or application update against your own test account and
   number. It uses real credits. Check the phone and the PhilSMS dashboard as well
   as Django admin's SMS outbox. Long/Unicode messages may cost multiple credits.

## Delivery behavior

- The existing application events prepare SMS and submit it **after the database
  transaction commits**. A failed SMS does not undo the in-app notification.
- `accepted` means the API accepted the request, **not confirmed handset delivery**.
  `sent_at` remains unset. Delivery receipts are not synchronized; check PhilSMS.
- Credentials alone do not validate your balance, sender approval, or network
  coverage. Provider errors are recorded without raw responses or secrets.
- `unknown` means timeout, network failure, or ambiguous response. Never blindly
  resend: the provider may already have accepted the SMS. `processing` can remain
  after a process crash; check the provider dashboard before taking action.
- Each event is atomically claimed once. There is no automatic retry of attempted
  messages because the documented API provides no idempotency guarantee.
- Historical records (`provider_not_configured`, invalid, opted out, etc.) are
  never replayed. Enabling SMS affects new events only. Recipient preference and
  saved number are checked again before submission.
- If a process stops before claiming a queued message, run
  `backend\venv\Scripts\python.exe backend\manage.py send_pending_sms` from the
  repository root. It handles at most 100 eligible pending entries per invocation.
  It never retries `unknown`, `failed`, `processing`, or `accepted` records.
- Requests have a 10-second socket timeout and run after commit in the web process.
  For higher traffic, move dispatch to a dedicated worker with the same claim rules.
- Disable new submissions by setting `PHILSMS_ENABLED=0` and restarting Django.

Contract reference: https://app.philsms.com/developers/documentation
The newer dashboard documentation may require account login; verify the API host
in that account before enabling. Automated tests mock HTTP; live delivery still
requires credentials, credits, an authorized sender, and an actual recipient test.
