/*
  Per-section Sheets catalogs (Mongo via store.js — never GitHub).

  Kinds:
    diagrams  → data/diagrams/sheets.json   (İş Axışları)
    pdfs      → data/files/sheets.json      (Normativ Sənədlər)
    templates → data/templates/sheets.json  (Şablonlar)

  Sheet-only rows (itemId=null) are a raw checklist. Creating an item in the
  matching section upserts a linked row. Adding here never creates the item.
*/

import { getFile as mongoGet, putFile as mongoPut, attribution } from './store.js';
import { getFile as githubGet } from './github.js';

const ALLOWED_STATUS = ['progress', 'done', 'notdone', 'sign'];
const dataPath = () => (process.env.DATA_PATH || 'data').replace(/^\/|\/$/g, '');

export const SHEET_KINDS = {
  diagrams: {
    sheetsRel: 'diagrams/sheets.json',
    indexRel: 'diagrams/index.json',
    indexKey: 'processes',
    indexVia: 'mongo',
    label: 'diagrams'
  },
  pdfs: {
    sheetsRel: 'files/sheets.json',
    indexRel: 'files/index.json',
    indexKey: 'pdfs',
    indexVia: 'github',
    label: 'pdfs'
  },
  templates: {
    sheetsRel: 'templates/sheets.json',
    indexRel: 'templates/index.json',
    // templates index reuses the same shape as pdfs ({ groups, pdfs })
    indexKey: 'pdfs',
    indexVia: 'github',
    label: 'templates'
  }
};

export { ALLOWED_STATUS };

export function assertKind(kind) {
  if (!SHEET_KINDS[kind]) {
    const err = new Error('Yanlış sheets kind');
    err.status = 400;
    throw err;
  }
  return SHEET_KINDS[kind];
}

function sheetsPath(kind) {
  return `${dataPath()}/${assertKind(kind).sheetsRel}`;
}
function indexPath(kind) {
  return `${dataPath()}/${assertKind(kind).indexRel}`;
}

function nextId(list) {
  const ids = (list || []).map(x => Number(x.id)).filter(Number.isFinite);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function normalizeStatus(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  return ALLOWED_STATUS.includes(s) ? s : null;
}

/** Normalize legacy processId → itemId */
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const itemId = row.itemId != null
    ? row.itemId
    : (row.processId != null ? row.processId : null);
  return { ...row, itemId, processId: itemId };
}

export async function readSheets(kind) {
  assertKind(kind);
  const file = await mongoGet(sheetsPath(kind));
  const c = file ? file.content : null;
  const items = (c && Array.isArray(c.items)) ? c.items.map(normalizeRow) : [];
  return { items };
}

export async function writeSheets(kind, content, message, user) {
  assertKind(kind);
  return mongoPut(sheetsPath(kind), content, attribution(user, message));
}

async function readIndexFile(kind) {
  const meta = assertKind(kind);
  const p = indexPath(kind);
  if (meta.indexVia === 'github') return githubGet(p);
  return mongoGet(p);
}

/** One-time seed from the section index when sheets is empty. */
export async function backfillFromIndex(kind, user) {
  const meta = assertKind(kind);
  let sheets = await readSheets(kind);

  const idxFile = await readIndexFile(kind);
  const content = idxFile?.content || {};
  const list = Array.isArray(content[meta.indexKey]) ? content[meta.indexKey] : [];
  const groups = Array.isArray(content.groups) ? content.groups : [];

  function strukturFor(entry) {
    const g = groups.find(x => Number(x.id) === Number(entry?.groupId));
    return g?.name ? String(g.name) : '';
  }

  if (!sheets.items.length && list.length) {
    const now = new Date().toISOString();
    sheets.items = list.map((p, i) => {
      const id = Number(p.id);
      return {
        id: i + 1,
        title: String(p.title || ''),
        subtitle: String(p.subtitle || ''),
        strukturAdi: strukturFor(p),
        status: normalizeStatus(p.status),
        date: now,
        itemId: id,
        processId: id
      };
    });
    await writeSheets(kind, sheets, `Backfill ${kind} sheets from index`, user);
    return sheets;
  }

  // Repair: fill missing strukturAdi from group name for linked rows
  let changed = false;
  for (const row of sheets.items) {
    if ((row.strukturAdi || '').trim()) continue;
    const iid = row.itemId ?? row.processId;
    if (iid == null) continue;
    const entry = list.find(p => Number(p.id) === Number(iid));
    const name = strukturFor(entry || {});
    if (name) {
      row.strukturAdi = name;
      changed = true;
    }
  }
  if (changed) {
    await writeSheets(kind, sheets, `Fill strukturAdi on ${kind} sheets`, user);
  }
  return sheets;
}

/**
 * Upsert a sheet row from a section item (diagram / pdf / template).
 */
export async function syncFromItem(kind, { itemId, title, subtitle, status, sheetId, strukturAdi }, user) {
  assertKind(kind);
  const iid = Number(itemId);
  if (!Number.isFinite(iid)) return null;

  const sheets = await readSheets(kind);
  const now = new Date().toISOString();
  const st = status === undefined ? undefined : normalizeStatus(status);
  const struktur = strukturAdi != null ? String(strukturAdi) : undefined;

  let row = null;
  if (sheetId != null && Number.isFinite(Number(sheetId))) {
    row = sheets.items.find(x => Number(x.id) === Number(sheetId)) || null;
  }
  if (!row) {
    row = sheets.items.find(x => Number(x.itemId ?? x.processId) === iid) || null;
  }

  if (row) {
    if (typeof title === 'string') row.title = title;
    if (typeof subtitle === 'string') row.subtitle = subtitle;
    if (st !== undefined) {
      if (st === null) delete row.status;
      else row.status = st;
    }
    // Keep existing custom struktur; only fill when blank
    if (struktur !== undefined && !(row.strukturAdi || '').trim()) {
      row.strukturAdi = struktur;
    }
    row.itemId = iid;
    row.processId = iid;
    await writeSheets(kind, sheets, `Sync ${kind} sheet ${row.id} from item ${iid}`, user);
    return normalizeRow(row);
  }

  const item = {
    id: nextId(sheets.items),
    title: typeof title === 'string' ? title : '',
    subtitle: typeof subtitle === 'string' ? subtitle : '',
    strukturAdi: struktur || '',
    status: st === undefined ? null : st,
    date: now,
    itemId: iid,
    processId: iid
  };
  if (item.status == null) delete item.status;
  sheets.items = [...sheets.items, item];
  await writeSheets(kind, sheets, `Add ${kind} sheet for item ${iid}`, user);
  return normalizeRow(item);
}

/** @deprecated use syncFromItem('diagrams', …) */
export async function syncFromProcess(opts, user) {
  return syncFromItem('diagrams', {
    itemId: opts.processId,
    title: opts.title,
    subtitle: opts.subtitle,
    status: opts.status,
    sheetId: opts.sheetId,
    strukturAdi: opts.strukturAdi
  }, user);
}

/** @deprecated use backfillFromIndex('diagrams', …) */
export async function backfillFromProcesses(user) {
  return backfillFromIndex('diagrams', user);
}

export async function createSheetRow(kind, { title, subtitle, status, strukturAdi }, user) {
  assertKind(kind);
  // Empty title allowed — plus button must work even when fields are blank.
  const name = title != null ? String(title).trim() : '';
  const sheets = await readSheets(kind);
  const item = {
    id: nextId(sheets.items),
    title: name,
    subtitle: subtitle != null ? String(subtitle) : '',
    strukturAdi: strukturAdi != null ? String(strukturAdi).trim() : '',
    status: normalizeStatus(status),
    date: new Date().toISOString(),
    itemId: null,
    processId: null
  };
  if (item.status == null) delete item.status;
  sheets.items = [...sheets.items, item];
  await writeSheets(kind, sheets, `Create ${kind} sheet row ${item.id}`, user);
  return normalizeRow(item);
}

export async function updateSheetRow(kind, id, patch, user) {
  assertKind(kind);
  const sheets = await readSheets(kind);
  const row = sheets.items.find(x => Number(x.id) === Number(id));
  if (!row) {
    const err = new Error('Sheet row not found');
    err.status = 404;
    throw err;
  }
  if (typeof patch.title === 'string') row.title = patch.title; // allow empty
  if (typeof patch.subtitle === 'string') row.subtitle = patch.subtitle;
  if (typeof patch.strukturAdi === 'string') row.strukturAdi = patch.strukturAdi;
  if (patch.status !== undefined) {
    const st = normalizeStatus(patch.status);
    if (st === null) delete row.status;
    else row.status = st;
  }
  if (patch.itemId !== undefined || patch.processId !== undefined) {
    const raw = patch.itemId !== undefined ? patch.itemId : patch.processId;
    const v = raw == null || raw === '' ? null : Number(raw);
    row.itemId = v;
    row.processId = v;
  }
  await writeSheets(kind, sheets, `Update ${kind} sheet row ${id}`, user);
  return normalizeRow(row);
}

export async function deleteSheetRow(kind, id, user) {
  assertKind(kind);
  const sheets = await readSheets(kind);
  const before = sheets.items.length;
  sheets.items = sheets.items.filter(x => Number(x.id) !== Number(id));
  if (sheets.items.length === before) {
    const err = new Error('Sheet row not found');
    err.status = 404;
    throw err;
  }
  await writeSheets(kind, sheets, `Delete ${kind} sheet row ${id}`, user);
  return { ok: true };
}
