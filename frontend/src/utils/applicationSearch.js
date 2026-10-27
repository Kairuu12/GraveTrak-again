const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function filterApplications(applications, query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return applications;
  return applications.filter(app => {
    const text = [app.applicant_name, app.deceased_name, app.application_id,
      app.applicant_address, app.applicant_contact_email, app.applicant_email,
      app.user, app.appId, app.name, app.message].map(normalize).join(' ');
    return terms.every(term => text.includes(term));
  });
}

export function applicationSubmittedTime(app) {
  const raw = app.submitted_at || app.created_at || app.date;
  const time = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

export function selectApplicationList(applications, query, { from = '', to = '', order = 'oldest' } = {}) {
  return filterApplications(applications, query).filter(app => {
    if (!from && !to) return true;
    const time = applicationSubmittedTime(app);
    if (time === null) return false;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
    const part = type => parts.find(item => item.type === type).value;
    const day = `${part('year')}-${part('month')}-${part('day')}`;
    return (!from || day >= from) && (!to || day <= to);
  }).sort((a, b) => {
    const left = applicationSubmittedTime(a), right = applicationSubmittedTime(b);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return order === 'newest' ? right - left : left - right;
  });
}

export function applicationWaitingLabel(app, now = Date.now()) {
  const time = applicationSubmittedTime(app);
  if (time === null || time > now) return 'Submission date unavailable';
  const days = Math.floor((now - time) / 86400000);
  return days === 0 ? 'Submitted today' : `Waiting ${days} ${days === 1 ? 'day' : 'days'}`;
}
