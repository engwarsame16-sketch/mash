import { sql } from '../../lib/db.js';

function validate(body) {
  const errors = [];
  if (!body.description || !String(body.description).trim()) errors.push('Description is required.');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) errors.push('Amount must be a non-negative number.');
  if (!body.entry_date) errors.push('Date is required.');
  if (!body.lot) errors.push('Lot is required.');
  if (!body.workstream) errors.push('Workstream is required.');
  if (!body.cost_category) errors.push('Cost category is required.');
  return errors;
}

// /api/entries/:id — PUT (update) / DELETE
export default async function handler(req, res) {
  const { id } = req.query;
  try {
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const errors = validate(body);
      if (errors.length) return res.status(400).json({ error: errors.join(' ') });

      const { rows } = await sql`
        UPDATE entries SET
          description   = ${body.description.trim()},
          amount        = ${Number(body.amount)},
          entry_date    = ${body.entry_date},
          lot           = ${body.lot},
          workstream    = ${body.workstream},
          cost_category = ${body.cost_category},
          notes         = ${body.notes ? String(body.notes).trim() : null},
          status        = ${body.status || 'Paid'},
          reference     = ${body.reference ? String(body.reference).trim() : null}
        WHERE id = ${id}
        RETURNING id, description, amount, entry_date, lot, workstream, cost_category, notes, status, reference, created_at;
      `;
      if (!rows.length) return res.status(404).json({ error: 'Entry not found.' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const { rowCount } = await sql`DELETE FROM entries WHERE id = ${id};`;
      if (!rowCount) return res.status(404).json({ error: 'Entry not found.' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
