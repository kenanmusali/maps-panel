import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { setOverrides, setOverride, label, subscribe } from './labelStore.js';

const LabelsCtx = createContext({
  t: (id, fallback) => fallback,
  loaded: false,
  refresh: async () => {},
  saveLabel: async () => {},
  resetLabel: async () => {}
});

// enabled = true once there's an authenticated user (no point calling the
// API from the login screen).
export function LabelsProvider({ children, enabled }) {
  const [, forceRender] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getLabels();
      setOverrides(data || {});
    } catch (e) {
      // Not authenticated yet, or the endpoint failed — fall back to the
      // hard-coded defaults silently, same as the rest of the app does
      // when /api/settings is unreachable.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  useEffect(() => subscribe(() => forceRender(n => n + 1)), []);

  const saveLabel = useCallback(async (id, text) => {
    setOverride(id, text); // optimistic — UI updates instantly everywhere
    try {
      await api.setLabel(id, text);
    } catch (e) {
      await refresh(); // roll back to server truth if the write failed
      throw e;
    }
  }, [refresh]);

  const resetLabel = useCallback(async (id) => {
    setOverride(id, '');
    try {
      await api.resetLabel(id);
    } catch (e) {
      await refresh();
      throw e;
    }
  }, [refresh]);

  return (
    <LabelsCtx.Provider value={{ t: label, loaded, refresh, saveLabel, resetLabel }}>
      {children}
    </LabelsCtx.Provider>
  );
}

export function useLabels() {
  return useContext(LabelsCtx);
}
