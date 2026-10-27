import { useEffect, useRef, useState } from 'react';
import { confirmEmailVerification, requestEmailVerification } from '../api.js';

export default function EmailVerificationPanel({ profile, onVerified, onStateChange }) {
  const [state, setState] = useState(profile.email_verification || {});
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const active = useRef(true);
  const inFlight = useRef(false);
  const codeInput = useRef(null);
  useEffect(() => {
    active.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { active.current = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { setState(profile.email_verification || {}); }, [profile.email_verification]);

  const applyState = next => { setState(next); onStateChange(next); };
  const handleFailure = failure => {
    if (failure.data?.email_verification) applyState(failure.data.email_verification);
    setError(failure.data?.detail || failure.data?.code?.[0] || 'Unable to complete verification. Please try again.');
  };
  const sendCode = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(''); setFeedback(''); setCode('');
    try {
      const result = await requestEmailVerification();
      if (!active.current) return;
      applyState(result.email_verification);
      setFeedback(result.detail);
      window.setTimeout(() => codeInput.current?.focus(), 0);
    } catch (failure) { if (active.current) handleFailure(failure); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const confirmCode = async event => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!/^[0-9]{6}$/.test(code)) { setError('Enter the 6-digit code from your email.'); return; }
    inFlight.current = true;
    setBusy(true); setError(''); setFeedback('');
    try {
      const result = await confirmEmailVerification(code);
      if (!active.current) return;
      setState(result.user.email_verification); setCode(''); setFeedback(result.detail);
      onVerified(result.user);
    } catch (failure) { if (active.current) handleFailure(failure); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const seconds = Math.max(0, Math.ceil((Date.parse(state.resend_available_at || '') - now) / 1000) || 0);
  const pending = state.code_pending && Date.parse(state.expires_at) > now;
  const dailyLimit = state.remaining_requests === 0 && seconds > 0;
  const available = profile.notification_channels?.email_available;

  return <div className="settings-email-verification">
    <span className={`settings-email-badge${state.verified ? ' is-verified' : ''}`}>
      {state.verified ? '✓ Verified' : 'Not verified'}
    </span>
    {state.verified ? <p>Your email is verified. Application emails follow your notification preference.</p> : <>
      <p>Verify this address to receive application emails. Your updates will still appear inside GraveTrak.</p>
      {pending && <form onSubmit={confirmCode} className="settings-verification-form" noValidate>
        <div className="settings-field">
          <label htmlFor="email-verification-code">Verification code</label>
          <input ref={codeInput} id="email-verification-code" className="field-input" type="text"
            inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy}
            aria-describedby="email-verification-hint" aria-invalid={Boolean(error)}
            onChange={event => { setCode(event.target.value.replace(/[^0-9]/g, '')); setError(''); }} />
          <small id="email-verification-hint">Enter the latest 6-digit code. Expires at {new Date(state.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</small>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>Verify email</button>
      </form>}
      <button type="button" className="btn btn-ghost settings-outline settings-send-code"
        disabled={busy || seconds > 0 || !available} onClick={sendCode}>
        {busy ? 'Please wait…' : dailyLimit ? 'Daily limit reached' : seconds > 0 ? `Resend in ${seconds}s` : pending ? 'Resend code' : 'Send verification code'}
      </button>
      {!available ? <p>Email verification is temporarily unavailable. Please try again later.</p>
        : dailyLimit ? <p>You can request another code after {new Date(state.resend_available_at).toLocaleString()}.</p>
        : <p className="settings-verification-limit">Up to 5 requests per 24 hours. Check Spam before resending.</p>}
    </>}
    {feedback && <p className="settings-feedback" role="status">{feedback}</p>}
    {error && <p className="settings-field-error" role="alert">{error}</p>}
  </div>;
}
