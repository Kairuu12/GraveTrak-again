import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom'; // Import createPortal

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function CustomDatePicker({ value, onChange, placeholder = "Select date", maxDate, minDate, invalid = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(value && !isNaN(new Date(value).getTime()) ? new Date(value) : new Date());
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (value && !isNaN(new Date(value).getTime())) {
      setViewDate(new Date(value));
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && containerRef.current.contains(e.target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    
    const handleScroll = (e) => {
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      if (isOpen) setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  const openDropdown = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width
      });
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const handleSelectDate = (day) => {
    if (!day) return;
    const newDate = new Date(year, month, day);
    const formatted = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
    onChange({ target: { value: formatted }});
    setIsOpen(false);
  };

  let displayValue = '';
  if (value) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      displayValue = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }

  const maxD = maxDate === 'today' ? new Date() : (maxDate ? new Date(maxDate) : null);
  if (maxD) maxD.setHours(23, 59, 59, 999);
  
  const minD = minDate === 'today' ? new Date() : (minDate ? new Date(minDate) : null);
  if (minD) minD.setHours(0, 0, 0, 0);

  const dropdownContent = isOpen ? (
    <div ref={dropdownRef} style={{ 
      position: 'fixed', 
      top: pos.top, 
      left: pos.left,
      zIndex: 1000000,
      background: 'var(--bg-glass)', 
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      border: '1px solid var(--border)', 
      borderRadius: 'var(--radius-lg)', 
      boxShadow: 'var(--shadow-lg)',
      padding: '16px',
      width: '280px',
      animation: 'slideDown .2s ease-out'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <button type="button" onClick={(e) => { e.preventDefault(); setViewDate(new Date(year, month - 1, 1)); }} style={{ background: 'rgba(255,255,255,.05)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'var(--transition)' }} onMouseEnter={e => e.currentTarget.style.background='rgba(25,135,101,.15)'} onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.05)'}>‹</button>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <select 
            value={month} 
            onChange={(e) => setViewDate(new Date(year, parseInt(e.target.value), 1))}
            style={{ background: 'rgba(255,255,255,.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 6px', fontWeight: 600, fontSize: '13px', outline: 'none', cursor: 'pointer' }}
          >
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select 
            value={year} 
            onChange={(e) => setViewDate(new Date(parseInt(e.target.value), month, 1))}
            style={{ background: 'rgba(255,255,255,.05)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 6px', fontWeight: 600, fontSize: '13px', outline: 'none', cursor: 'pointer' }}
          >
            {Array.from({ length: 150 }, (_, i) => new Date().getFullYear() - 130 + i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={(e) => { e.preventDefault(); setViewDate(new Date(year, month + 1, 1)); }} style={{ background: 'rgba(255,255,255,.05)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'var(--transition)' }} onMouseEnter={e => e.currentTarget.style.background='rgba(25,135,101,.15)'} onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.05)'}>›</button>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px' }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {days.map((day, idx) => {
          const isSelected = value && day === new Date(value).getDate() && month === new Date(value).getMonth() && year === new Date(value).getFullYear();
          const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
          const currentDate = new Date(year, month, day);
          const isDisabled = day && ((maxD && currentDate > maxD) || (minD && currentDate < minD));
          return (
            <div 
              key={idx} 
              onClick={() => { if (!isDisabled) handleSelectDate(day); }}
              style={{ 
                height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px',
                fontWeight: isSelected || isToday ? 700 : 500,
                color: !day ? 'transparent' : isSelected ? '#fff' : isToday ? 'var(--accent-light)' : 'var(--text-primary)',
                background: isSelected ? 'var(--accent)' : isToday ? 'rgba(25,135,101,.15)' : 'transparent',
                borderRadius: '8px', cursor: !day ? 'default' : isDisabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s ease', opacity: isDisabled ? 0.3 : 1
              }}
              onMouseEnter={(e) => { if (day && !isSelected && !isDisabled) e.currentTarget.style.background = 'rgba(255,255,255,.08)'; }}
              onMouseLeave={(e) => { if (day && !isSelected && !isDisabled) e.currentTarget.style.background = isToday ? 'rgba(25,135,101,.15)' : 'transparent'; }}
            >{day}</div>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
      <div aria-invalid={invalid} onClick={openDropdown} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: displayValue ? 'var(--text-primary)' : 'var(--text-muted)', background: isOpen ? 'rgba(25,135,101,.05)' : 'rgba(255,255,255,.04)', border: '1px solid', borderColor: invalid ? '#ef4444' : (isOpen ? 'var(--accent)' : 'var(--border-light)'), borderRadius: 'var(--radius)', boxShadow: isOpen ? '0 0 0 3px var(--accent-glow)' : 'none', padding: '10px 14px', minHeight: '42px', transition: 'var(--transition)' }}>
        <span style={{ fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayValue || placeholder}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--text-secondary)" strokeWidth="2" style={{ flexShrink: 0, marginLeft: 8 }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
      </div>
      {isOpen && typeof document !== 'undefined' ? createPortal(dropdownContent, document.body) : null}
    </div>
  );
}
