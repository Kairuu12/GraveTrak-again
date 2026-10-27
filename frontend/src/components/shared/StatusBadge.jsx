const tones = {
  approved: 'var(--emerald)',
  active: 'var(--emerald)',
  pending: 'var(--amber)',
  rejected: 'var(--red)',
  inactive: 'var(--text-muted)',
};

export default function StatusBadge({ status }) {
  const normalized = String(status || 'unknown').toLowerCase();
  const color = tones[normalized] || 'var(--accent)';
  return <span style={{ color, fontWeight: 700, textTransform: 'capitalize' }}>{status || 'Unknown'}</span>;
}
