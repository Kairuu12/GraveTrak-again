import graveTrakLogo from '../assets/gravetrak-logo.svg';
import { navConfigs, normalizeAppRole, roleInfo } from '../data/data.js';

export default function Sidebar({ role = 'user', userInfo, isOpen, isMobile = false, activePanel, onSelectPanel, onClose, onLogout, onShowLanding }) {
  const appRole = normalizeAppRole(role);
  const baseItems = navConfigs[appRole] || navConfigs.user || [];
  let navItems = baseItems;
  if (appRole === 'user') {
    const userItems = isMobile ? baseItems.filter(item => item.id !== 'settings') : baseItems;
    const mid = Math.ceil(userItems.length / 2);
    navItems = [
      ...userItems.slice(0, mid),
      { id: 'map', label: 'Map', ico: '🗺️', panel: null },
      ...userItems.slice(mid)
    ];
  }
  const info = userInfo || roleInfo[appRole] || roleInfo.user;

  const getIcon = (id, panel) => {
    if (id === 'loved-ones') return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>;
    const defaultProps = { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" };
    if (id === 'map') return <svg {...defaultProps}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>;
    if (panel === 'panel-burial-application') return <svg {...defaultProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>;
    if (panel === 'panel-application-tracking') return <svg {...defaultProps}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>;
    if (panel === 'panel-settings') return <svg {...defaultProps}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
    
    if (id === 'columbarium') return <svg {...defaultProps}><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="2"></line><line x1="15" y1="22" x2="15" y2="2"></line><line x1="4" y1="10" x2="20" y2="10"></line><line x1="4" y1="16" x2="20" y2="16"></line></svg>;
    if (id === 'columbarium-records') return <svg {...defaultProps}><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="2"></line><line x1="15" y1="22" x2="15" y2="2"></line><line x1="4" y1="10" x2="20" y2="10"></line><line x1="4" y1="16" x2="20" y2="16"></line></svg>;
    if (id === 'approvals') return <svg {...defaultProps}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>;
    if (id === 'mayor-dash') return <svg {...defaultProps}><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>;
    if (id === 'planning') return <svg {...defaultProps}><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>;
    if (id === 'transfer-plot' || panel === 'panel-transfer-plot') return <svg {...defaultProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;
    if (id === 'user-dash') return <svg {...defaultProps}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>;
    if (id === 'users') return <svg {...defaultProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>;
    return null;
  };

  return (
    <div className={`pub-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="pub-sidebar-head">
        <div className="pub-sidebar-brand">
          <div className="topbar-icon" style={{ width: 28, height: 28, borderRadius: 7 }}>
            <img src={graveTrakLogo} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <button type="button" onClick={onShowLanding} aria-label="GraveTrak homepage" title="Visit homepage" style={{ fontFamily: 'inherit', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}>GraveTrak</button>
        </div>
        {isMobile ? <div className="close-sidebar" onClick={onClose}>✕</div> : null}
      </div>
    <div className="sidebar-scroll" style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
      {navItems.map((item) => {
        const isActive = activePanel === item.panel;
        return (
          <div
            key={item.id}
            className={`pub-nav-item ${isActive ? 'active' : ''} ${item.id === 'map' ? 'map-nav-item' : ''}`}
            onClick={() => onSelectPanel?.(item.panel)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '13px 16px',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: isActive ? 700 : 600,
              background: isActive ? 'var(--accent)' : 'transparent',
              color: isActive ? '#fff' : 'var(--text-secondary)',
              boxShadow: isActive ? '0 6px 16px rgba(25, 135, 101, 0.35)' : 'none',
              border: isActive ? '1px solid transparent' : '1px solid transparent',
              transition: 'all 0.2s ease',
              userSelect: 'none',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.border = '1px solid var(--border)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.border = '1px solid transparent';
              }
            }}
          >
            <div className="nav-content-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
              <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {getIcon(item.id, item.panel) || <span style={{ fontSize: '20px' }}>{item.ico || '📍'}</span>}
              </span>
              <span className="nav-label" title={item.label} style={{ letterSpacing: '0.2px' }}>{isMobile && item.id === 'loved-ones' ? 'Saved' : item.label}</span>
            </div>
            {item.badge ? <span className="nav-badge" style={{ position: 'absolute', right: '16px', background: isActive ? '#fff' : 'var(--accent)', color: isActive ? 'var(--accent)' : '#fff', fontSize: '10px', padding: '3px 7px', borderRadius: '10px', fontWeight: 800 }}>{item.badge}</span> : null}
          </div>
        );
      })}
      </div>
      <div className="pub-sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="avatar">{info.av}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{info.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{info.role}</div>
          </div>
          <button type="button" className="btn-icon" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={onLogout} title="Sign out" aria-label="Sign out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
