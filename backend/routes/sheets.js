import { Router } from 'express';
import {
  backfillFromProcesses,
  createSheetRow,
  updateSheetRow,
  deleteSheetRow,
  syncFromProcess,
  ALLOWED_STATUS
} from '../services/sheetsStore.js';

const router = Router();

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// GET /api/sheets — list; empty store is backfilled once from diagrams
router.get('/', async (req, res, next) => {
  try {
    const sheets = await backfillFromProcesses(req.user);
    res.json({ items: sheets.items || [] });
  } catch (e) { next(e); }
});

// POST /api/sheets — sheet-only row (does NOT create a process)
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const item = await createSheetRow({
      title: req.body?.title,
      subtitle: req.body?.subtitle,
      status: req.body?.status
    }, req.user);
    res.status(201).json(item);
  } catch (e) { next(e); }
});

// POST /api/sheets/sync-from-process — upsert by processId (or sheetId)
// Registered before /:id so "sync-from-process" is never treated as an id.
router.post('/sync-from-process', requireAdmin, async (req, res, next) => {
  try {
    const { processId, title, subtitle, status, sheetId } = req.body || {};
    if (processId == null) return res.status(400).json({ error: 'processId teleb olunur' });
    if (status != null && status !== '' && !ALLOWED_STATUS.includes(String(status))) {
      return res.status(400).json({ error: 'Yanlış status' });
    }
    const row = await syncFromProcess({ processId, title, subtitle, status, sheetId }, req.user);
    res.json(row);
  } catch (e) { next(e); }
});

// PUT /api/sheets/:id — edit fields / link processId
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const row = await updateSheetRow(req.params.id, req.body || {}, req.user);
    res.json(row);
  } catch (e) { next(e); }
});

// DELETE /api/sheets/:id — remove sheet row only (process untouched)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    res.json(await deleteSheetRow(req.params.id, req.user));
  } catch (e) { next(e); }
});

export default router;
