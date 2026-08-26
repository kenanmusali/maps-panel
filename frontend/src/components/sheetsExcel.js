// sheetsExcel.js
// Export / import the Sheets catalog TABLE (title, struktur, status, extra
// fields…) to/from a plain .xlsx workbook. This is separate from excel.js,
// which exports/imports a diagram's canvas (lanes/nodes/edges).
//
// Import is always ADDITIVE: parsed rows are handed back to the caller as
// plain objects, which the page then creates one-by-one as new blank sheet
// rows. Existing rows are never touched or removed.
//
// Export is styled to look like a normal Excel sheet (bold dark-blue
// header with a blue underline, thin gridlines on every cell, white
// background) — done with exceljs since plain 'xlsx' (SheetJS community)
// can't write cell styling. Import still uses 'xlsx' — it only needs to
// read values, not styles.
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

function safeName(s) {
  return (s || 'sheets').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
}

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s_().]+/g, '');
}

const GRID_BORDER = { style: 'thin', color: { argb: 'FFB7C6D9' } };
const HEADER_FONT = { bold: true, color: { argb: 'FF1F4E78' }, size: 11 };
const HEADER_BOTTOM_BORDER = { style: 'medium', color: { argb: 'FF2F6FA8' } };

/* ============================ EXPORT ============================ */
export async function exportSheetToExcel({
  fileTitle,
  sheetName,
  items,
  hasExtraFields,
  extraFields,
  withStatus,
  statusLabel,
  fmtDate
}) {
  const header = ['№', 'Ad', 'Struktur adı', 'İkinci ad'];
  if (hasExtraFields) header.push(...extraFields.map(f => f.label));
  if (withStatus) header.push('Status');
  header.push('Tarix');

  const rows = (items || []).map((row, i) => {
    const r = [i + 1, row.title || '', row.strukturAdi || '', row.subtitle || ''];
    if (hasExtraFields) extraFields.forEach(f => r.push(row[f.key] || ''));
    if (withStatus) r.push(row.status ? statusLabel(row.status) : '');
    r.push(fmtDate ? fmtDate(row.date) : (row.date || ''));
    return r;
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet((sheetName || 'Sheets').slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  ws.columns = header.map(h => ({ width: Math.max(14, Math.min(32, h.length + 6)) }));

  const headerRow = ws.addRow(header);
  headerRow.eachCell(cell => {
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      top: GRID_BORDER, left: GRID_BORDER, right: GRID_BORDER, bottom: HEADER_BOTTOM_BORDER
    };
  });

  for (const r of rows) {
    const row = ws.addRow(r);
    row.eachCell((cell, colNumber) => {
      cell.font = { color: { argb: 'FF1F2937' }, size: 11 };
      cell.alignment = colNumber === 1
        ? { vertical: 'middle', horizontal: 'center' }
        : { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = { top: GRID_BORDER, left: GRID_BORDER, right: GRID_BORDER, bottom: GRID_BORDER };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(fileTitle)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ============================ IMPORT ============================ */
// Returns an array of plain row objects: { title, strukturAdi, subtitle, status?, ...extras }
// Never mutates or deletes anything — purely parses the file.
export async function importSheetRowsFromExcel(file, { hasExtraFields, extraFields, statusKeyFromLabel }) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  if (!aoa.length) return [];

  const headers = aoa[0].map(norm);
  const idx = (names) => {
    for (const n of names) {
      const i = headers.indexOf(norm(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const iTitle = idx(['ad', 'title', 'diaqramadı', 'sənədadı', 'senedadi', 'şablonadı', 'sablonadi']);
  const iStruktur = idx(['strukturadı', 'strukturadi', 'struktur']);
  const iSub = idx(['ikinciad', 'ikinciadqısa', 'subtitle']);
  const iStatus = idx(['status']);

  const extraIdx = {};
  if (hasExtraFields) {
    for (const f of extraFields) extraIdx[f.key] = idx([f.label]);
  }

  const out = [];
  for (const r of aoa.slice(1)) {
    if (!r || r.every(v => v == null || String(v).trim() === '')) continue;
    const row = {
      title: iTitle !== -1 ? String(r[iTitle] ?? '').trim() : '',
      strukturAdi: iStruktur !== -1 ? String(r[iStruktur] ?? '').trim() : '',
      subtitle: iSub !== -1 ? String(r[iSub] ?? '').trim() : ''
    };
    if (hasExtraFields) {
      for (const f of extraFields) {
        const i = extraIdx[f.key];
        if (i !== -1) row[f.key] = String(r[i] ?? '').trim();
      }
    }
    if (iStatus !== -1 && statusKeyFromLabel) {
      const key = statusKeyFromLabel(String(r[iStatus] ?? '').trim());
      if (key) row.status = key;
    }
    out.push(row);
  }
  return out;
}
