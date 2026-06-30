import { sql, ensureSchema } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';

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

// /api/entries/:id — PUT (update) / PATCH (restore from trash) / DELETE
//   DELETE            → move to trash (soft delete: sets deleted_at)
//   DELETE ?forever=1 → permanently remove
export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureSchema();
    if (!(await requireAuth(req, res))) return;

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const errors = validate(body);
      if (errors.length) return res.status(400).json({ error: errors.join(' ') });

      const { rows } = await sql`
        UPDATE entries SET
          description   = ${body.description.trim()},
          amount        = ${Number(body.amount)},
          entry_date    = ${body.entry_date},
          workstream    = ${body.workstream},
          cost_category = ${body.cost_category},
          staff         = ${body.staff ? String(body.staff).trim() : null},
          notes         = ${body.notes ? String(body.notes).trim() : null},
          status        = ${body.status || 'Paid'},
          reference     = ${body.reference ? String(body.reference).trim() : null}
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING id, description, amount, entry_date, workstream, cost_category, staff, notes, status, reference, created_at;
      `;
      if (!rows.length) return res.status(404).json({ error: 'Entry not found.' });
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'PATCH') {
      // Restore an entry from the trash.
      const { rows } = await sql`
        UPDATE entries SET deleted_at = NULL
        WHERE id = ${id} AND deleted_at IS NOT NULL
        RETURNING id;
      `;
      if (!rows.length) return res.status(404).json({ error: 'Trashed entry not found.' });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (req.query.forever === '1') {
        // Permanent removal — bypass the trash.
        const { rowCount } = await sql`DELETE FROM entries WHERE id = ${id};`;
        if (!rowCount) return res.status(404).json({ error: 'Entry not found.' });
        return res.status(200).json({ ok: true });
      }
      // Default: soft delete → moves to the Trash, restorable for 30 days.
      const { rowCount } = await sql`
        UPDATE entries SET deleted_at = now()
        WHERE id = ${id} AND deleted_at IS NULL;
      `;
      if (!rowCount) return res.status(404).json({ error: 'Entry not found.' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'PUT, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
