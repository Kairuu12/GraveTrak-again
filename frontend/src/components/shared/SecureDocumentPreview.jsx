import { useEffect, useState } from 'react';
import { fetchBurialDocumentBlob } from '../../api.js';

export default function SecureDocumentPreview({ document }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [mimeType, setMimeType] = useState(document.mime_type || '');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let createdUrl = '';

    setObjectUrl('');
    setError('');
    fetchBurialDocumentBlob(document.id)
      .then(blob => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setMimeType(blob.type || document.mime_type || '');
        setObjectUrl(createdUrl);
      })
      .catch(err => {
        if (active) setError(err.message || 'Document preview is unavailable.');
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [document.id, document.mime_type]);

  const isImage = mimeType.startsWith('image/');

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        {!objectUrl && !error && (
          <div style={{ padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>Loading protected preview…</div>
        )}
        {error && (
          <div style={{ padding: 40, color: 'var(--red)', fontSize: 12 }}>{error}</div>
        )}
        {objectUrl && isImage && (
          <img
            src={objectUrl}
            alt={document.document_type_display}
            style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 'var(--radius)', border: '1px solid var(--border)', objectFit: 'contain' }}
          />
        )}
        {objectUrl && !isImage && (
          <div style={{ padding: 40, background: 'rgba(255,255,255,.05)', borderRadius: 'var(--radius)', color: 'var(--text-muted)', fontSize: 12 }}>
            Inline preview is not available for this file type. Use View Document.
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={!objectUrl}
        onClick={() => window.open(objectUrl, '_blank', 'noopener,noreferrer')}
        style={{ padding: '4px 8px', fontSize: 11 }}
      >
        View Document
      </button>
    </>
  );
}
