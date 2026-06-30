import { sql, ensureSchema, BUDGET_SCOPES } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

// /api/budgets — GET (list) / POST (create or update a budget target)
export default async function handler(req, res) {
  try {
    await ensureSchema();
    if (!(await requireAuth(req, res))) return;

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT id, scope, ref_key, amount FROM budgets ORDER BY scope, ref_key;`;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const scope = body.scope;
      const refKey = body.ref_key ? String(body.ref_key).trim() : '';
      const amount = Number(body.amount);
      if (!BUDGET_SCOPES.includes(scope)) return res.status(400).json({ error: 'Invalid budget scope.' });
      if (!refKey) return res.status(400).json({ error: 'Budget target is required.' });
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Amount must be a non-negative number.' });

      const { rows } = await sql`
        INSERT INTO budgets (scope, ref_key, amount)
        VALUES (${scope}, ${refKey}, ${amount})
        ON CONFLICT (scope, ref_key) DO UPDATE SET amount = EXCLUDED.amount
        RETURNING id, scope, ref_key, amount;
      `;
      return res.status(201).json(rows[0]);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
