/*
  Per-section Sheets catalogs (Mongo via store.js — never GitHub).

  Kinds:
    diagrams  → data/diagrams/sheets.json   (İş Axışları)
    pdfs      → data/files/sheets.json      (Normativ Sənədlər)
    templates → data/templates/sheets.json  (Şablonlar)

  Two-way sync with the section's own catalog (diagrams / pdfs / templates):
    - item → sheet: syncFromItem() upserts the sheet row whenever an item's
      title/subtitle/status/struktur changes (called from processes.js /
      pdfs.js / templates.js).
    - sheet → item: syncRowToTarget() runs whenever a sheet row is created
      or edited (routes/sheets.js). It matches an existing item by the
      triple (title + strukturAdi + subtitle/nömrə). If found, only the
      status is pushed across (never creates a duplicate). If nothing
      matches, a new item is auto-created (status defaults to the kind's
      first status, "Planlaşdırılır") so it immediately shows up in the
      section's own list.
*/

import { getFile as mongoGet, putFile as mongoPut, attribution } from './store.js';
import { getFile as githubGet, putFile as githubPut } from './github.js';

const dataPath = () => (process.env.DATA_PATH || 'data').replace(/^\/|\/$/g, '');

// Status sets differ per kind — İş Axışları dropped "sign" and gained an
// explicit terminal "cancelled"; Normativ Sənədlər / Şablonlar additionally
// have "prep" and "renew". Keep in sync with frontend Status.jsx.
export const ALLOWED_STATUS_BY_KIND = {
  diagrams: ['progress', 'prep', 'notdone', 'done', 'cancelled'],
  pdfs: ['progress', 'prep', 'notdone', 'sign', 'done', 'cancelled', 'renew'],
  templates: ['progress', 'prep', 'notdone', 'sign', 'done', 'cancelled', 'renew']
};
// Back-compat flat list (used by a couple of older call sites / legacy routes).
export const ALLOWED_STATUS = ['progress', 'prep', 'notdone', 'sign', 'done', 'cancelled', 'renew'];

// A row created purely from the Sheet (no explicit status typed) is
// considered "just queued" — defaults to the first status in the kind's list.
const DEFAULT_SYNC_STATUS = 'progress';

// Extra hand-typed fields shown only for the pdfs / templates sheets
// (Normativ Sənədlər / Şablonlar): sənədin növü, nəşr, təsdiq tarixi,
// qərar/protokol, səhifə sayı.
export const EXTRA_FIELDS = ['docType', 'edition', 'approvalDate', 'protocol', 'pageCount'];
// (kept as a single flat list — SheetsPage.jsx decides per-kind order/labels)

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

// Sheets ↔ section sync is ON in both directions — see file header.
const AUTO_SYNC_ENABLED = true;

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
function processBodyPath(id) {
  return `${dataPath()}/diagrams/processes/process-${id}.json`;
}

function nextId(list) {
  const ids = (list || []).map(x => Number(x.id)).filter(Number.isFinite);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function normalizeStatus(kind, raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  const allowed = ALLOWED_STATUS_BY_KIND[kind] || ALLOWED_STATUS;
  return allowed.includes(s) ? s : null;
}

/** Normalize legacy processId → itemId */
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const itemId = row.itemId != null
    ? row.itemId
    : (row.processId != null ? row.processId : null);
  const extras = {};
  for (const f of EXTRA_FIELDS) extras[f] = typeof row[f] === 'string' ? row[f] : (row[f] || '');
  const order = Number.isFinite(Number(row.order)) ? Number(row.order) : null;
  return { ...row, ...extras, itemId, processId: itemId, order };
}

export async function readSheets(kind) {
  assertKind(kind);
  const file = await mongoGet(sheetsPath(kind));
  const c = file ? file.content : null;
  let items = (c && Array.isArray(c.items)) ? c.items.map(normalizeRow) : [];

  // Migration: rows created before the `order` field existed don't have a
  // stable position — backfill using their stored (creation) order once,
  // so old rows keep their spot instead of colliding with new order numbers.
  if (items.some(x => x.order == null)) {
    items = items.map((x, i) => (x.order == null ? { ...x, order: i + 1 } : x));
    await writeSheets(kind, { items }, `Backfill order for ${kind} sheets`, null);
  }

  items.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
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

async function writeIndexFile(kind, content, message, user) {
  const meta = assertKind(kind);
  const p = indexPath(kind);
  if (meta.indexVia === 'github') return githubPut(p, content, attribution(user, message));
  return mongoPut(p, content, attribution(user, message));
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
        order: i + 1,
        title: String(p.title || ''),
        subtitle: String(p.subtitle || ''),
        strukturAdi: strukturFor(p),
        status: normalizeStatus(kind, p.status),
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
 * Item → Sheet direction.
 */
export async function syncFromItem(kind, { itemId, title, subtitle, status, sheetId, strukturAdi }, user) {
  assertKind(kind);
  if (!AUTO_SYNC_ENABLED) return null;
  const iid = Number(itemId);
  if (!Number.isFinite(iid)) return null;

  const sheets = await readSheets(kind);
  const now = new Date().toISOString();
  const st = status === undefined ? undefined : normalizeStatus(kind, status);
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

/* ============================================================
   Sheet → Item sync (the reverse direction)
   ============================================================ */

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function groupNameOf(entry, groups) {
  const g = groups.find(x => Number(x.id) === Number(entry?.groupId));
  return g?.name ? String(g.name) : '';
}

// Find (or create) the group whose name matches strukturAdi. Returns the
// group id; mutates `groups` in place when a new one is created.
function resolveGroupId(groups, strukturAdi) {
  const wanted = norm(strukturAdi);
  if (wanted) {
    const hit = groups.find(g => norm(g.name) === wanted);
    if (hit) return Number(hit.id);
  }
  if (!groups.length) {
    const g = { id: 1, name: strukturAdi || 'Ümumi' };
    groups.push(g);
    return g.id;
  }
  if (wanted) {
    const g = { id: nextId(groups), name: strukturAdi };
    groups.push(g);
    return g.id;
  }
  return Number(groups[0].id);
}

/**
 * Called whenever a Sheets row (diagrams / pdfs / templates) is created or
 * edited. Matches an existing item by (title + strukturAdi + subtitle). If
 * found, only pushes a status change across (never duplicates). If nothing
 * matches, auto-creates a new item so it shows up in the section's own list
 * right away, with status defaulting to "Planlaşdırılır".
 *
 * Returns { itemId, created, status } or null when there was nothing to
 * sync (blank title) or sync is disabled.
 */
export async function syncRowToTarget(kind, row, user) {
  assertKind(kind);
  if (!AUTO_SYNC_ENABLED) return null;
  const title = (row.title || '').trim();
  const strukturAdi = (row.strukturAdi || '').trim();
  const subtitle = (row.subtitle || '').trim();
  if (!title) return null; // nothing worth syncing for a blank row

  const meta = SHEET_KINDS[kind];
  const idxFile = await readIndexFile(kind);
  const idx = (idxFile && idxFile.content && typeof idxFile.content === 'object') ? idxFile.content : {};
  const list = Array.isArray(idx[meta.indexKey]) ? idx[meta.indexKey] : [];
  const groups = Array.isArray(idx.groups) ? idx.groups : [];
  idx[meta.indexKey] = list;
  idx.groups = groups;

  const targetStatus = normalizeStatus(kind, row.status);

  // 1) Already linked to an item? Prefer that — never re-match by text once linked.
  let entry = null;
  const linkedId = row.itemId ?? row.processId;
  if (linkedId != null) {
    entry = list.find(p => Number(p.id) === Number(linkedId)) || null;
  }
  // 2) Otherwise match by the triple: name + struktur adı + nömrə.
  if (!entry) {
    entry = list.find(p =>
      norm(p.title) === norm(title) &&
      norm(groupNameOf(p, groups)) === norm(strukturAdi) &&
      norm(p.subtitle) === norm(subtitle)
    ) || null;
  }

  if (entry) {
    let changed = false;
    if (targetStatus !== (entry.status ?? null)) {
      if (targetStatus === null) delete entry.status; else entry.status = targetStatus;
      changed = true;
    }
    if (changed) {
      await writeIndexFile(kind, idx, `Sync ${kind} item ${entry.id} status from sheet`, user);
    }
    return { itemId: Number(entry.id), created: false, status: entry.status ?? null };
  }

  // Nothing matched — auto-create so it shows up in the section list.
  const gid = resolveGroupId(groups, strukturAdi);
  const newId = nextId(list);
  const status = targetStatus == null ? DEFAULT_SYNC_STATUS : targetStatus;

  if (kind === 'diagrams') {
    const process = {
      id: newId, title, subtitle,
      width: 1600, height: 600,
      lanes: [], nodes: [], edges: []
    };
    await mongoPut(processBodyPath(newId), process, attribution(user, `Auto-create process ${newId} from sheet`));
    list.push({ id: newId, title, subtitle, groupId: gid, status });
  } else {
    // pdfs / templates — no binary file yet; it's a placeholder entry until
    // someone uploads the actual document from the section page.
    list.push({
      id: newId,
      title,
      subtitle,
      filename: '',
      size: 0,
      noFile: true,
      groupId: gid,
      status,
      uploadedAt: new Date().toISOString()
    });
  }
  await writeIndexFile(kind, idx, `Auto-create ${kind} item ${newId} from sheet`, user);
  return { itemId: newId, created: true, status };
}

export async function createSheetRow(kind, { title, subtitle, status, strukturAdi, order, ...rest }, user) {
  assertKind(kind);
  // Empty title allowed — plus button must work even when fields are blank.
  const name = title != null ? String(title).trim() : '';
  const sheets = await readSheets(kind);
  // `order` is the row's fixed visual position (the blank slot it was typed
  // into). Rows keep this position forever — filling row 5 while rows 2/3
  // stay empty must never bump row 5 up to fill the gap. Falls back to
  // appending after the highest known position when not provided.
  const maxOrder = sheets.items.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0);
  const ord = Number.isFinite(Number(order)) && Number(order) > 0 ? Number(order) : maxOrder + 1;
  const item = {
    id: nextId(sheets.items),
    order: ord,
    title: name,
    subtitle: subtitle != null ? String(subtitle) : '',
    strukturAdi: strukturAdi != null ? String(strukturAdi).trim() : '',
    status: normalizeStatus(kind, status),
    date: new Date().toISOString(),
    itemId: null,
    processId: null
  };
  for (const f of EXTRA_FIELDS) {
    if (typeof rest[f] === 'string') item[f] = rest[f];
  }
  if (item.status == null) delete item.status;

  // Sheet → item sync: match-or-create in the section's own list.
  try {
    const sync = await syncRowToTarget(kind, item, user);
    if (sync?.itemId != null) {
      item.itemId = sync.itemId;
      item.processId = sync.itemId;
      if (sync.created && sync.status && item.status == null) item.status = sync.status;
    }
  } catch (e) { console.error(`[sheets->${kind} sync create]`, e.message); }

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
  if (patch.order !== undefined && Number.isFinite(Number(patch.order))) row.order = Number(patch.order);
  for (const f of EXTRA_FIELDS) {
    if (typeof patch[f] === 'string') row[f] = patch[f];
  }
  if (patch.status !== undefined) {
    const st = normalizeStatus(kind, patch.status);
    if (st === null) delete row.status;
    else row.status = st;
  }
  if (patch.itemId !== undefined || patch.processId !== undefined) {
    const raw = patch.itemId !== undefined ? patch.itemId : patch.processId;
    const v = raw == null || raw === '' ? null : Number(raw);
    row.itemId = v;
    row.processId = v;
  }

  // Sheet → item sync: title/strukturAdi/subtitle/status edits all flow
  // through here — match-or-create, then push the status across.
  try {
    const sync = await syncRowToTarget(kind, row, user);
    if (sync?.itemId != null) {
      row.itemId = sync.itemId;
      row.processId = sync.itemId;
    }
  } catch (e) { console.error(`[sheets->${kind} sync update]`, e.message); }

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

/**
 * Bulk-remove every row that was auto-populated from an item (itemId set) —
 * i.e. rows created by the old GET-time backfill or by the per-item auto-sync.
 * Hand-typed blank rows (itemId=null) are never touched.
 */
export async function clearLinkedRows(kind, user) {
  assertKind(kind);
  const sheets = await readSheets(kind);
  const before = sheets.items.length;
  sheets.items = sheets.items.filter(x => x.itemId == null && x.processId == null);
  const removed = before - sheets.items.length;
  if (removed > 0) {
    await writeSheets(kind, sheets, `Clear ${removed} auto-synced ${kind} sheet rows`, user);
  }
  return { removed, items: sheets.items };
}

/** Remove every sheet row for this kind (Sheets checklist wipe). */
export async function clearAllRows(kind, user) {
  assertKind(kind);
  const sheets = await readSheets(kind);
  const removed = sheets.items.length;
  if (removed === 0) return { removed: 0, items: [] };
  sheets.items = [];
  await writeSheets(kind, sheets, `Clear all ${removed} ${kind} sheet rows`, user);
  return { removed, items: [] };
}
