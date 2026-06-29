import { sql, ensureSchema, LOTS } from '../lib/db.js';

const KINDS = ['workstream', 'category'];

// /api/options — GET (list workstreams + categories + lots) / POST (add)
export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT id, kind, name FROM options ORDER BY kind, name;`;
      return res.status(200).json({
        workstreams: rows.filter((r) => r.kind === 'workstream'),
        categories: rows.filter((r) => r.kind === 'category'),
        lots: LOTS,
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const kind = body.kind;
      const name = body.name ? String(body.name).trim() : '';
      if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid kind.' });
      if (!name) return res.status(400).json({ error: 'Name is required.' });

      const { rows } = await sql`
        INSERT INTO options (kind, name) VALUES (${kind}, ${name})
        ON CONFLICT (kind, name) DO NOTHING
        RETURNING id, kind, name;
      `;
      if (!rows.length) return res.status(409).json({ error: 'That option already exists.' });
      return res.status(201).json(rows[0]);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
