/*
  Diagram Sheets catalog — separate from İş Axışları groups/processes.

  Sheet-only rows (processId=null) are a raw checklist. Creating a diagram in
  İş Axışları upserts a linked row (processId set). Adding here never creates
  a process.
*/

import { getFile, putFile, attribution } from './store.js';

const ALLOWED_STATUS = ['progress', 'done', 'notdone', 'sign'];

const dataPath = () => (process.env.DATA_PATH || 'data').replace(/^\/|\/$/g, '');
export const sheetsPath = () => `${dataPath()}/diagrams/sheets.json`;
const indexPath = () => `${dataPath()}/diagrams/index.json`;

export { ALLOWED_STATUS };

function nextId(list) {
  const ids = (list || []).map(x => Number(x.id)).filter(Number.isFinite);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function normalizeStatus(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  return ALLOWED_STATUS.includes(s) ? s : null;
}

export async function readSheets() {
  const file = await getFile(sheetsPath());
  const c = file ? file.content : null;
  return (c && Array.isArray(c.items)) ? { items: c.items } : { items: [] };
}

export async function writeSheets(content, message, user) {
  return putFile(sheetsPath(), content, attribution(user, message));
}

/** One-time seed from diagrams index when sheets is empty. */
export async function backfillFromProcesses(user) {
  const sheets = await readSheets();
  if (sheets.items.length) return sheets;

  const idxFile = await getFile(indexPath());
  const processes = Array.isArray(idxFile?.content?.processes) ? idxFile.content.processes : [];
  if (!processes.length) return sheets;

  const now = new Date().toISOString();
  sheets.items = processes.map((p, i) => ({
    id: i + 1,
    title: String(p.title || ''),
    subtitle: String(p.subtitle || ''),
    status: normalizeStatus(p.status),
    date: now,
    processId: Number(p.id)
  }));
  await writeSheets(sheets, 'Backfill sheets from diagrams', user);
  return sheets;
}

/**
 * Upsert a sheet row from an İş Axışları process.
 * - If sheetId is given, link/update that row (used when picking from Sheets).
 * - Else find by processId and update, or insert a new linked row.
 */
export async function syncFromProcess({ processId, title, subtitle, status, sheetId }, user) {
  const pid = Number(processId);
  if (!Number.isFinite(pid)) return null;

  const sheets = await readSheets();
  const now = new Date().toISOString();
  const st = status === undefined ? undefined : normalizeStatus(status);

  let row = null;
  if (sheetId != null && Number.isFinite(Number(sheetId))) {
    row = sheets.items.find(x => Number(x.id) === Number(sheetId)) || null;
  }
  if (!row) {
    row = sheets.items.find(x => Number(x.processId) === pid) || null;
  }

  if (row) {
    if (typeof title === 'string') row.title = title;
    if (typeof subtitle === 'string') row.subtitle = subtitle;
    if (st !== undefined) {
      if (st === null) delete row.status;
      else row.status = st;
    }
    row.processId = pid;
    await writeSheets(sheets, `Sync sheet ${row.id} from process ${pid}`, user);
    return row;
  }

  const item = {
    id: nextId(sheets.items),
    title: typeof title === 'string' ? title : '',
    subtitle: typeof subtitle === 'string' ? subtitle : '',
    status: st === undefined ? null : st,
    date: now,
    processId: pid
  };
  if (item.status == null) delete item.status;
  sheets.items = [...sheets.items, item];
  await writeSheets(sheets, `Add sheet for process ${pid}`, user);
  return item;
}

export async function createSheetRow({ title, subtitle, status }, user) {
  const name = String(title || '').trim();
  if (!name) {
    const err = new Error('Diaqram adı teleb olunur');
    err.status = 400;
    throw err;
  }
  const sheets = await readSheets();
  const item = {
    id: nextId(sheets.items),
    title: name,
    subtitle: subtitle != null ? String(subtitle) : '',
    status: normalizeStatus(status),
    date: new Date().toISOString(),
    processId: null
  };
  if (item.status == null) delete item.status;
  sheets.items = [...sheets.items, item];
  await writeSheets(sheets, `Create sheet row ${item.id}`, user);
  return item;
}

export async function updateSheetRow(id, patch, user) {
  const sheets = await readSheets();
  const row = sheets.items.find(x => Number(x.id) === Number(id));
  if (!row) {
    const err = new Error('Sheet row not found');
    err.status = 404;
    throw err;
  }
  if (typeof patch.title === 'string') row.title = patch.title.trim() || row.title;
  if (typeof patch.subtitle === 'string') row.subtitle = patch.subtitle;
  if (patch.status !== undefined) {
    const st = normalizeStatus(patch.status);
    if (st === null) delete row.status;
    else row.status = st;
  }
  if (patch.processId !== undefined) {
    row.processId = patch.processId == null || patch.processId === ''
      ? null
      : Number(patch.processId);
  }
  await writeSheets(sheets, `Update sheet row ${id}`, user);
  return row;
}

export async function deleteSheetRow(id, user) {
  const sheets = await readSheets();
  const before = sheets.items.length;
  sheets.items = sheets.items.filter(x => Number(x.id) !== Number(id));
  if (sheets.items.length === before) {
    const err = new Error('Sheet row not found');
    err.status = 404;
    throw err;
  }
  await writeSheets(sheets, `Delete sheet row ${id}`, user);
  return { ok: true };
}
