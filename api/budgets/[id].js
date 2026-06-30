import { sql, ensureSchema } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';

// /api/budgets/:id — DELETE a budget target
export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureSchema();
    if (!(await requireAuth(req, res))) return;

    if (req.method === 'DELETE') {
      const { rowCount } = await sql`DELETE FROM budgets WHERE id = ${id};`;
      if (!rowCount) return res.status(404).json({ error: 'Budget not found.' });
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
