import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({ title, children, onClose, busy = false, showCloseButton = true, className = '', portalTarget }) {
  const dialog = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const titleId = useId();
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const node = dialog.current;
    const focusables = () => [...node.querySelectorAll('input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')];
    (focusables()[0] || node).focus();
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusables();
        if (!items.length) { event.preventDefault(); node.focus(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) { event.preventDefault(); first.focus(); }
      }
    };
    node.addEventListener('keydown', handleKey);
    return () => {
      node.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const content = (
    <div className={`modal-overlay open ${className}`} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="modal" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-header"><h2 className="modal-title" id={titleId}>{title}</h2><button className="modal-close" aria-label="Close dialog" type="button" disabled={busy} onClick={onClose}>×</button></div>
        <div className="modal-body">{children}
        {showCloseButton && <button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
  return portalTarget ? createPortal(content, portalTarget) : content;
}
