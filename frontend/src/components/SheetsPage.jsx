import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { LogoFull } from './Logo.jsx';
import {
  LogOut, Loader2, Trash2, ChevronLeft, Download, Upload
} from './icons.jsx';
import { LayoutGrid, Ban } from 'lucide-react';
import { api } from '../api/client.js';
import { StatusControl, STATUS_META, STATUS_ORDER } from './Status.jsx';
import { useLabels } from '../labels/LabelsContext.jsx';
import { exportSheetToExcel, importSheetRowsFromExcel } from './sheetsExcel.js';
import SheetColumnFilter, {
  BLANK_FILTER_VALUE,
  uniqueColumnValues
} from './SheetColumnFilter.jsx';

// Kinds that get the hand-typed normativ-sənəd fields (sənədin növü, nəşr,
// təsdiq tarixi, qərar/protokol) — Normativ Sənədlər (pdfs) və Şablonlar.
const EXTRA_FIELD_KINDS = new Set(['pdfs', 'templates']);
const EXTRA_FIELDS = [
  { key: 'docType', ph: 'Sənədin növü…', label: 'Sənədin növü' },
  { key: 'edition', ph: 'Nəşr…', label: 'Nəşr' },
  { key: 'approvalDate', ph: 'gg.aa.iiii', label: 'Təsdiq tarixi' },
  { key: 'protocol', ph: 'Qərar / Protokol…', label: 'Qərar / Protokol' }
];

// Excel-style behaviour: always keep a pool of ready-to-type blank rows at
// the bottom of the sheet. Fresh/near-empty sheets start with a full pool;
// once you have that many real rows, exactly one blank row trails the last
// one (fill row 45 → row 46 appears empty, fill 46 → 47 appears, etc).
//
// Rows are addressed by a fixed `order` number (their permanent visual
// position), not by array index. Filling row 5 while rows 2/3 stay empty
// must NEVER bump row 5 up to close the gap — 2 and 3 stay open for later.
// Deleting a row (real or blank) just leaves that order number empty; it
// doesn't renumber anything after it.
const DEFAULT_BLANK_ROWS = 15;

function emptyDraft() {
  return { title: '', subtitle: '', strukturAdi: '', status: null, extra: {} };
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function fmtTime(d) {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const period = h >= 12 ? 'PM' : 'AM';
  const hh = (h % 12 || 12).toString().padStart(2, '0');
  return `${hh}:${m} ${period}`;
}

function fmtClockDate(d) {
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// Excel-style cell editor: a single-line textarea that grows to fit
// wrapped text instead of clipping/truncating like a plain <input>.
// commitOnBlur=false is used for the DRAFT (new-row) fields — losing focus
// there must never submit the row, only pressing Enter or the + button.
function GridCell({ value, placeholder, disabled, onChange, onCommit, cellRef, commitOnBlur = true }) {
  const localRef = useRef(null);
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => { localRef.current = el; if (cellRef) cellRef.current = el; }}
      rows={1}
      className="sheets-cell-input"
      value={value || ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => { if (commitOnBlur) onCommit?.(e.target.value); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit?.(value);
          e.target.blur();
        }
      }}
    />
  );
}

const KIND_META = {
  diagrams: {
    title: 'Sheets',
    sub: 'Diaqram kataloqu — İş Axışlarından ayrıca',
    namePh: 'Yeni İş axışının adı…',
    subPh: 'İkinci ad…'
  },
  pdfs: {
    title: 'Sheets',
    sub: 'Sənəd kataloqu — Normativ Sənədlərdən ayrıca',
    namePh: 'Yeni sənəd adı…',
    subPh: 'İkinci ad…'
  },
  templates: {
    title: 'Sheets',
    sub: 'Şablon kataloqu — Şablonlardan ayrıca',
    namePh: 'Yeni şablon adı…',
    subPh: 'İkinci ad…'
  }
};

export default function SheetsPage({
  kind = 'diagrams',
  onBack,
  onLogout,
  withStatus = true
}) {
  const { t, tByText } = useLabels();
  const role = localStorage.getItem('role');
  const isAdmin = role === 'admin';
  const isViewer = role === 'viewer' || role === 'editor_2';
  const meta = KIND_META[kind] || KIND_META.diagrams;
  const hasExtraFields = EXTRA_FIELD_KINDS.has(kind);

  const [now, setNow] = useState(new Date());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Soft progress overlay (blur + bar) — stays until fetch actually finishes,
  // instead of a blank "stuck" spinner state.
  const [loadUi, setLoadUi] = useState({ show: true, pct: 6 });

  // Draft text for not-yet-saved blank rows, keyed by their fixed `order`
  // slot number — NOT by array index. This is what lets a blank stay put
  // (and keep its own draft text) no matter what happens in other rows.
  const [blankDrafts, setBlankDrafts] = useState({});
  // Blank slots the admin explicitly removed from the pool (order numbers).
  // Never lets the count of visible blanks hit zero — see removeBlankSlot.
  const [hiddenBlankOrders, setHiddenBlankOrders] = useState(() => new Set());
  const [statusFilter, setStatusFilter] = useState(null); // null | 'progress'|'done'|'notdone'|'sign'|'nostatus'
  // Excel-style per-column filters: key → Set of allowed values (null = show all)
  const [colFilters, setColFilters] = useState({});
  const [openColFilter, setOpenColFilter] = useState(null); // column key or null
  const [importBusy, setImportBusy] = useState(false);
  const committingRef = useRef(new Set());
  const importInputRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const isLoading = loading || importBusy || busy;

  useEffect(() => {
    if (isLoading) {
      setLoadUi((u) => ({ show: true, pct: Math.max(u.pct > 0 && u.pct < 100 ? u.pct : 6, 6) }));
      const id = setInterval(() => {
        setLoadUi((u) => {
          if (!u.show || u.pct >= 90) return u;
          const bump = 3 + Math.random() * 9;
          return { show: true, pct: Math.min(90, u.pct + bump) };
        });
      }, 220);
      return () => clearInterval(id);
    }
    // Request finished → fill bar, then dismiss overlay.
    setLoadUi((u) => (u.show ? { show: true, pct: 100 } : u));
    const t = setTimeout(() => setLoadUi({ show: false, pct: 0 }), 420);
    return () => clearTimeout(t);
  }, [isLoading]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listSheets(kind);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setError(e.message || 'Yüklənmədi');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [kind]);

  // Reset per-sheet blank-row bookkeeping whenever the sheet kind changes.
  useEffect(() => {
    setBlankDrafts({});
    setHiddenBlankOrders(new Set());
    setColFilters({});
    setOpenColFilter(null);
  }, [kind]);

  const maxOrder = useMemo(
    () => items.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0),
    [items]
  );
  // Fresh/near-empty sheets show a full pool of 15 blanks; once real rows
  // pass that, the pool always ends exactly one blank past the highest
  // used position (fill row 45 → row 46 appears empty, etc). Gaps that
  // already exist below that (empty rows 2/3 while 5 is filled) stay put.
  const totalSlots = Math.max(maxOrder + 1, DEFAULT_BLANK_ROWS);

  const itemsByOrder = useMemo(() => {
    const m = new Map();
    for (const row of items) m.set(Number(row.order), row);
    return m;
  }, [items]);

  // The single ordered list actually rendered: real rows keep the exact
  // order slot they were saved with, blanks fill every other slot up to
  // totalSlots (minus any the admin removed from the pool).
  const displayRows = useMemo(() => {
    if (!isAdmin) {
      return items
        .slice()
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
        .map(row => ({ order: Number(row.order) || 0, row, isBlank: false }));
    }
    const out = [];
    for (let k = 1; k <= totalSlots; k++) {
      const real = itemsByOrder.get(k);
      if (real) {
        out.push({ order: k, row: real, isBlank: false });
      } else if (!hiddenBlankOrders.has(k)) {
        out.push({ order: k, row: blankDrafts[k] || emptyDraft(), isBlank: true });
      }
    }
    return out;
  }, [isAdmin, items, itemsByOrder, totalSlots, hiddenBlankOrders, blankDrafts]);

  const visibleBlankCount = useMemo(
    () => displayRows.filter(r => r.isBlank).length,
    [displayRows]
  );

  const colValueGetters = useMemo(() => {
    const labelStatus = (key) => {
      const m = STATUS_META[key];
      return m ? t(m.id, m.default) : '';
    };
    const map = {
      title: (row) => row.title,
      strukturAdi: (row) => row.strukturAdi,
      subtitle: (row) => row.subtitle,
      status: (row) => (row.status ? labelStatus(row.status) : ''),
      date: (row) => (row.date ? fmtDate(row.date) : '')
    };
    if (hasExtraFields) {
      for (const f of EXTRA_FIELDS) map[f.key] = (row) => row[f.key];
    }
    return map;
  }, [hasExtraFields, t]);

  const colOptions = useMemo(() => {
    const out = {};
    for (const [key, get] of Object.entries(colValueGetters)) {
      out[key] = uniqueColumnValues(items, get);
    }
    return out;
  }, [items, colValueGetters]);

  function cellFilterValue(row, key) {
    const get = colValueGetters[key];
    if (!get) return BLANK_FILTER_VALUE;
    const raw = get(row);
    return raw == null || String(raw).trim() === '' ? BLANK_FILTER_VALUE : String(raw).trim();
  }

  // Status cards + column filters hide real rows only — blank rows always
  // stay visible so there's somewhere to type.
  const filteredDisplayRows = useMemo(() => {
    const activeCols = Object.entries(colFilters).filter(([, set]) => set != null);
    if (!statusFilter && activeCols.length === 0) return displayRows;
    return displayRows.filter(r => {
      if (r.isBlank) return true;
      if (statusFilter) {
        if (statusFilter === 'nostatus') {
          if (r.row.status) return false;
        } else if (r.row.status !== statusFilter) {
          return false;
        }
      }
      for (const [key, allowed] of activeCols) {
        if (!allowed.has(cellFilterValue(r.row, key))) return false;
      }
      return true;
    });
  }, [displayRows, statusFilter, colFilters, colValueGetters]);

  const applyColFilter = useCallback((key, next) => {
    setColFilters(prev => {
      const cp = { ...prev };
      if (next == null) delete cp[key];
      else cp[key] = next;
      return cp;
    });
  }, []);

  const closeColFilter = useCallback(() => setOpenColFilter(null), []);

  function renderColHeader(key, label, className) {
    const opts = colOptions[key] || [];
    return (
      <th key={key} className={className}>
        <div className="sheets-th-inner">
          <span className="sheets-th-label">{label}</span>
          <SheetColumnFilter
            options={opts}
            applied={colFilters[key] || null}
            open={openColFilter === key}
            onToggleOpen={() => setOpenColFilter(prev => (prev === key ? null : key))}
            onApply={(set) => applyColFilter(key, set)}
            onClose={closeColFilter}
            searchPlaceholder={tByText('Search')}
            selectAllLabel={tByText('(Select All)')}
            blankLabel={tByText('(Boş)')}
            okLabel={tByText('OK')}
            cancelLabel={tByText('Cancel')}
          />
        </div>
      </th>
    );
  }

  function blankHasContent(b) {
    return !!(
      (b.title || '').trim() ||
      (b.subtitle || '').trim() ||
      (b.strukturAdi || '').trim() ||
      (withStatus && b.status) ||
      (hasExtraFields && Object.values(b.extra || {}).some(v => (v || '').trim()))
    );
  }

  function updateBlank(order, field, value) {
    setBlankDrafts(prev => ({
      ...prev,
      [order]: { ...(prev[order] || emptyDraft()), [field]: value }
    }));
  }

  function updateBlankExtra(order, fieldKey, value) {
    setBlankDrafts(prev => ({
      ...prev,
      [order]: {
        ...(prev[order] || emptyDraft()),
        extra: { ...((prev[order] || emptyDraft()).extra), [fieldKey]: value }
      }
    }));
  }

  function commitBlankRow(order, draftOverride) {
    if (!isAdmin || committingRef.current.has(order)) return;
    const blank = draftOverride || blankDrafts[order] || emptyDraft();
    if (!blankHasContent(blank)) return;
    committingRef.current.add(order);
    (async () => {
      try {
        const row = await api.createSheet(kind, {
          title: (blank.title || '').trim(),
          subtitle: (blank.subtitle || '').trim(),
          strukturAdi: (blank.strukturAdi || '').trim(),
          status: withStatus ? (blank.status || null) : null,
          order,
          ...(hasExtraFields ? blank.extra : {})
        });
        setItems(prev => [...prev, row]);
        setBlankDrafts(prev => {
          const cp = { ...prev };
          delete cp[order];
          return cp;
        });
      } catch (e) {
        alert('Xəta: ' + (e.message || 'Əlavə edilmədi'));
      } finally {
        committingRef.current.delete(order);
      }
    })();
  }

  // Commit a blank row only once focus actually leaves that row — not on
  // every field-to-field tab within the same row.
  function handleBlankRowBlur(e, order) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      commitBlankRow(order);
    }
  }

  // Remove one blank slot from the pool. Always leaves at least one blank
  // row visible on the sheet so there's somewhere left to type.
  function removeBlankSlot(order) {
    if (!isAdmin || visibleBlankCount <= 1) return;
    setHiddenBlankOrders(prev => new Set(prev).add(order));
    setBlankDrafts(prev => {
      if (!(order in prev)) return prev;
      const cp = { ...prev };
      delete cp[order];
      return cp;
    });
  }

  async function patchRow(id, patch) {
    if (!isAdmin) return;
    setItems(prev => prev.map(x => Number(x.id) === Number(id) ? { ...x, ...patch } : x));
    try {
      const updated = await api.updateSheet(kind, id, patch);
      setItems(prev => prev.map(x => Number(x.id) === Number(id) ? updated : x));
    } catch (e) {
      alert('Xəta: ' + (e.message || 'Yenilənmədi'));
      await load();
    }
  }

  async function removeRow(id) {
    if (!isAdmin) return;
    if (!confirm('Bu sətir Sheets-dən silinsin? (Əsas siyahıya toxunmur)')) return;
    try {
      await api.deleteSheet(kind, id);
      setItems(prev => prev.filter(x => Number(x.id) !== Number(id)));
    } catch (e) {
      alert('Xəta: ' + (e.message || 'Silinmədi'));
    }
  }

  const linked = (row) => row.itemId != null || row.processId != null;

  const stats = useMemo(() => {
    const byStatus = { progress: 0, done: 0, notdone: 0, sign: 0 };
    let nostatus = 0;
    for (const row of items) {
      if (row.status && byStatus[row.status] != null) byStatus[row.status] += 1;
      else nostatus += 1;
    }
    return { total: items.length, byStatus, nostatus };
  }, [items]);

  function toggleFilter(key) {
    setStatusFilter(prev => (prev === key ? null : key));
  }

  function statusLabel(key) {
    const m = STATUS_META[key];
    return m ? t(m.id, m.default) : '';
  }

  function statusKeyFromLabel(raw) {
    const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    for (const k of STATUS_ORDER) {
      if (k.toLowerCase() === s) return k;
      const m = STATUS_META[k];
      const lab = t(m.id, m.default).trim().toLowerCase();
      const def = String(m.default || '').trim().toLowerCase();
      if (lab === s || def === s) return k;
    }
    // Excel / hand-typed variants (Sheets-diagrams.xlsx etc.)
    const aliases = {
      'planlaşdırılır': 'progress',
      'planlaşdırılmış': 'progress',
      'planlasdirilir': 'progress',
      'planlasdirilmis': 'progress',
      'planned': 'progress',
      'təsdiqlənmiş': 'done',
      'təsdiqlənmişdir': 'done',
      'tesdiqlenmis': 'done',
      'tesdiqlenmisdir': 'done',
      'approved': 'done',
      'done': 'done',
      'müzakirədədir': 'notdone',
      'muzakirededir': 'notdone',
      'qaralama': 'notdone',
      'draft': 'notdone',
      'imza prosesindədir': 'sign',
      'imza prosesində': 'sign',
      'imza prosesinde': 'sign',
      'signature': 'sign'
    };
    if (aliases[s]) return aliases[s];
    // Soft stem match (Planlaşdır… / Təsdiqlən… / İmza…)
    if (s.startsWith('planlaşdır') || s.startsWith('planlasdir')) return 'progress';
    if (s.startsWith('təsdiqlən') || s.startsWith('tesdiqlen')) return 'done';
    if (s.startsWith('müzakirə') || s.startsWith('muzakire') || s.startsWith('qaralama')) return 'notdone';
    if (s.startsWith('imza')) return 'sign';
    return null;
  }

  function handleExport() {
    const headers = [
      '№',
      tByText('İş axışının adı'),
      tByText('Struktur adı'),
      tByText('İş axışının nömrəsi')
    ];
    if (hasExtraFields) headers.push(...EXTRA_FIELDS.map(f => tByText(f.label)));
    if (withStatus) headers.push(tByText('Status'));
    headers.push(tByText('Date'));

    exportSheetToExcel({
      fileTitle: `${tByText(meta.title)}-${kind}`,
      sheetName: tByText(meta.title),
      items,
      hasExtraFields,
      extraFields: EXTRA_FIELDS,
      withStatus,
      statusLabel,
      fmtDate,
      headers
    });
  }

  function handleImportClick() {
    if (!isAdmin || importBusy) return;
    importInputRef.current?.click();
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !isAdmin) return;
    setImportBusy(true);
    try {
      const rows = await importSheetRowsFromExcel(file, {
        hasExtraFields,
        extraFields: EXTRA_FIELDS,
        statusKeyFromLabel
      });
      if (!rows.length) {
        alert('Excel faylında sətir tapılmadı.');
        return;
      }
      // Always ADD: never update/replace an existing row that has the same
      // title/struktur text. Excel order is kept via sequential `order`.
      const baseOrder = items.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0);
      const created = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const row = await api.createSheet(kind, {
          title: r.title,
          subtitle: r.subtitle,
          strukturAdi: r.strukturAdi,
          status: withStatus ? (r.status || null) : null,
          order: baseOrder + i + 1,
          ...(hasExtraFields ? {
            docType: r.docType || '',
            edition: r.edition || '',
            approvalDate: r.approvalDate || '',
            protocol: r.protocol || ''
          } : {})
        });
        created.push(row);
      }
      setItems(prev => [...prev, ...created]);
      alert(`${created.length} sətir əlavə edildi. Mövcud sətirlər saxlanıldı.`);
    } catch (err) {
      alert('Xəta: ' + (err.message || 'İdxal edilmədi'));
    } finally {
      setImportBusy(false);
    }
  }

  function strukturInput(value, onChange, onCommit, placeholder, disabled) {
    return (
      <GridCell
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange}
        onCommit={onCommit}
      />
    );
  }

  const linkedCount = useMemo(
    () => items.filter(x => x.itemId != null || x.processId != null).length,
    [items]
  );

  const isBlankRow = (row) => {
    if (row.itemId != null || row.processId != null) return false; // never touch linked rows here
    if ((row.title || '').trim()) return false;
    if ((row.subtitle || '').trim()) return false;
    if ((row.strukturAdi || '').trim()) return false;
    if (row.status) return false;
    if (hasExtraFields && EXTRA_FIELDS.some(f => (row[f.key] || '').trim())) return false;
    return true;
  };
  const blankCount = useMemo(() => items.filter(isBlankRow).length, [items, hasExtraFields]);

  async function handleClearLinked() {
    if (!isAdmin || linkedCount === 0) return;
    if (!confirm(
      `${linkedCount} avtomatik doldurulmuş (fetch olunmuş) sətir silinsin?\n` +
      `Əl ilə əlavə etdiyiniz sətirlərə toxunulmayacaq.`
    )) return;
    setBusy(true);
    try {
      await api.clearLinkedSheets(kind);
      await load();
    } catch (e) {
      alert('Xəta: ' + (e.message || 'Silinmədi'));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearBlank() {
    if (!isAdmin || blankCount === 0) return;
    if (!confirm(`${blankCount} tamamilə boş sətir silinsin? Bu geri qaytarılmır.`)) return;
    setBusy(true);
    try {
      const toDelete = items.filter(isBlankRow);
      for (const row of toDelete) {
        await api.deleteSheet(kind, row.id);
      }
      await load();
    } catch (e) {
      alert('Xəta: ' + (e.message || 'Silinmədi'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAll() {
    if (!isAdmin || items.length === 0 || busy || importBusy) return;
    if (!confirm(
      `${items.length} sətirin hamısı Sheets-dən silinsin?\n` +
      `Bu geri qaytarılmır. Əsas diaqram/sənəd siyahısına toxunulmur.`
    )) return;
    setBusy(true);
    try {
      await api.clearAllSheets(kind);
      setItems([]);
      setBlankDrafts({});
      setHiddenBlankOrders(new Set());
      setColFilters({});
      setOpenColFilter(null);
      setStatusFilter(null);
    } catch (e) {
      alert('Xəta: ' + (e.message || 'Silinmədi'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheets-page">
      <div className="topbar">
        <div className="top-left">
          <button className="pill-chip back-chip" onClick={onBack}>
            <ChevronLeft size={16} /><span>{tByText('Geri')}</span>
          </button>
          <div className="pill-chip">{fmtTime(now)}</div>
          <div className="pill-chip">{fmtClockDate(now)}</div>
        </div>
        <div className="top-right">
          <button className="logout-btn" onClick={onLogout}>
            <LogOut size={16} /><span>{t('topbar.logout', 'Çıxış')}</span>
          </button>
        </div>
      </div>

      <div className="sheets-wrap">
        <div className="sheets-brand">
          <LogoFull size="large" />
          <h2 className="home-title sheets-title">
            {tByText(meta.title)}
            <span className="sheets-sub">{tByText(meta.sub)}</span>
          </h2>
          <div className="sheets-io-actions">
            <button type="button" className="pill-chip sheets-io-btn" onClick={handleExport}>
              <Download size={14} /><span>{tByText('Excel-ə çıxart')}</span>
            </button>
            {isAdmin && (
              <button
                type="button"
                className="pill-chip sheets-io-btn"
                onClick={handleImportClick}
                disabled={importBusy}
              >
                {importBusy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                <span>{tByText('Excel-dən idxal et')}</span>
              </button>
            )}
            {isAdmin && linkedCount > 0 && (
              <button
                type="button"
                className="pill-chip sheets-io-btn sheets-io-danger"
                onClick={handleClearLinked}
                disabled={busy}
                title="Diaqram/sənəd/şablon siyahısından avtomatik dolan sətirləri sil"
              >
                <Ban size={14} /><span>{tByText('Fetch olunanları təmizlə')} ({linkedCount})</span>
              </button>
            )}
            {isAdmin && blankCount > 0 && (
              <button
                type="button"
                className="pill-chip sheets-io-btn sheets-io-danger"
                onClick={handleClearBlank}
                disabled={busy}
                title="Tamamilə boş (heç nə yazılmamış) sətirləri sil"
              >
                <Trash2 size={14} /><span>{tByText('Boş sətirləri sil')} ({blankCount})</span>
              </button>
            )}
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>
        </div>

        {!error && (
          <div className="sheets-stats">
            <button
              type="button"
              className={`sheets-stat-card total ${!statusFilter ? 'active' : ''}`}
              onClick={() => setStatusFilter(null)}
              disabled={loadUi.show}
            >
              <LayoutGrid size={18} />
              <span className="sheets-stat-text">
                <span className="sheets-stat-num">{stats.total}</span>
                <span className="sheets-stat-label">{tByText('Ümumi say')}</span>
              </span>
            </button>
            {withStatus && STATUS_ORDER.map(k => {
              const m = STATUS_META[k];
              return (
                <button
                  type="button"
                  key={k}
                  className={`sheets-stat-card ${m.cls} ${statusFilter === k ? 'active' : ''}`}
                  onClick={() => toggleFilter(k)}
                  disabled={loadUi.show}
                >
                  <m.Icon size={18} />
                  <span className="sheets-stat-text">
                    <span className="sheets-stat-num">{stats.byStatus[k] || 0}</span>
                    <span className="sheets-stat-label">{t(m.id, m.default)}</span>
                  </span>
                </button>
              );
            })}
            {withStatus && (
              <button
                type="button"
                className={`sheets-stat-card nostatus ${statusFilter === 'nostatus' ? 'active' : ''}`}
                onClick={() => toggleFilter('nostatus')}
                disabled={loadUi.show}
              >
                <Ban size={18} />
                <span className="sheets-stat-text">
                  <span className="sheets-stat-num">{stats.nostatus}</span>
                  <span className="sheets-stat-label">{t('status.none', 'Ləğv edilmiş')}</span>
                </span>
              </button>
            )}
          </div>
        )}

        <div className={`sheets-table-wrap ${loadUi.show ? 'is-loading' : ''}`}>
          {loadUi.show && (
            <div className="sheets-load-overlay" aria-busy="true" aria-live="polite">
              <div className="sheets-load-card">
                <div className="sheets-load-bar">
                  <div
                    className="sheets-load-bar-fill"
                    style={{ width: `${Math.round(loadUi.pct)}%` }}
                  />
                </div>
                <div className="sheets-load-label">
                  {importBusy
                    ? tByText('İdxal olunur…')
                    : busy
                      ? tByText('Gözləyin…')
                      : tByText('Yüklənir…')}
                  <span className="sheets-load-pct">{Math.round(loadUi.pct)}%</span>
                </div>
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="empty-state error">{error}</div>
          )}

          {!error && (
            <>
              <div className="sheets-table-scroll">
                <table className="sheets-table">
                  <thead>
                    <tr>
                      <th className="col-n">
                        {isAdmin && items.length > 0 ? (
                          <button
                            type="button"
                            className="sheets-col-n-clear"
                            title={tByText('Hamısını sil')}
                            aria-label={tByText('Hamısını sil')}
                            disabled={busy || importBusy || loadUi.show}
                            onClick={handleClearAll}
                          >
                            <span className="sheets-col-n-label">№</span>
                            <Trash2 size={12} strokeWidth={2.25} className="sheets-col-n-trash" aria-hidden />
                          </button>
                        ) : (
                          '№'
                        )}
                      </th>
                      {renderColHeader('title', tByText('İş axışının adı'), 'col-title')}
                      {renderColHeader('strukturAdi', tByText('Struktur adı'), 'col-struktur')}
                      {renderColHeader('subtitle', tByText('İş axışının nömrəsi'), 'col-sub')}
                      {hasExtraFields && EXTRA_FIELDS.map(f =>
                        renderColHeader(f.key, tByText(f.label), 'col-extra')
                      )}
                      {withStatus && renderColHeader('status', tByText('Status'), 'col-status')}
                      {renderColHeader('date', tByText('Date'), 'col-date')}
                      {isAdmin && <th className="col-act" aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDisplayRows.map(({ order, row, isBlank }) => (
                      isBlank ? (
                        <tr
                          key={`blank-${order}`}
                          className="sheet-only sheets-blank-row"
                          onBlur={(e) => handleBlankRowBlur(e, order)}
                        >
                          <td className="col-n">{order}</td>
                          <td className="col-title">
                            <GridCell
                              value={row.title}
                              placeholder=""
                              onChange={(v) => updateBlank(order, 'title', v)}
                              onCommit={() => commitBlankRow(order)}
                              commitOnBlur={false}
                            />
                          </td>
                          <td className="col-struktur">
                            <GridCell
                              value={row.strukturAdi}
                              placeholder=""
                              onChange={(v) => updateBlank(order, 'strukturAdi', v)}
                              onCommit={() => commitBlankRow(order)}
                              commitOnBlur={false}
                            />
                          </td>
                          <td className="col-sub">
                            <GridCell
                              value={row.subtitle}
                              placeholder=""
                              onChange={(v) => updateBlank(order, 'subtitle', v)}
                              onCommit={() => commitBlankRow(order)}
                              commitOnBlur={false}
                            />
                          </td>
                          {hasExtraFields && EXTRA_FIELDS.map(f => (
                            <td className="col-extra" key={f.key}>
                              <GridCell
                                value={row.extra[f.key]}
                                placeholder=""
                                onChange={(v) => updateBlankExtra(order, f.key, v)}
                                onCommit={() => commitBlankRow(order)}
                                commitOnBlur={false}
                              />
                            </td>
                          ))}
                          {withStatus && (
                            <td className="col-status">
                              <StatusControl
                                value={row.status}
                                editable
                                onChange={(status) => {
                                  updateBlank(order, 'status', status);
                                  commitBlankRow(order, { ...row, status });
                                }}
                              />
                            </td>
                          )}
                          <td className="col-date">{fmtClockDate(now)}</td>
                          <td className="col-act">
                            {visibleBlankCount > 1 && (
                              <button
                                type="button"
                                className="icon-btn sheets-del"
                                title="Boş sətri sil"
                                onClick={() => removeBlankSlot(order)}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ) : (
                        <tr key={row.id} className={linked(row) ? 'linked' : 'sheet-only'}>
                          <td className="col-n">{order}</td>
                          <td className="col-title">
                            {isAdmin ? (
                              <GridCell
                                value={row.title}
                                placeholder="—"
                                onChange={(v) => setItems(prev => prev.map(x =>
                                  Number(x.id) === Number(row.id) ? { ...x, title: v } : x
                                ))}
                                onCommit={(v) => {
                                  if (v !== (row.title || '')) patchRow(row.id, { title: v });
                                }}
                              />
                            ) : (
                              <span className="sheets-cell-text">{row.title || '—'}</span>
                            )}
                          </td>
                          <td className="col-struktur">
                            {isAdmin ? (
                              strukturInput(
                                row.strukturAdi || '',
                                (v) => setItems(prev => prev.map(x =>
                                  Number(x.id) === Number(row.id) ? { ...x, strukturAdi: v } : x
                                )),
                                (v) => {
                                  if (v !== (row.strukturAdi || '')) patchRow(row.id, { strukturAdi: v });
                                },
                                tByText('Qrup adı…')
                              )
                            ) : (
                              <span className="sheets-cell-text">{row.strukturAdi || '—'}</span>
                            )}
                          </td>
                          <td className="col-sub">
                            {isAdmin ? (
                              <GridCell
                                value={row.subtitle}
                                placeholder="—"
                                onChange={(v) => setItems(prev => prev.map(x =>
                                  Number(x.id) === Number(row.id) ? { ...x, subtitle: v } : x
                                ))}
                                onCommit={(v) => {
                                  if (v !== (row.subtitle || '')) patchRow(row.id, { subtitle: v });
                                }}
                              />
                            ) : (
                              <span className="sheets-cell-text">{row.subtitle || '—'}</span>
                            )}
                          </td>
                          {hasExtraFields && EXTRA_FIELDS.map(f => (
                            <td className="col-extra" key={f.key}>
                              {isAdmin ? (
                                <GridCell
                                  value={row[f.key]}
                                  placeholder=""
                                  onChange={(v) => setItems(prev => prev.map(x =>
                                    Number(x.id) === Number(row.id) ? { ...x, [f.key]: v } : x
                                  ))}
                                  onCommit={(v) => {
                                    if (v !== (row[f.key] || '')) patchRow(row.id, { [f.key]: v });
                                  }}
                                />
                              ) : (
                                <span className="sheets-cell-text">{row[f.key] || '—'}</span>
                              )}
                            </td>
                          ))}
                          {withStatus && (
                            <td className="col-status">
                              <StatusControl
                                value={row.status}
                                editable={isAdmin && !isViewer}
                                onChange={(status) => patchRow(row.id, { status })}
                              />
                            </td>
                          )}
                          <td className="col-date">{fmtDate(row.date)}</td>
                          {isAdmin && (
                            <td className="col-act">
                              <button
                                type="button"
                                className="icon-btn sheets-del"
                                title="Sil"
                                onClick={() => removeRow(row.id)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    ))}
                    {items.length === 0 && !isAdmin && (
                      <tr>
                        <td colSpan={(withStatus ? 7 : 6) + (hasExtraFields ? EXTRA_FIELDS.length : 0)} className="sheets-empty-cell">
                          Sheets boşdur
                        </td>
                      </tr>
                    )}
                    {items.length > 0 && filteredDisplayRows.every(r => r.isBlank) && (
                      <tr>
                        <td colSpan={(withStatus ? 7 : 6) + (hasExtraFields ? EXTRA_FIELDS.length : 0)} className="sheets-empty-cell">
                          {tByText('Bu filtrə uyğun sətir yoxdur')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
