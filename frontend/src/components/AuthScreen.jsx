import graveTrakLogo from '../assets/gravetrak-logo.svg';
import { useEffect, useState } from 'react';
import { login as apiLogin, register as apiRegister } from '../api.js';

export default function AuthScreen({ active, onBack, onLoginAs, error, theme, onToggleTheme }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('Juan');
  const [lastName, setLastName] = useState('Dela Cruz');
  const [middleInitial, setMiddleInitial] = useState('');
  const [suffix, setSuffix] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [localError, setLocalError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const screen = document.getElementById('screen-auth');
    const viewport = window.visualViewport;
    if (!screen || !viewport) return undefined;
    const syncVisualViewport = () => {
      screen.style.setProperty('--auth-visual-height', `${viewport.height}px`);
      screen.style.setProperty('--auth-visual-top', `${viewport.offsetTop}px`);
      const focused = screen.contains(document.activeElement) ? document.activeElement : null;
      if (focused && window.matchMedia('(max-width: 820px)').matches) {
        window.setTimeout(() => focused.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 80);
      }
    };
    viewport.addEventListener('resize', syncVisualViewport);
    viewport.addEventListener('scroll', syncVisualViewport);
    syncVisualViewport();
    return () => {
      viewport.removeEventListener('resize', syncVisualViewport);
      viewport.removeEventListener('scroll', syncVisualViewport);
      screen.style.removeProperty('--auth-visual-height');
      screen.style.removeProperty('--auth-visual-top');
    };
  }, []);

  const keepFocusedFieldVisible = event => {
    if (!window.matchMedia('(max-width: 820px)').matches) return;
    const field = event.target;
    if (!field.matches('input, button')) return;
    window.setTimeout(() => field.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 220);
  };

  const toggleRegister = () => {
    setIsRegister((current) => !current);
    setLocalError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError('');
    setIsAuthenticating(true);
    try {
      const data = await apiLogin(email, password);
      if (!data || !data.token) {
        throw new Error('Login failed. Please check your credentials.');
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      await new Promise(resolve => setTimeout(resolve, 1200));
      await onLoginAs(data);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleRegister = async () => {
    setLocalError('');
    setIsAuthenticating(true);
    try {
      const finalFirstName = `${firstName.trim()} ${middleInitial.trim()}`.trim();
      const finalLastName = `${lastName.trim()} ${suffix.trim()}`.trim();

      const data = await apiRegister({ email, password, first_name: finalFirstName, last_name: finalLastName, contact_number: contactNumber });
      if (!data || !data.token) {
        throw new Error('Registration failed. Please check your details.');
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      await new Promise(resolve => setTimeout(resolve, 1200));
      await onLoginAs(data);
    } catch (err) {
      setLocalError(err.message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const displayError = localError || error;

  return (
    <div className={`screen ${active ? 'active' : ''}`} id="screen-auth" onFocusCapture={keepFocusedFieldVisible}>
      <style>{`
        .auth-splash-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(18, 51, 93, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          z-index: 99999;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.4s ease, visibility 0.4s ease;
        }
        .auth-splash-overlay.visible {
          opacity: 1;
          visibility: visible;
        }
        @keyframes authSpin { 100% { transform: rotate(360deg); } }
        .auth-spinner-anim { animation: authSpin 1s linear infinite; }
      `}</style>
      <div className={`auth-splash-overlay ${isAuthenticating ? 'visible' : ''}`}>
        <div className="auth-spinner-anim" style={{ width: 50, height: 50, border: '4px solid rgba(22, 135, 201, 0.15)', borderLeftColor: 'var(--accent)', borderRadius: '50%' }}></div>
        <div style={{ marginTop: 24, fontSize: 18, fontWeight: 700, color: '#ffffff', letterSpacing: '1px' }}>Authenticating...</div>
        <div style={{ marginTop: 8, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Securing your connection to GraveTrak</div>
      </div>
      <div className="auth-bg" />
      <div className="auth-grid" />
      <div className="auth-card-wrap">
        <div className="auth-card" id="auth-card">
          <div className="auth-brand">
            <div className="auth-brand-icon">
              <img src={graveTrakLogo} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <button type="button" className="brand-name" onClick={onBack} aria-label="GraveTrak homepage" title="Visit homepage" style={{ background: 'transparent', border: 0, padding: 0, fontFamily: 'inherit', textAlign: 'center', cursor: 'pointer' }}>GraveTrak</button>
              <div className="brand-sub">Gov. Cemetery GIS · v2.0</div>
            </div>
            <button 
              className="btn btn-ghost btn-sm theme-toggle" 
              onClick={onToggleTheme}
              type="button" 
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>

          {displayError ? <div className="auth-error">{displayError}</div> : null}

          {!isRegister ? (
            <form onSubmit={handleSubmit}>
              <button className="btn btn-ghost btn-sm auth-back-btn" onClick={onBack} type="button" aria-label="Back to home">
                ←
              </button>
              <div className="auth-heading">Sign in to your account</div>
              <div className="auth-sub">Access the cemetery management system</div>
              <div className="field">
                <label className="field-label">Username</label>
                <input
                  className="field-input"
                  type="text"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your username"
                />
              </div>
              <div className="field">
                <label className="field-label">Password</label>
                <input
                  className="field-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="field-row">
                <label className="field-check">
                  <input type="checkbox" defaultChecked /> Keep me signed in
                </label>
                <a href="#" className="link" style={{ fontSize: 13 }}>
                  Forgot password?
                </a>
              </div>
          <button className="btn-auth" type="submit" disabled={isAuthenticating}>
                Sign In
              </button>
              <div className="auth-switch">
                New user? <span className="link" onClick={toggleRegister}>Create account</span>
              </div>
            </form>
          ) : (
            <div>
              <button className="btn btn-ghost btn-sm auth-back-btn" onClick={onBack} type="button" aria-label="Back to home">
                ←
              </button>
              <div className="auth-heading">Create Account</div>
              <div className="auth-sub">Register for public access</div>
              <form className="auth-register-form" onSubmit={event => { event.preventDefault(); handleRegister(); }}>
              <div className="grid-2">
                <div className="field">
                  <label className="field-label">First Name</label>
                  <input
                    className="field-input"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder="Juan"
                  />
                </div>
                <div className="field">
                  <label className="field-label">Last Name</label>
                  <input
                    className="field-input"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder="Dela Cruz"
                  />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label className="field-label">Middle Initial (Optional)</label>
                  <input
                    className="field-input"
                    maxLength="5"
                    value={middleInitial}
                    onChange={(event) => setMiddleInitial(event.target.value)}
                    placeholder="M.I."
                  />
                </div>
                <div className="field">
                  <label className="field-label">Suffix (Optional)</label>
                  <input
                    className="field-input"
                    value={suffix}
                    onChange={(event) => setSuffix(event.target.value)}
                    placeholder="e.g. Jr., Sr."
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Contact Number</label>
                <input
                  className="field-input"
                  type="tel"
                  value={contactNumber}
                  onChange={(event) => setContactNumber(event.target.value)}
                  placeholder="09XX XXX XXXX"
                />
              </div>
              <div className="field">
                <label className="field-label">Email</label>
                <input
                  className="field-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="juan@email.com"
                />
              </div>
              <div className="field">
                <label className="field-label">Password</label>
                <input
                  className="field-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Min. 8 characters"
                />
              </div>
          <button className="btn-auth" type="submit" disabled={isAuthenticating}>
                Create Account
              </button>
              <div className="auth-switch">
                Already have an account? <span className="link" onClick={toggleRegister}>Sign in</span>
              </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
