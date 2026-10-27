import { useEffect, useRef, useState } from 'react';
import { changePassword, getProfile, updateOwnProfile } from '../api.js';
import Modal from './shared/Modal.jsx';
import EmailVerificationPanel from './EmailVerificationPanel.jsx';
import './UserSettings.css';

const message = value => Array.isArray(value) ? value.join(' ') : value || '';
const profileDraft = user => ({ first_name: user.first_name || '', last_name: user.last_name || '', email: user.email || '', contact_number: user.contact_number || '' });
const mobileIsValid = value => /^(?:09\d{9}|9\d{9}|\+?639\d{9})$/.test(value.replace(/[\s()\-]/g, ''));

function Section({ id, title, subtitle, children, action }) {
  return <section className="settings-card" aria-labelledby={`settings-${id}`}>
    <div className="settings-card-heading"><div><h2 id={`settings-${id}`}>{title}</h2><p>{subtitle}</p></div>{action}</div>
    {children}
  </section>;
}

function Switch({ id, title, description, checked, disabled, onChange }) {
  return <div className="settings-row">
    <div><label id={`${id}-label`} htmlFor={id}>{title}</label><p id={`${id}-description`}>{description}</p></div>
    <button id={id} type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} className="settings-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="settings-switch-track" aria-hidden="true"><span /></span><span aria-hidden="true">{checked ? 'On' : 'Off'}</span>
    </button>
  </div>;
}

function Field({ id, label, value, error, hint, onChange, ...props }) {
  return <div className="settings-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="field-input" value={value} onChange={event => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...props} />
    {hint && <small id={`${id}-hint`}>{hint}</small>}
    {error && <span id={`${id}-error`} className="settings-field-error" role="alert">{message(error)}</span>}
  </div>;
}

export default function UserSettings({ accountId, onAccountUpdate, appearance, onLogout }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState('');
  const [savedSection, setSavedSection] = useState('');
  const profileForm = useRef(null);
  const updateAccount = useRef(onAccountUpdate);
  updateAccount.current = onAccountUpdate;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    getProfile().then(result => {
      if (cancelled) return;
      setProfile(result);
      setDraft(profileDraft(result));
      updateAccount.current(result);
    }).catch(() => { if (!cancelled) setLoadError('Unable to load your settings. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, reload]);

  useEffect(() => {
    if (editing) profileForm.current?.querySelector('input')?.focus();
  }, [editing]);

  useEffect(() => {
    const screen = document.getElementById('screen-public');
    const viewport = window.visualViewport;
    if (!screen || !viewport) return undefined;
    screen.classList.add('user-settings-responsive');
    const keepActiveFieldVisible = event => {
      if (!window.matchMedia('(max-width: 820px)').matches) return;
      const field = event.target;
      if (!field?.matches?.('input, button, select, textarea')) return;
      window.setTimeout(() => field.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 120);
    };
    const syncVisualViewport = () => {
      screen.style.setProperty('--user-settings-visual-height', `${viewport.height}px`);
      screen.style.setProperty('--user-settings-visual-top', `${viewport.offsetTop}px`);
      keepActiveFieldVisible({ target: document.activeElement });
    };
    screen.addEventListener('focusin', keepActiveFieldVisible);
    viewport.addEventListener('resize', syncVisualViewport);
    viewport.addEventListener('scroll', syncVisualViewport);
    syncVisualViewport();
    return () => {
      screen.removeEventListener('focusin', keepActiveFieldVisible);
      viewport.removeEventListener('resize', syncVisualViewport);
      viewport.removeEventListener('scroll', syncVisualViewport);
      screen.classList.remove('user-settings-responsive');
      screen.style.removeProperty('--user-settings-visual-height');
      screen.style.removeProperty('--user-settings-visual-top');
    };
  }, []);

  const saveProfile = async event => {
    event.preventDefault();
    if (profileBusy) return;
    const payload = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]));
    const problems = {};
    if (!`${payload.first_name}${payload.last_name}`.trim()) problems.first_name = 'Full name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) problems.email = 'Enter a valid email address.';
    if (!mobileIsValid(payload.contact_number)) problems.contact_number = 'Enter a valid Philippine mobile number.';
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setProfileBusy(true);
    setProfileFeedback('');
    try {
      const result = await updateOwnProfile(payload);
      setProfile(result);
      setDraft(profileDraft(result));
      onAccountUpdate(result);
      setEditing(false);
      setProfileFeedback('Profile updated.');
    } catch (error) {
      setErrors(error.data && !error.data.detail ? error.data : { form: 'Unable to update your profile. Please try again.' });
    } finally { setProfileBusy(false); }
  };

  const savePassword = async event => {
    event.preventDefault();
    if (passwordBusy) return;
    const problems = {};
    if (!passwords.current_password) problems.current_password = 'Enter your current password.';
    if (passwords.new_password.length < 8) problems.new_password = 'Use at least 8 characters.';
    if (passwords.new_password !== passwords.confirm_password) problems.confirm_password = 'New passwords do not match.';
    setPasswordErrors(problems);
    if (Object.keys(problems).length) return;
    setPasswordBusy(true);
    try {
      await changePassword(passwords);
      setPasswordOpen(false);
      setPasswords({ current_password: '', new_password: '', confirm_password: '' });
      setPasswordFeedback('Password updated. This device remains signed in.');
    } catch (error) {
      setPasswordErrors(error.data && !error.data.detail ? error.data : { form: 'Unable to update your password. Please try again.' });
    } finally { setPasswordBusy(false); }
  };

  const savePreference = async (patch, section) => {
    setSavedSection('');
    try { await appearance.savePreferences(patch); setSavedSection(section); }
    catch { /* The shared preference error is visible below; optimistic changes are restored. */ }
  };
  const closePassword = () => {
    if (passwordBusy) return;
    setPasswordOpen(false);
    setPasswords({ current_password: '', new_password: '', confirm_password: '' });
    setPasswordErrors({});
  };

  if (loading) return <div className="user-settings settings-loading" role="status" aria-live="polite"><span className="settings-loading-dot" />Loading your settings…</div>;
  if (loadError) return <div className="user-settings settings-card"><p role="alert">{loadError}</p><button className="btn btn-primary" onClick={() => setReload(value => value + 1)}>Try again</button></div>;
  if (!profile) return null;
  const prefs = appearance.preferences;
  const channels = profile.notification_channels || {};
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');

  return <div className="user-settings">
    <Section id="profile" title="Profile" subtitle="Keep your contact details up to date." action={!editing && <button className="btn btn-ghost settings-outline" onClick={() => { setDraft(profileDraft(profile)); setErrors({}); setProfileFeedback(''); setEditing(true); }}>Edit Profile</button>}>
      {!editing ? <>
        <dl className="settings-profile-grid">
          <div><dt>Full Name</dt><dd>{fullName || 'Not provided'}</dd></div>
          <div><dt>Contact Number</dt><dd>{profile.contact_number || 'Not provided'}</dd></div>
          <div className="settings-wide"><dt>Email Address</dt><dd>{profile.email}</dd></div>
        </dl>
        <EmailVerificationPanel key={`${profile.id}:${profile.email}`} profile={profile}
          onVerified={result => { setProfile(result); onAccountUpdate(result); }}
          onStateChange={email_verification => setProfile(current => ({ ...current, email_verification }))} />
        <div className="settings-feedback" role="status">{profileFeedback}</div>
      </> : <form onSubmit={saveProfile} ref={profileForm} noValidate>
        <div className="settings-form-grid">
          {[
            ['first_name', 'First Name / Middle Initial', 'text', 'given-name', 150],
            ['last_name', 'Last Name / Suffix', 'text', 'family-name', 150],
            ['email', 'Email Address', 'email', 'email', 150],
            ['contact_number', 'Contact Number', 'tel', 'tel-national', 30],
          ].map(([key, label, type, autoComplete, maxLength]) => <Field key={key} id={`profile-${key}`} label={label} type={type} autoComplete={autoComplete} maxLength={maxLength} value={draft[key]} error={errors[key]} disabled={profileBusy} hint={key === 'email' ? 'Use this email address the next time you sign in.' : key === 'contact_number' ? 'Philippine mobile number (09, 9, or +63 format).' : undefined} onChange={value => { setDraft(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: '' })); }} />)}
        </div>
        {errors.form && <p className="settings-field-error" role="alert">{message(errors.form)}</p>}
        <div className="settings-actions"><button className="btn btn-ghost" type="button" disabled={profileBusy} onClick={() => { setDraft(profileDraft(profile)); setEditing(false); setErrors({}); }}>Cancel</button><button className="btn btn-primary" disabled={profileBusy} type="submit">{profileBusy ? 'Saving…' : 'Save Profile'}</button></div>
      </form>}
    </Section>

    <Section id="security" title="Security" subtitle="Protect access to your account.">
      <div className="settings-row"><div><strong>Password</strong><p className="settings-password-mask" aria-label="Password is hidden">••••••••••••</p></div><button className="btn btn-ghost settings-outline" onClick={() => { setPasswordFeedback(''); setPasswordOpen(true); }}>Change Password</button></div>
      {profile.last_login && <div className="settings-last-login"><span>Last login</span><time dateTime={profile.last_login}>{new Date(profile.last_login).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</time></div>}
      <div role="status" className="settings-feedback">{passwordFeedback}</div>
    </Section>

    <Section id="notifications" title="Notifications" subtitle="Choose your optional delivery preferences.">
      <div className="settings-info"><span className="settings-info-icon" aria-hidden="true">✓</span><div><strong>Application notifications stay on</strong><p>Important burial application updates will always appear inside GraveTrak.</p></div></div>
      <Switch id="settings-email" title="Email Notifications" description={!profile.email_verification?.verified ? 'Verify your email in Profile first. Email updates are paused until verification is complete.' : channels.email_available ? 'Receive important updates through your verified email.' : 'Your preference is saved. Email delivery is temporarily unavailable.'} checked={prefs.email_notifications} disabled={appearance.busy} onChange={value => savePreference({ email_notifications: value }, 'notifications')} />
      <Switch id="settings-sms" title="SMS Notifications" description={channels.sms_available ? (channels.sms_destination ? `Receive important application updates at ${channels.sms_destination}.` : 'Add a valid contact number in Profile to receive SMS updates.') : 'SMS delivery is not configured yet.'} checked={prefs.sms_notifications} disabled={appearance.busy || (!channels.sms_available && !prefs.sms_notifications)} onChange={value => savePreference({ sms_notifications: value }, 'notifications')} />
      <Switch id="settings-announcements" title="Cemetery Announcements" description="Save your preference for future cemetery notices and public advisories." checked={prefs.cemetery_announcements} disabled={appearance.busy} onChange={value => savePreference({ cemetery_announcements: value }, 'notifications')} />
      <div className="settings-feedback" role="status">{appearance.busy ? 'Saving…' : savedSection === 'notifications' ? 'Saved' : 'Changes save automatically.'}</div>
    </Section>

    {appearance.error && <div className="settings-save-error" role="alert">{appearance.error}</div>}

    <Section id="appearance" title="Appearance & Accessibility" subtitle="Make GraveTrak comfortable to read and use.">
      <fieldset className="settings-options"><legend>Theme</legend><p>Choose a look, or follow your device’s appearance.</p><div className="settings-segments">{[['light', 'Light', '☀'], ['dark', 'Dark', '☾'], ['system', 'System Default', '◐']].map(([value, label, icon]) => <label key={value}><input type="radio" name="settings-theme" value={value} checked={prefs.theme === value} disabled={appearance.busy} onChange={() => savePreference({ theme: value }, 'appearance')} /><span><i aria-hidden="true">{icon}</i>{label}</span></label>)}</div></fieldset>
      <fieldset className="settings-options"><legend>Text Size</legend><p>Adjust interface text without changing your browser zoom.</p><div className="settings-segments settings-text-options">{[['standard', 'Standard'], ['medium', 'Medium'], ['large', 'Large']].map(([value, label]) => <label key={value}><input type="radio" name="settings-text-size" checked={prefs.text_size === value} disabled={appearance.busy} onChange={() => savePreference({ text_size: value }, 'appearance')} /><span>{label}</span></label>)}</div></fieldset>
      <Switch id="settings-contrast" title="High Contrast Mode" description="Stronger text and borders, with familiar status colors." checked={prefs.high_contrast} disabled={appearance.busy} onChange={value => savePreference({ high_contrast: value }, 'appearance')} />
      <div className="settings-preview"><span>Aa</span><div><strong>A clearer view</strong><p>Your appearance choices apply immediately.</p></div></div>
      <div className="settings-feedback" role="status">{appearance.busy ? 'Saving…' : savedSection === 'appearance' ? 'Saved' : 'Changes save automatically.'}</div>
    </Section>

    <Section id="account" title="Account" subtitle="Manage your session on this device."><div className="settings-row"><p>Sign out of GraveTrak on this device.</p><button className="btn settings-signout" onClick={onLogout}>Sign Out</button></div></Section>

    {passwordOpen && <Modal title="Change Password" onClose={closePassword} busy={passwordBusy} showCloseButton={false} className="settings-password-dialog" portalTarget={document.getElementById('screen-public')}>
      <p className="settings-password-help">Use at least 8 characters. Avoid common passwords, numbers only, or details from your profile.</p>
      <form onSubmit={savePassword} noValidate>
        {['current_password', 'new_password', 'confirm_password'].map((key, index) => <Field key={key} id={`security-${key}`} label={['Current Password', 'New Password', 'Confirm New Password'][index]} type="password" autoComplete={index ? 'new-password' : 'current-password'} maxLength={4096} value={passwords[key]} error={passwordErrors[key]} disabled={passwordBusy} onChange={value => { setPasswords(current => ({ ...current, [key]: value })); setPasswordErrors(current => ({ ...current, [key]: '' })); }} />)}
        {passwordErrors.form && <p className="settings-field-error" role="alert">{message(passwordErrors.form)}</p>}
        <div className="settings-actions"><button type="button" className="btn btn-ghost" disabled={passwordBusy} onClick={closePassword}>Cancel</button><button type="submit" className="btn btn-primary" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update Password'}</button></div>
      </form>
    </Modal>}
  </div>;
}
