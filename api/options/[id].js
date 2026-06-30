import { sql, ensureSchema } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';

// /api/options/:id — PUT (rename, propagates to entries) / DELETE (blocked if in use)
export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureSchema();
    if (!(await requireAuth(req, res))) return;

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const name = body.name ? String(body.name).trim() : '';
      if (!name) return res.status(400).json({ error: 'Name is required.' });

      const existing = await sql`SELECT id, kind, name FROM options WHERE id = ${id};`;
      if (!existing.rows.length) return res.status(404).json({ error: 'Option not found.' });
      const { kind, name: oldName } = existing.rows[0];

      const { rows } = await sql`UPDATE options SET name = ${name} WHERE id = ${id}
                                 RETURNING id, kind, name;`;

      if (kind === 'workstream') {
        await sql`UPDATE entries SET workstream = ${name} WHERE workstream = ${oldName};`;
      } else if (kind === 'category') {
        await sql`UPDATE entries SET cost_category = ${name} WHERE cost_category = ${oldName};`;
      } else if (kind === 'staff') {
        await sql`UPDATE entries SET staff = ${name} WHERE staff = ${oldName};`;
      }
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const existing = await sql`SELECT id, kind, name FROM options WHERE id = ${id};`;
      if (!existing.rows.length) return res.status(404).json({ error: 'Option not found.' });
      const { kind, name } = existing.rows[0];

      // Only active (non-trashed) entries block deletion. Entries sitting in the
      // Trash don't count — they hold their category/workstream/staff name as
      // plain text, so deleting the option here is harmless even if one is later
      // restored.
      let inUse = 0;
      if (kind === 'workstream') {
        const r = await sql`SELECT COUNT(*)::int AS n FROM entries WHERE workstream = ${name} AND deleted_at IS NULL;`;
        inUse = r.rows[0].n;
      } else if (kind === 'category') {
        const r = await sql`SELECT COUNT(*)::int AS n FROM entries WHERE cost_category = ${name} AND deleted_at IS NULL;`;
        inUse = r.rows[0].n;
      } else if (kind === 'staff') {
        const r = await sql`SELECT COUNT(*)::int AS n FROM entries WHERE staff = ${name} AND deleted_at IS NULL;`;
        inUse = r.rows[0].n;
      }
      if (inUse > 0) {
        return res.status(409).json({
          error: `Cannot delete — ${inUse} active cost ${inUse === 1 ? 'entry uses' : 'entries use'} "${name}". Reassign them first.`,
        });
      }

      await sql`DELETE FROM options WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error(err);
    if (String(err?.message || '').includes('duplicate')) {
      return res.status(409).json({ error: 'Another option already has that name.' });
    }
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
