export function isReportReady(report, { from = '', to = '', loading = false, error = '' } = {}) {
  if (!report?.from || !report?.to || loading || error) return false;
  if (!from && !to) return report.period === 'overall';
  return Boolean(from && to && report.period !== 'overall' && from === report.from && to === report.to);
}
