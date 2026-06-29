import pg from 'pg';

const { Pool } = pg;

// Standard Postgres TCP connection. Works with Vercel/Neon, Prisma Postgres
// (db.prisma.io), Supabase, or any plain Postgres connection string.
const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL_UNPOOLED;

if (!connectionString) {
  throw new Error(
    'No Postgres connection string found. Set POSTGRES_URL (or DATABASE_URL) — on Vercel this is created automatically when you link a Postgres database to the project.'
  );
}

// One pool per warm serverless instance.
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
});

// Tagged-template wrapper so handlers can keep writing `sql`...`` and get back
// a { rows, rowCount } result. Interpolated values become $1, $2, … bind
// parameters — safe against SQL injection.
export function sql(strings, ...values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
  return pool.query(text, values);
}

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
