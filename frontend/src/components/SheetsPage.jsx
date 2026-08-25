import { useState, useEffect, useRef, useMemo } from 'react';
import { LogoFull } from './Logo.jsx';
import {
  LogOut, Loader2, Trash2, ChevronLeft, Plus, Download, Upload
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

  const [draftTitle, setDraftTitle] = useState('');
  const [draftStruktur, setDraftStruktur] = useState('');
  const [draftSubtitle, setDraftSubtitle] = useState('');
  const [draftStatus, setDraftStatus] = useState(null);
  const [draftExtra, setDraftExtra] = useState({});
  const [statusFilter, setStatusFilter] = useState(null); // null | 'progress'|'done'|'notdone'|'sign'|'nostatus'
  const [importBusy, setImportBusy] = useState(false);
  const draftTitleRef = useRef(null);
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

  async function commitDraft() {
    if (busy || !isAdmin) return;
    setBusy(true);
    try {
      const row = await api.createSheet(kind, {
        title: draftTitle.trim(),
        subtitle: draftSubtitle.trim(),
        strukturAdi: draftStruktur.trim(),
        status: withStatus ? draftStatus : null,
        ...(hasExtraFields ? draftExtra : {})
      });
      setItems(prev => [...prev, row]);
      setDraftTitle('');
      setDraftStruktur('');
      setDraftSubtitle('');
      setDraftStatus(null);
      setDraftExtra({});
      requestAnimationFrame(() => draftTitleRef.current?.focus());
    } catch (e) {
      alert('Xəta: ' + (e.message || 'Əlavə edilmədi'));
    } finally {
      setBusy(false);
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

  function onDraftKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
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
      <input
        className="sheets-cell-input"
        value={value || ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit?.(value);
          }
        }}
      />
    );
  }

  const draftRow = isAdmin ? (
    <tr className="sheets-draft-row">
      <td className="col-n">
        <button
          type="button"
          className="sheets-plus-btn"
          title="Əlavə et"
          disabled={busy}
          onClick={commitDraft}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
        </button>
      </td>
      <td className="col-title">
        <input
          ref={draftTitleRef}
          className="sheets-cell-input"
          value={draftTitle}
          placeholder={tByText(meta.namePh)}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={onDraftKey}
          disabled={busy}
        />
      </td>
      <td className="col-struktur">
        {strukturInput(
          draftStruktur,
          setDraftStruktur,
          setDraftStruktur,
          tByText('Qrup adı…'),
          busy
        )}
      </td>
      <td className="col-sub">
        <input
          className="sheets-cell-input"
          value={draftSubtitle}
          placeholder={tByText(meta.subPh)}
          onChange={(e) => setDraftSubtitle(e.target.value)}
          onKeyDown={onDraftKey}
          disabled={busy}
        />
      </td>
      {hasExtraFields && EXTRA_FIELDS.map(f => (
        <td className="col-extra" key={f.key}>
          {strukturInput(
            draftExtra[f.key],
            (v) => setDraftExtra(prev => ({ ...prev, [f.key]: v })),
            (v) => setDraftExtra(prev => ({ ...prev, [f.key]: v })),
            tByText(f.ph),
            busy
          )}
        </td>
      ))}
      {withStatus && (
        <td className="col-status">
          <StatusControl
            value={draftStatus}
            editable
            onChange={setDraftStatus}
          />
        </td>
      )}
      <td className="col-date">—</td>
      <td className="col-act">—</td>
    </tr>
  ) : null;

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
                            <input
                              className="sheets-cell-input"
                              value={row.title || ''}
                              onChange={(e) => setItems(prev => prev.map(x =>
                                Number(x.id) === Number(row.id) ? { ...x, title: e.target.value } : x
                              ))}
                              onBlur={(e) => {
                                if (e.target.value !== (row.title || '')) {
                                  patchRow(row.id, { title: e.target.value });
                                }
                              }}
                            />
                          ) : (
                            <span>{row.title || '—'}</span>
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
                            <span>{row.strukturAdi || '—'}</span>
                          )}
                        </td>
                        <td className="col-sub">
                          {isAdmin ? (
                            <input
                              className="sheets-cell-input"
                              value={row.subtitle || ''}
                              placeholder="—"
                              onChange={(e) => setItems(prev => prev.map(x =>
                                Number(x.id) === Number(row.id) ? { ...x, subtitle: e.target.value } : x
                              ))}
                              onBlur={(e) => {
                                if (e.target.value !== (row.subtitle || '')) {
                                  patchRow(row.id, { subtitle: e.target.value });
                                }
                              }}
                            />
                          ) : (
                            <span>{row.subtitle || '—'}</span>
                          )}
                        </td>
                        {hasExtraFields && EXTRA_FIELDS.map(f => (
                          <td className="col-extra" key={f.key}>
                            {isAdmin ? (
                              <input
                                className="sheets-cell-input"
                                value={row[f.key] || ''}
                                placeholder={tByText(f.ph)}
                                onChange={(e) => setItems(prev => prev.map(x =>
                                  Number(x.id) === Number(row.id) ? { ...x, [f.key]: e.target.value } : x
                                ))}
                                onBlur={(e) => {
                                  if (e.target.value !== (row[f.key] || '')) {
                                    patchRow(row.id, { [f.key]: e.target.value });
                                  }
                                }}
                              />
                            ) : (
                              <span>{row[f.key] || '—'}</span>
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
                  </tbody>
                </table>
              </div>

              {isAdmin && (
                <div className="sheets-draft-foot">
                  <table className="sheets-table sheets-draft-table">
                    <tbody>{draftRow}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
