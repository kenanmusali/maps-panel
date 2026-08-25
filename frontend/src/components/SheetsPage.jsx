import { useState, useEffect, useRef, useMemo } from 'react';
import { LogoFull } from './Logo.jsx';
import {
  LogOut, Loader2, Trash2, ChevronLeft, Download, Upload
} from './icons.jsx';
import { LayoutGrid, Ban } from 'lucide-react';
import { api } from '../api/client.js';
import { StatusControl, STATUS_META, STATUS_ORDER } from './Status.jsx';
import { useLabels } from '../labels/LabelsContext.jsx';
import { exportSheetToExcel, importSheetRowsFromExcel } from './sheetsExcel.js';

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
const DEFAULT_BLANK_ROWS = 15;

let blankSeq = 0;
function makeBlankRow() {
  return { key: `blank-${++blankSeq}`, title: '', subtitle: '', strukturAdi: '', status: null, extra: {} };
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
    namePh: 'Yeni diaqram adı…',
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

  const [pendingBlanks, setPendingBlanks] = useState(() => (isAdmin ? Array.from({ length: DEFAULT_BLANK_ROWS }, makeBlankRow) : []));
  const [statusFilter, setStatusFilter] = useState(null); // null | 'progress'|'done'|'notdone'|'sign'|'nostatus'
  const [importBusy, setImportBusy] = useState(false);
  const committingRef = useRef(new Set());
  const importInputRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

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

  // Reset the blank-row pool whenever the sheet kind changes.
  useEffect(() => {
    setPendingBlanks(isAdmin ? Array.from({ length: DEFAULT_BLANK_ROWS }, makeBlankRow) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, isAdmin]);

  // Keep the trailing blank-row pool topped up: once real rows fill the
  // default pool, always keep exactly one empty row after the last one.
  useEffect(() => {
    if (!isAdmin) return;
    const desired = Math.max(items.length + 1, DEFAULT_BLANK_ROWS) - items.length;
    setPendingBlanks(prev => {
      if (prev.length === desired) return prev;
      if (prev.length < desired) {
        return [...prev, ...Array.from({ length: desired - prev.length }, makeBlankRow)];
      }
      return prev.slice(0, desired);
    });
  }, [items.length, isAdmin]);

  function blankHasContent(b) {
    return !!(
      (b.title || '').trim() ||
      (b.subtitle || '').trim() ||
      (b.strukturAdi || '').trim() ||
      (withStatus && b.status) ||
      (hasExtraFields && Object.values(b.extra || {}).some(v => (v || '').trim()))
    );
  }

  function updateBlank(key, field, value) {
    setPendingBlanks(prev => prev.map(b => (b.key === key ? { ...b, [field]: value } : b)));
  }

  function updateBlankExtra(key, fieldKey, value) {
    setPendingBlanks(prev => prev.map(b => (
      b.key === key ? { ...b, extra: { ...b.extra, [fieldKey]: value } } : b
    )));
  }

  function commitBlankRow(blank) {
    if (!isAdmin || committingRef.current.has(blank.key)) return;
    if (!blankHasContent(blank)) return;
    committingRef.current.add(blank.key);
    (async () => {
      try {
        const row = await api.createSheet(kind, {
          title: (blank.title || '').trim(),
          subtitle: (blank.subtitle || '').trim(),
          strukturAdi: (blank.strukturAdi || '').trim(),
          status: withStatus ? (blank.status || null) : null,
          ...(hasExtraFields ? blank.extra : {})
        });
        setItems(prev => [...prev, row]);
        setPendingBlanks(prev => prev.filter(b => b.key !== blank.key));
      } catch (e) {
        alert('Xəta: ' + (e.message || 'Əlavə edilmədi'));
      } finally {
        committingRef.current.delete(blank.key);
      }
    })();
  }

  // Commit a blank row only once focus actually leaves that row — not on
  // every field-to-field tab within the same row.
  function handleBlankRowBlur(e, blank) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      commitBlankRow(blank);
    }
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

  const filteredItems = useMemo(() => {
    if (!statusFilter) return items;
    if (statusFilter === 'nostatus') return items.filter(x => !x.status);
    return items.filter(x => x.status === statusFilter);
  }, [items, statusFilter]);

  function toggleFilter(key) {
    setStatusFilter(prev => (prev === key ? null : key));
  }

  function statusLabel(key) {
    const m = STATUS_META[key];
    return m ? t(m.id, m.default) : '';
  }

  function statusKeyFromLabel(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return null;
    for (const k of STATUS_ORDER) {
      if (k.toLowerCase() === s) return k;
      const m = STATUS_META[k];
      if (t(m.id, m.default).toLowerCase() === s || m.default.toLowerCase() === s) return k;
    }
    return null;
  }

  function handleExport() {
    exportSheetToExcel({
      fileTitle: `${tByText(meta.title)}-${kind}`,
      sheetName: tByText(meta.title),
      items,
      hasExtraFields,
      extraFields: EXTRA_FIELDS,
      withStatus,
      statusLabel,
      fmtDate
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
      // Additive: create each parsed row as a new sheet row. Existing
      // rows are never touched or deleted.
      for (const r of rows) {
        const created = await api.createSheet(kind, {
          title: r.title,
          subtitle: r.subtitle,
          strukturAdi: r.strukturAdi,
          status: withStatus ? (r.status || null) : null,
          ...(hasExtraFields ? {
            docType: r.docType || '',
            edition: r.edition || '',
            approvalDate: r.approvalDate || '',
            protocol: r.protocol || ''
          } : {})
        });
        setItems(prev => [...prev, created]);
      }
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

        {!loading && !error && (
          <div className="sheets-stats">
            <button
              type="button"
              className={`sheets-stat-card total ${!statusFilter ? 'active' : ''}`}
              onClick={() => setStatusFilter(null)}
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
              >
                <Ban size={18} />
                <span className="sheets-stat-text">
                  <span className="sheets-stat-num">{stats.nostatus}</span>
                  <span className="sheets-stat-label">{tByText('Statussuz')}</span>
                </span>
              </button>
            )}
          </div>
        )}

        <div className="sheets-table-wrap">
          {loading && (
            <div className="empty-state"><Loader2 size={20} className="spin" />Yüklənir...</div>
          )}
          {error && !loading && (
            <div className="empty-state error">{error}</div>
          )}

          {!loading && !error && (
            <>
              <div className="sheets-table-scroll">
                <table className="sheets-table">
                  <thead>
                    <tr>
                      <th className="col-n">№</th>
                      <th className="col-title">{tByText('Diaqram adı')}</th>
                      <th className="col-struktur">{tByText('Struktur adı')}</th>
                      <th className="col-sub">{tByText('İkinci ad (qısa)')}</th>
                      {hasExtraFields && EXTRA_FIELDS.map(f => (
                        <th className="col-extra" key={f.key}>{tByText(f.label)}</th>
                      ))}
                      {withStatus && <th className="col-status">{tByText('Status')}</th>}
                      <th className="col-date">{tByText('Date')}</th>
                      {isAdmin && <th className="col-act" aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((row, i) => (
                      <tr key={row.id} className={linked(row) ? 'linked' : 'sheet-only'}>
                        <td className="col-n">{i + 1}</td>
                        <td className="col-title">
                          {isAdmin ? (
                            <GridCell
                              value={row.title}
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
                                placeholder={tByText(f.ph)}
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
                    ))}
                    {items.length === 0 && !isAdmin && (
                      <tr>
                        <td colSpan={(withStatus ? 7 : 6) + (hasExtraFields ? EXTRA_FIELDS.length : 0)} className="sheets-empty-cell">
                          Sheets boşdur
                        </td>
                      </tr>
                    )}
                    {items.length > 0 && filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={(withStatus ? 7 : 6) + (hasExtraFields ? EXTRA_FIELDS.length : 0)} className="sheets-empty-cell">
                          {tByText('Bu filtrə uyğun sətir yoxdur')}
                        </td>
                      </tr>
                    )}
                    {isAdmin && pendingBlanks.map((blank, bi) => (
                      <tr
                        key={blank.key}
                        className="sheet-only sheets-blank-row"
                        onBlur={(e) => handleBlankRowBlur(e, blank)}
                      >
                        <td className="col-n">{items.length + bi + 1}</td>
                        <td className="col-title">
                          <GridCell
                            value={blank.title}
                            placeholder={tByText(meta.namePh)}
                            onChange={(v) => updateBlank(blank.key, 'title', v)}
                            onCommit={() => commitBlankRow(blank)}
                            commitOnBlur={false}
                          />
                        </td>
                        <td className="col-struktur">
                          <GridCell
                            value={blank.strukturAdi}
                            placeholder={tByText('Qrup adı…')}
                            onChange={(v) => updateBlank(blank.key, 'strukturAdi', v)}
                            onCommit={() => commitBlankRow(blank)}
                            commitOnBlur={false}
                          />
                        </td>
                        <td className="col-sub">
                          <GridCell
                            value={blank.subtitle}
                            placeholder={tByText(meta.subPh)}
                            onChange={(v) => updateBlank(blank.key, 'subtitle', v)}
                            onCommit={() => commitBlankRow(blank)}
                            commitOnBlur={false}
                          />
                        </td>
                        {hasExtraFields && EXTRA_FIELDS.map(f => (
                          <td className="col-extra" key={f.key}>
                            <GridCell
                              value={blank.extra[f.key]}
                              placeholder={tByText(f.ph)}
                              onChange={(v) => updateBlankExtra(blank.key, f.key, v)}
                              onCommit={() => commitBlankRow(blank)}
                              commitOnBlur={false}
                            />
                          </td>
                        ))}
                        {withStatus && (
                          <td className="col-status">
                            <StatusControl
                              value={blank.status}
                              editable
                              onChange={(status) => {
                                updateBlank(blank.key, 'status', status);
                                commitBlankRow({ ...blank, status });
                              }}
                            />
                          </td>
                        )}
                        <td className="col-date">—</td>
                        <td className="col-act">—</td>
                      </tr>
                    ))}
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
