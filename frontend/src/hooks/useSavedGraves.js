import { useEffect, useRef, useState } from 'react';
import { fetchSavedGraves, saveLovedOne, removeLovedOne } from '../api.js';

export const savedGraveKey = (grave) => `${grave.cemeteryMap || grave.cemetery_map || 'old'}:${grave.grave_id || grave.id}`;

export default function useSavedGraves(enabled) {
  const token = enabled ? localStorage.getItem('authToken') : null;
  const identity = useRef(token);
  identity.current = token;
  const [state, setState] = useState({ token: null, items: [], loading: true, error: '' });
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ token, items: [], loading: !!token, error: '' });
    if (token) fetchSavedGraves(controller.signal).then(items => {
      if (!controller.signal.aborted) setState({ token, items, loading: false, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ token, items: [], loading: false, error: error.message });
    });
    return () => controller.abort();
  }, [token, reload]);
  const items = state.token === token && token ? state.items : [];
  async function save(grave) {
    if (!token || pending.current) return;
    const coords = grave.latlng || grave.loc || [grave.latitude, grave.longitude];
    const latlng = Array.isArray(coords) ? coords.map(Number) : [Number(coords?.lat), Number(coords?.lng)];
    if (latlng.length !== 2 || !latlng.every(Number.isFinite)) throw new Error('This grave has no map location yet.');
    pending.current = true; setBusy(true);
    try {
      const details = { name: grave.name || 'Saved grave', location: grave.location || '', dates: grave.dates || '', section: grave.section || '', latlng };
      if (grave.floor) details.floor = Number(grave.floor);
      const item = await saveLovedOne({ grave_id: String(grave.grave_id || grave.id), cemetery: grave.cemeteryMap || grave.cemetery_map || 'old', details });
      if (identity.current === token) setState(prev => ({ ...prev, error: '', items: [item, ...prev.items.filter(g => g.id !== item.id)] }));
    } finally { pending.current = false; setBusy(false); }
  }
  async function remove(id) {
    if (!token || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      await removeLovedOne(id);
      if (identity.current === token) setState(prev => ({ ...prev, items: prev.items.filter(g => g.id !== id) }));
    } finally { pending.current = false; setBusy(false); }
  }
  return { items, loading: state.token !== token || state.loading, error: state.token === token ? state.error : '', busy, save, remove,
    retry: () => setReload(v => v + 1), isSaved: grave => items.some(item => `${item.cemetery}:${item.grave_id}` === savedGraveKey(grave)) };
}
