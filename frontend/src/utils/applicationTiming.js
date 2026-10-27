export function getElapsedMilliseconds(startValue, endValue) {
  if (!startValue || !endValue) return null;
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

// Use milestone timestamps, never the last-edit date or a status-based guess.
// Callers supply records for the currently selected cemetery.
export function getAverageApprovalTiming(records) {
  const durations = records.map(app => getElapsedMilliseconds(
    app.submitted_at || app.created_at, app.approved_at,
  )).filter(duration => duration !== null);
  return {
    count: durations.length,
    averageMs: durations.length ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length : null,
  };
}
