// TEMPORARY diagnostic endpoint — reports which DB connection env vars exist
// and their host/db (no passwords). Delete after configuring the connection.
export default function handler(req, res) {
  const names = [
    'POSTGRES_URL',
    'POSTGRES_URL_NON_POOLING',
    'POSTGRES_PRISMA_URL',
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
    'POSTGRES_HOST',
    'PGHOST',
  ];
  const out = {};
  for (const n of names) {
    const v = process.env[n];
    if (!v) { out[n] = null; continue; }
    try {
      const u = new URL(v);
      out[n] = { host: u.host, db: u.pathname.replace(/^\//, ''), params: u.search, pooled: /-pooler/.test(u.host) };
    } catch {
      out[n] = { value: v.slice(0, 24) + '…', note: 'not a URL' };
    }
  }
  res.status(200).json(out);
}
