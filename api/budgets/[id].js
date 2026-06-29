import { sql } from '../../lib/db.js';

// /api/budgets/:id — DELETE a budget target
export default async function handler(req, res) {
  const { id } = req.query;
  try {
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
