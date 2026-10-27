import { useEffect, useRef, useState } from 'react';
import { updatePreferences } from '../api.js';

const defaults = { email_notifications: true, sms_notifications: false, cemetery_announcements: true, theme: 'light', text_size: 'standard', high_contrast: false };
const choice = (value, choices, fallback) => choices.includes(value) ? value : fallback;

export default function useAccountPreferences(user, setUser) {
  // Preserve pre-existing device appearance until the first account save.
  const [legacy] = useState(() => ({
    theme: choice(localStorage.getItem('theme'), ['light', 'dark', 'system'], 'light'),
    text_size: choice(localStorage.getItem('gravetrak_ui_scale'), ['standard', 'medium', 'large'], 'standard'),
    high_contrast: localStorage.getItem('gravetrak_high_contrast') === 'true',
  }));
  const [deviceTheme, setDeviceTheme] = useState(legacy.theme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const isCitizen = user?.role === 'user';
  const preferences = isCitizen
    ? { ...defaults, ...user.preferences, ...(user.preferences_initialized ? {} : legacy) }
    : defaults;
  const selection = isCitizen ? preferences.theme : deviceTheme;
  const theme = selection === 'system' ? (systemDark ? 'dark' : 'light') : selection;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = event => setSystemDark(event.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('theme', deviceTheme); }, [deviceTheme]);
  useEffect(() => { setError(''); }, [user?.id]);

  const savePreferences = async patch => {
    if (!isCitizen) throw new Error('Sign in to save your preferences.');
    if (saving.current) throw new Error('Please wait for your current change to finish saving.');
    const accountId = user.id;
    const original = { preferences: user.preferences, preferences_initialized: user.preferences_initialized };
    const next = { ...preferences, ...patch };
    saving.current = true;
    setBusy(true);
    setError('');
    setUser(current => current?.id === accountId ? { ...current, preferences: next, preferences_initialized: true } : current);
    try {
      const result = await updatePreferences(user.preferences_initialized ? patch : next);
      setUser(current => current?.id === accountId ? { ...current, preferences: result.preferences, preferences_initialized: true } : current);
      return result.preferences;
    } catch (failure) {
      setUser(current => current?.id === accountId ? { ...current, ...original } : current);
      setError('Unable to save your settings. Your previous preference has been restored. Please try again.');
      throw failure;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    if (isCitizen) savePreferences({ theme: next }).catch(() => {}); // The shared error is displayed in the user portal.
    else setDeviceTheme(next);
  };
  return { theme, preferences, busy, error, savePreferences, toggleTheme };
}
