"""PhilSMS transport. Never log credentials, message bodies, or raw responses."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from django.conf import settings


def sms_available():
    return bool(settings.PHILSMS_ENABLED and settings.PHILSMS_API_TOKEN.strip()
                and settings.PHILSMS_SENDER_ID.strip()
                and len(settings.PHILSMS_SENDER_ID.strip()) <= 11
                and settings.PHILSMS_BASE_URL in (
                    'https://dashboard.philsms.com/api/v3',
                    'https://app.philsms.com/api/v3'))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PhilSmsProvider:
    def send(self, *, recipient, message, idempotency_key):
        # PhilSMS documents no idempotency parameter. The outbox claims each
        # event once, and never automatically retries an ambiguous request.
        if not sms_available():
            return 'failed', '', 'PhilSMS is not configured.'
        payload = json.dumps({'recipient': recipient.lstrip('+'),
                              'sender_id': settings.PHILSMS_SENDER_ID.strip(),
                              'type': 'plain' if message.isascii() else 'unicode',
                              'message': message}).encode('utf-8')
        request = Request(settings.PHILSMS_BASE_URL + '/sms/send', data=payload,
                          headers={'Authorization': 'Bearer ' + settings.PHILSMS_API_TOKEN.strip(),
                                   'Accept': 'application/json', 'Content-Type': 'application/json'},
                          method='POST')
        try:
            with build_opener(NoRedirect()).open(request, timeout=10) as response:
                result = json.loads(response.read(1024 * 1024))
        except HTTPError as exc:
            status = 'failed' if 400 <= exc.code < 500 and exc.code != 408 else 'unknown'
            return status, '', f'PhilSMS HTTP {exc.code}. Check the provider dashboard before retrying.'
        except (URLError, TimeoutError, OSError, ValueError):
            return 'unknown', '', 'Delivery outcome is unknown. Check the PhilSMS dashboard; no automatic retry.'
        if not isinstance(result, dict) or result.get('status') not in ('success', 'error'):
            return 'unknown', '', 'Unrecognized PhilSMS response. Check the provider dashboard.'
        if result['status'] == 'error':
            return 'failed', '', 'PhilSMS rejected the request. Check credits, sender ID, and account restrictions.'
        data = result.get('data', {})
        if isinstance(data, list):
            data = data[0] if data else {}
        uid = str(data.get('uid', '') or '')[:255] if isinstance(data, dict) else ''
        return 'accepted', uid, ''
