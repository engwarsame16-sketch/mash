import { sql, ensureSchema } from '../lib/db.js';

function validate(body) {
  const errors = [];
  if (!body.description || !String(body.description).trim()) errors.push('Description is required.');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) errors.push('Amount must be a non-negative number.');
  if (!body.entry_date) errors.push('Date is required.');
  if (!body.workstream) errors.push('Workstream is required.');
  if (!body.cost_category) errors.push('Cost category is required.');
  return errors;
}

// /api/entries  — GET (list) / POST (create)
export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      // ?trash=1 returns only soft-deleted entries; default returns active ones.
      const showTrash = req.query.trash === '1';
      const { rows } = showTrash
        ? await sql`
            SELECT id, description, amount, entry_date, workstream, cost_category, staff, notes, status, reference, deleted_at, created_at
            FROM entries
            WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC, id DESC;
          `
        : await sql`
            SELECT id, description, amount, entry_date, workstream, cost_category, staff, notes, status, reference, created_at
            FROM entries
            WHERE deleted_at IS NULL
            ORDER BY entry_date DESC, id DESC;
          `;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const errors = validate(body);
      if (errors.length) return res.status(400).json({ error: errors.join(' ') });

      const { rows } = await sql`
        INSERT INTO entries (description, amount, entry_date, workstream, cost_category, staff, notes, status, reference)
        VALUES (
          ${body.description.trim()},
          ${Number(body.amount)},
          ${body.entry_date},
          ${body.workstream},
          ${body.cost_category},
          ${body.staff ? String(body.staff).trim() : null},
          ${body.notes ? String(body.notes).trim() : null},
          ${body.status || 'Paid'},
          ${body.reference ? String(body.reference).trim() : null}
        )
        RETURNING id, description, amount, entry_date, workstream, cost_category, staff, notes, status, reference, created_at;
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
