import { sql } from '@vercel/postgres';

export { sql };

// Default seed data for the Afgooye–Baraawe Road Corridor Project.
export const DEFAULT_WORKSTREAMS = [
  'Traffic Study',
  'Geotechnical Investigation',
  'LiDAR & Drone Survey',
  'Security & Safeguards',
  'Materials Investigation',
  'Other',
];

export const DEFAULT_CATEGORIES = [
  'Staff Salary',
  'Lab & Testing Contract',
  'Equipment & Subcontractor',
  'Other',
];

// Lots are fixed by the project structure, so they live in code (not the DB).
export const LOTS = ['Lot 1', 'Lot 2', 'Both/Shared'];

/**
 * Create tables (idempotent) and seed the default option lists if empty.
 * Safe to call multiple times.
 */
export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS options (
      id     SERIAL PRIMARY KEY,
      kind   TEXT NOT NULL,
      name   TEXT NOT NULL,
      UNIQUE (kind, name)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS entries (
      id            SERIAL PRIMARY KEY,
      description   TEXT NOT NULL,
      amount        NUMERIC(14,2) NOT NULL,
      entry_date    DATE NOT NULL,
      lot           TEXT NOT NULL,
      workstream    TEXT NOT NULL,
      cost_category TEXT NOT NULL,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;

  // Seed default options only when none exist for that kind.
  const { rows } = await sql`SELECT kind, COUNT(*)::int AS n FROM options GROUP BY kind;`;
  const counts = Object.fromEntries(rows.map((r) => [r.kind, r.n]));

  if (!counts.workstream) {
    for (const name of DEFAULT_WORKSTREAMS) {
      await sql`INSERT INTO options (kind, name) VALUES ('workstream', ${name})
                ON CONFLICT (kind, name) DO NOTHING;`;
    }
  }
  if (!counts.category) {
    for (const name of DEFAULT_CATEGORIES) {
      await sql`INSERT INTO options (kind, name) VALUES ('category', ${name})
                ON CONFLICT (kind, name) DO NOTHING;`;
    }
  }
}
