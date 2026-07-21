import { useState } from 'react';
import { LogOut, Edit3, X, RotateCcw, Loader2, Type } from 'lucide-react';
import { LogoFull } from './Logo.jsx';
import { LABEL_GROUPS } from '../labels/labelDefs.js';
import { useLabels } from '../labels/LabelsContext.jsx';

// editor_2's own screen. This is deliberately a separate page from the
// real diagram navbar — clicking an item here never triggers the real
// action (e.g. clicking the "Çıxış" row does not log anyone out); it only
// opens a popup to rename that piece of interface text. The real
// Logout button lives in THIS page's own top bar, and each rename is
// saved the moment you press "Yadda saxla" in the popup.
export default function LabelEditorPage({ onLogout }) {
  const { t, saveLabel, resetLabel } = useLabels();
  const [editing, setEditing] = useState(null); // { id, default } | null

  return (
    <div className="label-editor-page">
      <div className="topbar">
        <div className="top-left">
          <span className="label-editor-title">
            <Type size={16} /> Mətn Redaktoru
          </span>
        </div>

        <LogoFull />

        <div className="top-right">
          <button className="logout-btn" onClick={onLogout}>
            <LogOut size={16} /><span>Çıxış</span>
          </button>
        </div>
      </div>

      <div className="label-editor-body">
        <p className="label-editor-hint">
          Bu ekranda yalnız interfeys mətnlərini (düymə adları, panel başlıqları) dəyişə bilərsiniz.
          Diaqramların özündəki məzmun (bölmə adları, başlıqlar, node-lar) buradan dəyişmir.
        </p>

        {LABEL_GROUPS.map(g => (
          <div className="label-editor-group" key={g.group}>
            <h4>{g.group}</h4>
            <div className="label-editor-list">
              {g.items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="label-editor-row"
                  onClick={() => setEditing(item)}
                >
                  <span className="label-editor-row-text">{t(item.id, item.default)}</span>
                  <Edit3 size={14} className="label-editor-row-icon" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <RenamePopup
          item={editing}
          currentText={t(editing.id, editing.default)}
          onClose={() => setEditing(null)}
          onSave={async (text) => { await saveLabel(editing.id, text); setEditing(null); }}
          onReset={async () => { await resetLabel(editing.id); setEditing(null); }}
        />
      )}
    </div>
  );
}

function RenamePopup({ item, currentText, onClose, onSave, onReset }) {
  const [text, setText] = useState(currentText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isOverridden = currentText !== item.default;

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) { setError('Mətn boş ola bilməz'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(text.trim());
    } catch (err) {
      setError(err.message || 'Xəta');
      setSaving(false);
    }
  }

  return (
    <div className="pdf-modal-backdrop" onClick={onClose}>
      <form className="pdf-modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="pdf-modal-head nospace">
          <h3>Mətni dəyiş</h3>
          <button type="button" className="pdf-modal-close" onClick={onClose} aria-label="Bağla">
            <X size={18} />
          </button>
        </div>

        <div className="pdf-modal-body">
          <div className="pdf-field">
            <label>Yeni mətn</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          </div>
          {isOverridden && (
            <div className="label-editor-default-hint">Standart mətn: “{item.default}”</div>
          )}
          {error && <div className="pdf-modal-error">{error}</div>}
        </div>

        <div className="pdf-modal-foot">
          {isOverridden && (
            <button type="button" className="pdf-modal-btn" onClick={onReset} disabled={saving}>
              <RotateCcw size={13} /> Standarta qaytar
            </button>
          )}
          <button type="button" className="pdf-modal-btn" onClick={onClose} disabled={saving}>
            Ləğv et
          </button>
          <button type="submit" className="pdf-modal-btn pdf-modal-btn-primary" disabled={saving}>
            {saving && <Loader2 size={14} className="spin" />}
            <span>{saving ? 'Saxlanılır...' : 'Yadda saxla'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
