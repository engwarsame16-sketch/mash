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

// Payment / commitment status for each cost entry.
export const STATUSES = ['Paid', 'Pending', 'Committed'];

// Budget scopes — what a budget target applies to.
export const BUDGET_SCOPES = ['overall', 'workstream', 'category'];

// How long a soft-deleted entry stays in the Trash before being purged.
export const TRASH_RETENTION_DAYS = 30;

/**
 * Create tables (idempotent) and seed the default option lists if empty.
 * Safe to call multiple times — also adds newer columns to existing tables.
 */
export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `;

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
      lot           TEXT,
      workstream    TEXT NOT NULL,
      cost_category TEXT NOT NULL,
      notes         TEXT,
      status        TEXT NOT NULL DEFAULT 'Paid',
      reference     TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;

  // Add newer columns to databases created before these existed.
  await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Paid';`;
  await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS reference TEXT;`;
  // Lot is no longer used (single project) — make it nullable so old rows are
  // harmless and new entries simply leave it null.
  await sql`ALTER TABLE entries ALTER COLUMN lot DROP NOT NULL;`;
  // Who the cost was paid to (staff member). Optional — not every entry is a
  // payment to a person (e.g. a lab contract).
  await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS staff TEXT;`;
  // Soft-delete timestamp. NULL = active entry; set = trashed (auto-purged after
  // TRASH_RETENTION_DAYS). Lets the Trash bin restore entries.
  await sql`ALTER TABLE entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`;

  await sql`
    CREATE TABLE IF NOT EXISTS budgets (
      id      SERIAL PRIMARY KEY,
      scope   TEXT NOT NULL,
      ref_key TEXT NOT NULL,
      amount  NUMERIC(14,2) NOT NULL,
      UNIQUE (scope, ref_key)
    );
  `;

  // The Lot distinction has been removed from the app — any old lot-scoped
  // budget targets are now meaningless, so drop them so they don't skew totals.
  await sql`DELETE FROM budgets WHERE scope = 'lot';`;

  // Auto-purge: permanently delete entries that have been in the Trash longer
  // than the retention window. Runs as part of every schema-touching request,
  // so no separate cron is needed.
  await sql`DELETE FROM entries WHERE deleted_at IS NOT NULL AND deleted_at < now() - (${TRASH_RETENTION_DAYS} || ' days')::interval;`;

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
