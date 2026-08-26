import { useState } from 'react';
import { X, Loader2 } from '../icons.jsx';

// Flattens a flat groups array (with optional parentId) into depth-first
// order, so a plain <select> can show nested groups with indentation.
function orderedGroupOptions(groups) {
  const pid = (g) => (g.parentId === undefined || g.parentId === null || g.parentId === 0)
    ? null
    : Number(g.parentId);
  const out = [];
  function walk(parentId, depth) {
    groups
      .filter(g => pid(g) === parentId)
      .forEach(g => {
        out.push({ g, depth });
        walk(g.id, depth + 1);
      });
  }
  walk(null, 0);
  return out;
}

export default function PdfFormModal({ mode, pdf, groups = [], defaultGroupId, onClose, onSave }) {
  const isEdit = mode === 'edit';
  const [title, setTitle] = useState(isEdit ? (pdf?.title || '') : '');
  const [subtitle, setSubtitle] = useState(isEdit ? (pdf?.subtitle || '') : '');
  const [groupId, setGroupId] = useState(
    isEdit ? (pdf?.groupId ?? defaultGroupId ?? (groups[0]?.id))
           : (defaultGroupId ?? (groups[0]?.id))
  );
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

  function pickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return setFile(null);

    // Some browsers/OSes don't report a MIME type at all (f.type === '').
    // The old check only rejected a file when f.type was set AND wrong,
    // so an empty type silently let ANY file through (docx, xlsx, exe...).
    // Checking the file extension as well closes that gap.
    const isPdfType = !f.type || f.type === 'application/pdf';
    const isPdfExt = /\.pdf$/i.test(f.name || '');
    if (!isPdfType || !isPdfExt) {
      setError('Yalnız PDF fayl seçin');
      e.target.value = '';
      return;
    }

    if (f.size > MAX_FILE_BYTES) {
      setError(`Fayl çox böyükdür (maks. ${MAX_FILE_BYTES / (1024 * 1024)}MB)`);
      e.target.value = '';
      return;
    }

    setError('');
    setFile(f);
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError('Başlıq daxil edin'); return; }
    if (!groupId) { setError('Qrup seçin'); return; }
    if (!isEdit && !file) { setError('PDF fayl seçin'); return; }

    setSaving(true);
    try {
      await onSave({ title: title.trim(), subtitle: subtitle.trim(), groupId: Number(groupId), file });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pdf-modal-backdrop" onClick={onClose}>
      <form className="pdf-modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="pdf-modal-head nospace">
          <h3>{isEdit ? 'PDF redaktə et' : 'Yeni PDF əlavə et'}</h3>
          <button type="button" className="pdf-modal-close" onClick={onClose} aria-label="Bağla">
            <X size={18} />
          </button>
        </div>

        <div className="pdf-modal-body">
          <div className="pdf-field">
            <label>Başlıq</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Sənədin adı" autoFocus />
          </div>

          <div className="pdf-field">
            <label>İş axışının nömrəsi</label>
            <input type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Qısa İş axışının nömrəsi (məcburi deyil)" />
          </div>

          <div className="pdf-field">
            <label>Qrup</label>
            <select value={groupId || ''} onChange={(e) => setGroupId(e.target.value)}>
              {groups.length === 0 && <option value="">Qrup yoxdur</option>}
              {orderedGroupOptions(groups).map(({ g, depth }) => (
                <option key={g.id} value={g.id}>
                  {'\u00A0\u00A0'.repeat(depth)}{depth > 0 ? '↳ ' : ''}{g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="pdf-field">
            <label>{isEdit ? 'Faylı dəyişdir (məcburi deyil)' : 'PDF fayl'}</label>
            <input type="file" accept="application/pdf,.pdf" onChange={pickFile} />
            {isEdit && pdf?.filename && !file && (
              <div className="pdf-field-hint">Hazırkı: {pdf.filename}</div>
            )}
            {file && <div className="pdf-field-hint">Seçildi: {file.name}</div>}
          </div>

          {error && <div className="pdf-modal-error">{error}</div>}
        </div>

        <div className="pdf-modal-foot">
          <button type="button" className="pdf-modal-btn" onClick={onClose} disabled={saving}>Ləğv et</button>
          <button type="submit" className="pdf-modal-btn pdf-modal-btn-primary" disabled={saving}>
            {saving && <Loader2 size={14} className="spin" />}
            <span>{saving ? 'Saxlanılır...' : 'Saxla'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
