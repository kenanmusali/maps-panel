import { useState, useRef, useEffect } from 'react';
import { Clock,Signature, CheckCircle2, AlertCircle,CircleX, ChevronDown } from './icons.jsx';
import { useLabels } from '../labels/LabelsContext.jsx';

// Single source of truth for the three item statuses used across the
// diagrams (İş Axışları) and PDF (Normativ Sənədlər) sections.
//   progress → in progress   done → finished   notdone → not finished
export const STATUS_META = {
  progress: { id: 'status.progress', default: 'Müzakirədə', Icon: AlertCircle,        cls: 'progress' },

  done:     { id: 'status.done', default: 'Təsdiqlənmiş ', Icon: CheckCircle2, cls: 'done' },

  notdone:  { id: 'status.notdone', default: 'Təsdqlənməmiş',   Icon: CircleX,  cls: 'notdone' },

  sign:     { id: 'status.sign', default: 'İmza Prosesində',  Icon: Signature, cls: 'sign' },
};

export const STATUS_ORDER = ['progress', 'done', 'notdone', 'sign'];

function norm(value) {
  return STATUS_META[value] ? value : null;
}

// Read-only coloured pill with icon + label. Renders nothing when no status.
export function StatusBadge({ value, size = 14 }) {
  const { t } = useLabels();
  const v = norm(value);
  if (!v) return null;
  const { default: def, Icon, cls, id } = STATUS_META[v];
  const label = t(id, def);
  return (
    <span className={`status-badge ${cls}`} title={label}>
      <Icon size={size} />
      <span>{label}</span>
    </span>
  );
}

// Interactive control for admins. Shows the current status and, on click,
// a small menu to pick a status or clear it. Viewers get <StatusBadge> instead.
export function StatusControl({ value, editable, onChange, size = 14 }) {
  const { t } = useLabels();
  const v = norm(value);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (document.body.dataset.labelEdit === '1') return; if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!editable) return <StatusBadge value={v} size={size} />;

  const meta = v ? STATUS_META[v] : null;
  const metaLabel = meta ? t(meta.id, meta.default) : null;

  function pick(next) {
    setOpen(false);
    if (next !== v) onChange(next);
  }

  return (
    <span className="status-control" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className={`pill-chip edit-chip ${meta ? meta.cls : 'none'}`}
        
        onClick={() => setOpen(o => !o)}
      >
        {meta ? <meta.Icon size={size} /> : <Clock size={size} />}
        <span>{meta ? metaLabel : t('status.placeholder', 'Status')}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="status-menu">
          {STATUS_ORDER.map(k => {
            const m = STATUS_META[k];
            return (
              <button
                type="button"
                key={k}
                className={`status-opt ${m.cls} ${v === k ? 'active' : ''}`}
                onClick={() => pick(k)}
              >
                <m.Icon size={14} /><span>{t(m.id, m.default)}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={`status-opt none ${!v ? 'active' : ''}`}
            onClick={() => pick(null)}
          >
            <span>{t('status.none', 'Statussuz')}</span>
          </button>
        </div>
      )}
    </span>
  );
}
