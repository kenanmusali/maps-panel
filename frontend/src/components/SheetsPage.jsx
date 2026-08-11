import { useState, useEffect, useRef } from 'react';
import { LogoFull } from './Logo.jsx';
import {
  LogOut, Loader2, Trash2, ChevronLeft, Plus
} from './icons.jsx';
import { FileSpreadsheet } from 'lucide-react';
import { api } from '../api/client.js';
import { StatusControl } from './Status.jsx';
import { useLabels } from '../labels/LabelsContext.jsx';

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

export default function SheetsPage({ onBack, onLogout }) {
  const { t, tByText } = useLabels();
  const role = localStorage.getItem('role');
  const isAdmin = role === 'admin';
  const isViewer = role === 'viewer' || role === 'editor_2';

  const [now, setNow] = useState(new Date());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Draft row for quick-add (title required to commit)
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubtitle, setDraftSubtitle] = useState('');
  const [draftStatus, setDraftStatus] = useState(null);
  const draftTitleRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listSheets();
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setError(e.message || 'Yüklənmədi');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function commitDraft() {
    const title = draftTitle.trim();
    if (!title || busy || !isAdmin) return;
    setBusy(true);
    try {
      const row = await api.createSheet({
        title,
        subtitle: draftSubtitle.trim(),
        status: draftStatus
      });
      setItems(prev => [...prev, row]);
      setDraftTitle('');
      setDraftSubtitle('');
      setDraftStatus(null);
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
      const updated = await api.updateSheet(id, patch);
      setItems(prev => prev.map(x => Number(x.id) === Number(id) ? updated : x));
    } catch (e) {
      alert('Xəta: ' + (e.message || 'Yenilənmədi'));
      await load();
    }
  }

  async function removeRow(id) {
    if (!isAdmin) return;
    if (!confirm('Bu sətir Sheets-dən silinsin? (İş Axışları diaqramına toxunmur)')) return;
    try {
      await api.deleteSheet(id);
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

  return (
    <>
      <div className="topbar">
        <div className="left">
          <button className="back-btn" onClick={onBack} title="Geri">
            <ChevronLeft size={18} />
            <span>{t('topbar.back', 'Geri')}</span>
          </button>
          <span className="time">{fmtTime(now)}</span>
          <span className="date">{fmtClockDate(now)}</span>
        </div>
        <div className="right">
          <button className="logout-btn" onClick={onLogout}>
            <LogOut size={16} /><span>{t('topbar.logout', 'Çıxış')}</span>
          </button>
        </div>
      </div>

      <div className="home-wrap sheets-wrap">
        <LogoFull size="large" />
        <h2 className="home-title">
          {tByText('Sheets')}
          <span className="sheets-sub">{tByText('Diaqram kataloqu — İş Axışlarından ayrıca')}</span>
        </h2>

        <div className="sheets-table-wrap">
          {loading && (
            <div className="empty-state"><Loader2 size={20} className="spin" />Yüklənir...</div>
          )}
          {error && !loading && (
            <div className="empty-state error">{error}</div>
          )}

          {!loading && !error && (
            <table className="sheets-table">
              <thead>
                <tr>
                  <th className="col-n">N</th>
                  <th className="col-title">{tByText('Diaqram adı')}</th>
                  <th className="col-sub">{tByText('İkinci ad (qısa)')}</th>
                  <th className="col-status">{tByText('Status')}</th>
                  <th className="col-date">{tByText('Date')}</th>
                  {isAdmin && <th className="col-act" aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <tr key={row.id} className={row.processId ? 'linked' : 'sheet-only'}>
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
                            const v = e.target.value.trim();
                            if (v && v !== (row.title || '').trim()) patchRow(row.id, { title: v });
                            else if (!v) load();
                          }}
                        />
                      ) : (
                        <span>{row.title}</span>
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
                    <td className="col-status">
                      <StatusControl
                        value={row.status}
                        editable={isAdmin && !isViewer}
                        onChange={(status) => patchRow(row.id, { status })}
                      />
                    </td>
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

                {isAdmin && (
                  <tr className="sheets-draft-row">
                    <td className="col-n">
                      <Plus size={14} />
                    </td>
                    <td className="col-title">
                      <input
                        ref={draftTitleRef}
                        className="sheets-cell-input"
                        value={draftTitle}
                        placeholder={tByText('Yeni diaqram adı…')}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={onDraftKey}
                        disabled={busy}
                      />
                    </td>
                    <td className="col-sub">
                      <input
                        className="sheets-cell-input"
                        value={draftSubtitle}
                        placeholder={tByText('İkinci ad…')}
                        onChange={(e) => setDraftSubtitle(e.target.value)}
                        onKeyDown={onDraftKey}
                        disabled={busy}
                      />
                    </td>
                    <td className="col-status">
                      <StatusControl
                        value={draftStatus}
                        editable
                        onChange={setDraftStatus}
                      />
                    </td>
                    <td className="col-date">—</td>
                    <td className="col-act">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Əlavə et"
                        disabled={busy || !draftTitle.trim()}
                        onClick={commitDraft}
                      >
                        {busy ? <Loader2 size={15} className="spin" /> : <FileSpreadsheet size={15} />}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {!loading && !error && items.length === 0 && !isAdmin && (
            <div className="empty-state">Sheets boşdur</div>
          )}
        </div>
      </div>
    </>
  );
}
