import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Pencil } from 'lucide-react';
import { api } from '../api/client.js';
import { setOverrides, setOverride, label, subscribe } from './labelStore.js';

const LabelsCtx = createContext({
  t: (id, fallback) => fallback,
  loaded: false,
  labelEdit: false,
  setLabelEdit: () => {},
  applyLabel: () => {},
  resetToDefault: () => {},
  commit: async () => {},
  pendingCount: 0,
  saving: false,
  savedTick: 0,
  refresh: async () => {}
});

// enabled = true once there's an authenticated user (no point calling the
// API from the login screen).
export function LabelsProvider({ children, enabled }) {
  const [, forceRender] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // editor_2's in-place editing state. `labelEdit` is toggled from the floating
  // editor bar; while it's on, t() renders every interface string as an
  // <EditableLabel> instead of a plain string, so the whole real UI becomes
  // editable in place (double-click or pen icon) — no separate screen.
  const [labelEdit, setLabelEdit] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const pending = useRef(new Map()); // id -> text ('' means reset to default)

  const refresh = useCallback(async () => {
    try {
      const data = await api.getLabels();
      setOverrides(data || {});
    } catch (e) {
      // Not authenticated yet, or the endpoint failed — fall back to the
      // hard-coded defaults silently.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  useEffect(() => subscribe(() => forceRender(n => n + 1)), []);

  // Live, local edit. Updates the shared store so every occurrence of the label
  // across the whole UI changes instantly, and queues the change to be persisted
  // when the editor presses "Yadda saxla". '' deletes the override (back to default).
  const applyLabel = useCallback((id, text) => {
    setOverride(id, text);
    pending.current.set(id, text);
    setPendingCount(pending.current.size);
  }, []);

  const resetToDefault = useCallback((id) => {
    applyLabel(id, '');
  }, [applyLabel]);

  const commit = useCallback(async () => {
    if (!pending.current.size) return;
    setSaving(true);
    const entries = [...pending.current.entries()];
    try {
      for (const [id, text] of entries) {
        if (text && text.trim()) await api.setLabel(id, text.trim());
        else await api.resetLabel(id);
        pending.current.delete(id);
      }
      setPendingCount(pending.current.size);
      setSavedTick(n => n + 1);
    } catch (e) {
      await refresh(); // pull server truth back on failure
      throw e;
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  // The one function everything renders. Normally returns a plain string, exactly
  // as before. In label-edit mode it returns an <EditableLabel> element instead —
  // every call site already renders t()'s result as a child, so nothing else changes.
  const t = useCallback((id, fallback) => {
    const text = label(id, fallback);
    if (!labelEdit) return text;
    return <EditableLabel id={id} text={text} fallback={fallback} onApply={applyLabel} />;
  }, [labelEdit, applyLabel]);

  return (
    <LabelsCtx.Provider value={{
      t, loaded, labelEdit, setLabelEdit,
      applyLabel, resetToDefault, commit,
      pendingCount, saving, savedTick, refresh
    }}>
      {children}
    </LabelsCtx.Provider>
  );
}

// In-place editable interface string. Shows a pen next to the text; double-click
// the text or click the pen to edit inline. Enter/blur applies, Esc cancels,
// clearing the field resets to the built-in default. Clicks never fall through
// to the underlying control (menu item, logout button, tab...) while editing.
function EditableLabel({ id, text, fallback, onApply }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(text);
  const inputRef = useRef(null);

  useEffect(() => { if (!editing) setVal(text); }, [text, editing]);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function begin(e) { e.preventDefault(); e.stopPropagation(); setVal(text); setEditing(true); }
  function commitLocal() {
    setEditing(false);
    const next = val.trim();
    if (next !== text) onApply(id, next); // '' => reset to default
  }
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitLocal(); }
    else if (e.key === 'Escape') { e.preventDefault(); setVal(text); setEditing(false); }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="tedit-input"
        value={val}
        size={Math.max(4, val.length + 1)}
        placeholder={fallback}
        onChange={e => setVal(e.target.value)}
        onKeyDown={onKey}
        onBlur={commitLocal}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()}
      />
    );
  }

  const overridden = text !== fallback;
  return (
    <span
      className={'tedit' + (overridden ? ' is-overridden' : '')}
      onClick={e => e.stopPropagation()}
      onDoubleClick={begin}
      title={'İnterfeys mətni — dəyişmək üçün klikləyin' + (overridden ? ` · standart: ${fallback}` : '')}
    >
      {text}
      <span
        role="button"
        tabIndex={0}
        className="tedit-pen"
        aria-label="Mətni dəyiş"
        onMouseDown={e => e.stopPropagation()}
        onClick={begin}
      >
        <Pencil size={11} />
      </span>
    </span>
  );
}

export function useLabels() {
  return useContext(LabelsCtx);
}
