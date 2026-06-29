import { ensureSchema } from '../lib/db.js';

// GET /api/setup — create tables + seed default options. Idempotent.
export default async function handler(req, res) {
  try {
    await ensureSchema();
    res.status(200).json({ ok: true, message: 'Database ready. Tables created and defaults seeded.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
