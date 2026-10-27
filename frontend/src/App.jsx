import { Component, Suspense, lazy, useEffect, useState } from 'react';
import PWAInstallPrompt from './components/shared/PWAInstallPrompt.jsx';
import OfflineBanner from './components/shared/OfflineBanner.jsx';
import { normalizeAppRole, roleInfo } from './data/data.js';
import { getProfile, login as apiLogin, logout as apiLogout, register as apiRegister } from './api.js';
import useAccountPreferences from './hooks/useAccountPreferences.js';

const AuthScreen = lazy(() => import('./components/AuthScreen.jsx'));
const PublicMapPage = lazy(() => import('./pages/PublicMapPage.jsx'));
const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard.jsx'));

const PRESET_CREDENTIALS = {
  user: { email: 'user@lgu.gov.ph', password: 'userpass' },
  admin: { email: 'admin@lgu.gov.ph', password: 'adminpass' },
  mayor: { email: 'mayor@lgu.gov.ph', password: 'mayorpass' },
  planning: { email: 'planner@lgu.gov.ph', password: 'planningpass' },
};

const screenForPath = (path) => ({ '/map': 'public', '/apply': 'public', '/login': 'auth', '/admin': 'app' }[path.split('?')[0]] || 'landing');

class PublicMapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Public map crashed:', error);
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="screen active" id="screen-public-map-error" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: 'var(--bg-surface)', color: 'var(--text-primary)', padding: 24 }}>
          <div style={{ width: 'min(440px, 100%)', padding: 20, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Map temporarily unavailable</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
              The map hit a rendering error, but the rest of GraveTrak is still running.
            </div>
            <button className="btn btn-primary" onClick={() => this.setState({ hasError: false })}>Reload Map</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState(() => screenForPath(window.location.pathname));
  const [routePath, setRoutePath] = useState(window.location.pathname);
  const [routeSearch, setRouteSearch] = useState(window.location.search);
  const [role, setRole] = useState('');
  const [selectedGrave, setSelectedGrave] = useState(null);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const appearance = useAccountPreferences(user, setUser);
  const { theme, toggleTheme } = appearance;
  const [isCheckingSession, setIsCheckingSession] = useState(!!(localStorage.getItem('authToken') || localStorage.getItem('token')));

  const navigate = (path, { replace = false } = {}) => {
    const target = screenForPath(path);
    if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setActiveScreen(target);
    setRoutePath(path.split('?')[0]);
    setRouteSearch(new URL(path, window.location.origin).search);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  useEffect(() => {
    const handlePopState = () => { setActiveScreen(screenForPath(window.location.pathname)); setRoutePath(window.location.pathname); setRouteSearch(window.location.search); };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (isCheckingSession) return;
    if (routePath === '/apply') {
      if (!user) navigate('/login?next=apply', { replace: true });
      else if (role !== 'user') navigate('/admin', { replace: true });
      return;
    }
    if (activeScreen !== 'app') return;
    if (!user) {
      navigate('/login', { replace: true });
    } else if (role === 'user') {
      navigate('/map', { replace: true });
    }
  }, [activeScreen, routePath, isCheckingSession, role, user]);

  useEffect(() => {
    const token = localStorage.getItem('authToken') || localStorage.getItem('token');
    if (!token) {
      setIsCheckingSession(false);
      return;
    }
    getProfile()
      .then((data) => {
        const nextRole = normalizeAppRole(data.role || 'user');
        setUser(data);
        setRole(nextRole);
        setIsCheckingSession(false);
      })
      .catch(() => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('token');
        setUser(null);
        setRole('');
        setIsCheckingSession(false);
      });
  }, []);

  const setSession = (session) => {
    const nextUser = session.user || {};
    const nextRole = normalizeAppRole(nextUser.role || 'user');
    localStorage.setItem('authToken', session.token);
    localStorage.setItem('token', session.token);
    setUser({ ...nextUser, role: nextRole });
    setRole(nextRole);
    setSelectedGrave(null);
    navigate(nextRole === 'user' ? (new URLSearchParams(window.location.search).get('next') === 'apply' ? '/apply' : '/map') : '/admin', { replace: true });
    setAuthError('');
  };

  const loginAs = async (roleOrSession) => {
    // If the argument is an object with a token, it's a session from a successful manual login.
    if (typeof roleOrSession === 'object' && roleOrSession !== null && roleOrSession.token) {
      setSession(roleOrSession);
      return;
    }

    // Otherwise, it's a role string from a "Quick Demo" button.
    const nextRole = roleOrSession;
    const credentials = PRESET_CREDENTIALS[nextRole];
    if (!credentials) return;
    try {
      const result = await apiLogin(credentials.email, credentials.password);
      setSession(result);
    } catch (error) {
      setAuthError(error.message);
      navigate('/login');
    }
  };

  const handleLogin = async ({ email, password }) => {
    try {
      const result = await apiLogin(email, password);
      setSession(result);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleRegister = async (payload) => {
    try {
      const result = await apiRegister(payload);
      setSession(result);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (_) {
      // ignore logout errors
    }
    localStorage.removeItem('authToken');
      localStorage.removeItem('token');
    setRole('');
    setUser(null);
    setSelectedGrave(null);
    navigate('/login', { replace: true });
  };

  const showAuth = () => navigate('/login');
  const showLanding = () => navigate('/');

  const baseRoleInfo = roleInfo[role] || roleInfo.user || {};
  const currentRoleInfo = { ...baseRoleInfo };

  if (user) {
    const firstName = user.first_name || '';
    const lastName = user.last_name || '';
    if (firstName || lastName) {
      currentRoleInfo.name = `${firstName} ${lastName}`.trim();
      currentRoleInfo.av = `${firstName.charAt(0) || ''}${lastName.charAt(0) || ''}`.toUpperCase() || baseRoleInfo.av;
    } else if (user.name) {
      currentRoleInfo.name = user.name;
    } else if (user.email) {
      currentRoleInfo.name = user.email.split('@')[0];
    }
    currentRoleInfo.email = user.email;
    currentRoleInfo.contact_number = user.contact_number;
    currentRoleInfo.id = user.id;
  }

  if (isCheckingSession) {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-surface)', zIndex: 999999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@keyframes appSpin { 100% { transform: rotate(360deg); } }`}</style>
        <div style={{ width: 50, height: 50, border: '4px solid rgba(25, 135, 101, 0.15)', borderLeftColor: 'var(--accent)', borderRadius: '50%', animation: 'appSpin 1s linear infinite' }}></div>
        <div style={{ marginTop: 24, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '1px' }}>Loading GraveTrak...</div>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>Verifying your session</div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        /* Keep native dropdown menus readable and aligned with GraveTrak's palette. */
        [data-theme='dark'] option {
          background-color: #1A503C !important;
          color: #E9F4EF !important;
        }
        [data-theme='light'] option {
          background-color: #ffffff !important;
          color: #173F32 !important;
        }
        [data-theme='dark'] .field-input, [data-theme='dark'] .admin-select {
          color: #E9F4EF !important;
          color-scheme: dark !important;
        }
        [data-theme='light'] .field-input, [data-theme='light'] .admin-select {
          color: #173F32 !important;
          color-scheme: light !important;
        }
      `}</style>

      <Suspense fallback={(
        <div className="app-route-loading" role="status" aria-live="polite">
          <span className="app-route-loading-spinner" />
          <span>Opening GraveTrak…</span>
        </div>
      )}>
        {activeScreen === 'landing' && <LandingPage onNavigate={navigate} signedIn={Boolean(user)} role={role} />}

        {activeScreen === 'auth' && (
          <AuthScreen
            active
            onBack={showLanding}
            onLogin={handleLogin}
            onRegister={handleRegister}
            onLoginAs={loginAs}
            error={authError}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        )}

        {activeScreen === 'public' && (
          <PublicMapErrorBoundary resetKey={`${activeScreen}-${role}-${selectedGrave?.id || selectedGrave?.grave_id || ''}`}>
            <PublicMapPage
              active
              openApplication={routePath === '/apply'}
              initialCemetery={new URLSearchParams(routeSearch).get('cemetery') === 'new' ? 'new' : 'old'}
              initialSearch={new URLSearchParams(routeSearch).get('search') || ''}
              role={role}
              userInfo={currentRoleInfo}
              account={user}
              onAccountUpdate={updated => setUser(current => current?.id === updated.id ? { ...current, ...updated } : current)}
              appearance={appearance}
              signedIn={Boolean(user)}
              onShowOfficeDashboard={() => navigate('/admin')}
              onShowAuth={showAuth}
              onLogout={logout}
              selectedGrave={selectedGrave}
              onSelectGrave={setSelectedGrave}
              onShowLanding={showLanding}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          </PublicMapErrorBoundary>
        )}

        {activeScreen === 'app' && user && (
          <AdminDashboard
            active
            onShowLanding={showLanding}
            role={role}
            roleInfo={currentRoleInfo}
            onLogout={logout}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        )}
      </Suspense>

      <PWAInstallPrompt />
      <OfflineBanner />
    </>
  );
}
