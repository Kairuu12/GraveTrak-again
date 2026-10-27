// Connect directly to Django backend to prevent Vite proxy HTML fallback errors
export const API_BASE = import.meta.env.DEV ? 'http://127.0.0.1:8000/api' : (import.meta.env.VITE_API_BASE || '/api');

export const fetchSavedGraves = (signal) => apiFetch('/saved-graves/', { signal });
export const fetchOperationsReports = (signal) => apiFetch('/operations-reports/', { signal });
export const submitOperationsReport = data => apiFetch('/operations-reports/', { method: 'POST', body: JSON.stringify(data) });
export const acknowledgeOperationsReport = id => apiFetch(`/operations-reports/${id}/acknowledge/`, { method: 'POST' });
export const saveLovedOne = (data) => apiFetch('/saved-graves/', { method: 'POST', body: JSON.stringify(data) });
export const removeLovedOne = (id) => apiFetch(`/saved-graves/${id}/`, { method: 'DELETE' });

function getToken() {
  return localStorage.getItem('authToken') || '';
}

async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Token ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const url = `${API_BASE}${path}`;

  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      let errorMsg = data?.detail || data?.error;
      if (!errorMsg && data && typeof data === 'object') {
        // Extract detailed validation errors from Django Rest Framework
        const messages = [];
        for (const [key, val] of Object.entries(data)) {
          messages.push(`${key}: ${Array.isArray(val) ? val.join(' ') : JSON.stringify(val)}`);
        }
        if (messages.length > 0) {
          errorMsg = messages.join(' | ');
        }
      }
      errorMsg = errorMsg || `HTTP ${response.status}: ${response.statusText}`;
      console.error(`[API Error] ${errorMsg}`);
      const error = new Error(errorMsg);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error(`[API Network Error] Failed to connect to backend server at ${API_BASE}.`);
      throw new Error('Failed to connect to the backend server. Please verify the API is available.');
    }
    throw error;
  }
}

export function login(email, password) {
  return apiFetch('/login/', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(payload) {
  return apiFetch('/register/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function logout() {
  return apiFetch('/logout/', { method: 'POST' });
}

export function getProfile() {
  return apiFetch('/profile/');
}

export const updateOwnProfile = payload => apiFetch('/profile/', { method: 'PATCH', body: JSON.stringify(payload) });
export const requestEmailVerification = () => apiFetch('/profile/email-verification/request/', { method: 'POST', body: '{}' });
export const confirmEmailVerification = code => apiFetch('/profile/email-verification/confirm/', { method: 'POST', body: JSON.stringify({ code }) });
export const updatePreferences = payload => apiFetch('/profile/preferences/', { method: 'PATCH', body: JSON.stringify(payload) });
export async function changePassword(payload) {
  const result = await apiFetch('/profile/change-password/', { method: 'POST', body: JSON.stringify(payload) });
  localStorage.setItem('authToken', result.token);
  localStorage.setItem('token', result.token);
  return result;
}

export async function fetchBurialDocumentBlob(id) {
  const token = getToken();
  const response = await fetch(`${API_BASE}/burial-documents/${id}/download/`, {
    credentials: 'include',
    headers: token ? { Authorization: `Token ${token}` } : {},
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.detail || `Unable to load document (HTTP ${response.status}).`);
  }

  return response.blob();
}

export function fetchUsers(options = {}) {
  return apiFetch('/users/', options);
}

export function createUser(payload) {
  return apiFetch('/users/', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateUser(id, payload) {
  return apiFetch(`/users/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function fetchGraves(status, options = {}) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch(`/graves/${query}`, options);
}

export function createGrave(payload) {
  return apiFetch('/graves/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateGrave(id, payload) {
  return apiFetch(`/graves/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteGrave(id) {
  return apiFetch(`/graves/${id}/`, {
    method: 'DELETE',
  });
}

export function submitBurialApplication(formData) {
  return apiFetch('/burial-applications/', {
    method: 'POST',
    body: formData,
  });
}

export function fetchBurialApplications(options = {}) {
  return apiFetch('/burial-applications/', options);
}

export function fetchReportAnalytics(filters = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return apiFetch(`/reports/analytics/?${query.toString()}`);
}

export function fetchBurialApplication(id) {
  return apiFetch(`/burial-applications/${id}/`);
}

export const fetchNotificationRecipient = id => apiFetch(`/burial-applications/${id}/notify/`);
export const fetchNotifications = options => apiFetch('/notifications/', options);
export const markNotificationRead = id => apiFetch(`/notifications/${id}/mark-read/`, { method: 'POST' });

export function notifyApplicationIssue(id, message, idempotencyKey) {
  return apiFetch(`/burial-applications/${id}/notify/`, {
    method: 'POST',
    body: JSON.stringify({ message, idempotency_key: idempotencyKey }),
  });
}

export function fetchColumbariums(options = {}) {
  return apiFetch('/columbariums/?scope=active', options);
}

export function reviewBurialDocument(id, verificationStatus, verificationRemarks = '') {
  return apiFetch(`/burial-documents/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify({
      verification_status: verificationStatus,
      verification_remarks: verificationRemarks,
    }),
  });
}

export function completeDocumentReview(applicationId) {
  return apiFetch(`/burial-applications/${applicationId}/complete-document-review/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function fetchAvailableAppointmentSlots(applicationId, startDate, days = 14) {
  const query = new URLSearchParams({ days: String(days) });
  if (startDate) query.set('start_date', startDate);
  return apiFetch(`/burial-applications/${applicationId}/available-appointment-slots/?${query}`);
}

export function autoScheduleNextAppointment(applicationId, payload) {
  return apiFetch(`/burial-applications/${applicationId}/auto-schedule-next/`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export function rescheduleAppointment(appointmentId, payload) {
  return apiFetch(`/interview-schedules/${appointmentId}/reschedule/`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export function cancelAppointment(appointmentId, reason = '') {
  return apiFetch(`/interview-schedules/${appointmentId}/cancel/`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}

export function replaceBurialDocuments(applicationId, filesByType) {
  const formData = new FormData();
  Object.entries(filesByType).forEach(([documentType, file]) => {
    if (file) formData.append(documentType, file);
  });
  return apiFetch(`/burial-applications/${applicationId}/upload-documents/`, {
    method: 'POST',
    body: formData,
  });
}

export function createColumbarium(payload) {
  return apiFetch('/columbariums/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateColumbarium(id, payload) {
  return apiFetch(`/columbariums/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function transferColumbarium(id, targetId) {
  return apiFetch(`/columbariums/${id}/transfer/`, {
    method: 'POST',
    body: JSON.stringify({ target_id: targetId }),
  });
}

export function deleteColumbarium(id) {
  return apiFetch(`/columbariums/${id}/`, {
    method: 'DELETE',
  });
}

export async function fetchCemeterySections(cemetery = '') {
  const query = cemetery ? `?cemetery=${encodeURIComponent(cemetery)}` : '';
  const data = await apiFetch(`/cemetery-sections/${query}`);
  // Retired map names suppress legacy polygons but never appear in Archive.
  const retired = (data.retired_sections || []).filter(row => !cemetery || row.cemetery__code === cemetery || String(row.cemetery_id) === String(cemetery)).map(row => ({
    type: 'Feature', id: `retired-${row.id}`, geometry: {},
    properties: { id: `retired-${row.id}`, name: row.name, cemetery: row.cemetery_id, cemetery_code: row.cemetery__code, is_active: false, is_retired: true },
  }));
  return { ...data, features: [...(data.features || []), ...retired] };
}

export function createColumbariumSection(payload) {
  return apiFetch('/columbariums/create-section/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchCemeteries() {
  return apiFetch('/cemeteries/');
}

export function fetchBurialPlots(filters = {}) {
  const query = new URLSearchParams({ scope: 'active' });
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== 'all') query.set(key, value);
  });
  const suffix = query.toString() ? `?${query}` : '';
  return apiFetch(`/burial-plots/${suffix}`);
}

export function managePlotMaintenance(kind, id, payload) {
  const resource = kind === 'niche' ? 'columbariums' : 'burial-plots';
  return apiFetch(`/${resource}/${encodeURIComponent(id)}/maintenance/?scope=active`, {
    method: 'POST', body: JSON.stringify(payload),
  });
}

export function fetchBurialPlotSummary(filters = {}) {
  const query = new URLSearchParams({ scope: 'active' });
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== 'all') query.set(key, value);
  });
  const suffix = query.toString() ? `?${query}` : '';
  return apiFetch(`/burial-plots/summary/${suffix}`);
}

export function generateBurialPlotLayout(payload) {
  return apiFetch('/burial-plots/generate-layout/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createCemeterySection(payload) {
  return apiFetch('/cemetery-sections/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCemeterySection(id, payload) {
  return apiFetch(`/cemetery-sections/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteCemeterySection(id) {
  return apiFetch(`/cemetery-sections/${id}/`, { method: 'DELETE' });
}

export function fetchCemeteryPathways(cemetery = '') {
  const query = cemetery ? `?cemetery=${encodeURIComponent(cemetery)}` : '';
  return apiFetch(`/cemetery-pathways/${query}`);
}

export function createCemeteryPathway(payload) {
  return apiFetch('/cemetery-pathways/', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateCemeteryPathway(id, payload) {
  return apiFetch(`/cemetery-pathways/${id}/`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function deleteCemeteryPathway(id) {
  return apiFetch(`/cemetery-pathways/${id}/`, { method: 'DELETE' });
}
