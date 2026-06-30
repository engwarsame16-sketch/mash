# Project Cost Manager — Afgooye–Baraawe Road Corridor

A single-user web app for tracking costs on the **Afgooye–Baraawe Road Corridor Project**
(a single project, multiple technical workstreams). Built as a **plain HTML + CSS + vanilla
JavaScript** frontend with a small set of **serverless API functions** that persist data to
**Vercel Postgres**, so your data survives redeployments and is reachable from any device via
the live URL.

No framework, no build step. No login. No subscriptions. No external accounting integrations.

---

## Features

- **Dashboard** — Total Spent, Spent This Month, a Cost Category donut chart,
  a Workstream bar chart, a monthly spend bar chart, and overall-budget usage.
- **Transactions** — sortable (date / amount), filterable (Workstream / Category / Staff /
  Status) table with add / edit / delete.
- **Staff** — tag each cost entry with who it was paid to, then see how much each person
  (yourself + others) has taken from the project budget, with a per-person breakdown.
- **Categories** — manage the available Workstream, Cost Category, and Staff options without
  code changes.
- **Trash** — deleted entries are recoverable for 30 days: restore them, delete forever, or
  empty the trash. Entries older than 30 days are auto-removed.
- **Reports** — monthly spend + cumulative trend charts, budget-vs-actual, spend by status,
  top-10 expenses, and a Workstream × Category breakdown table.

All charts are hand-rolled SVG — there are **no external script/CDN dependencies** in the browser.

### Data model (each cost entry)

| Field | Notes |
|---|---|
| Description | e.g. `Eng. AK — June Salary`, `SOMGEG Lab — Soil Testing Batch 1` |
| Amount (USD) | non-negative number |
| Date | calendar date |
| Workstream | managed list — Traffic Study, Geotechnical Investigation, LiDAR & Drone Survey, Security & Safeguards, Materials Investigation, Other |
| Cost Category | managed list — Staff Salary, Lab & Testing Contract, Equipment & Subcontractor, Other |
| Paid to (Staff) | optional — which staff member this payment went to (you + others) |
| Status | `Paid` / `Pending` / `Committed` (fixed) |
| Reference / Invoice no. | optional free text |
| Notes / remarks | optional free text |
| Deleted at | internal — set when an entry is moved to the Trash; cleared on restore |

> **Note:** Earlier versions tracked a `Lot` (Lot 1 / Lot 2 / Both-Shared). That distinction
> has been removed — the app now treats everything as one project. Existing `lot` data is
> retained in the database (harmless) but no longer shown or used.

---

## How it works

```
index.html        ← static page shell (sidebar + main area)
styles.css        ← all styling
app.js            ← the whole frontend: routing, rendering, SVG charts, modal
api/              ← Vercel serverless functions (the only backend)
  setup.js         ← GET /api/setup  → create tables + seed defaults
  entries.js       ← GET (list) / POST (create)  — ?trash=1 lists soft-deleted
  entries/[id].js  ← PUT (update) / PATCH (restore) / DELETE (soft / ?forever=1 hard)
  options.js       ← GET (list) / POST (add workstream/category/staff)
  options/[id].js  ← PUT (rename) / DELETE
  budgets.js       ← GET (list) / POST (create or update)
  budgets/[id].js  ← DELETE
lib/db.js         ← pg connection + schema + seed data + 30-day trash purge
scripts/setup-db.mjs ← CLI alternative to /api/setup
vercel.json       ← routes the dynamic /api/.../:id endpoints
```

The browser (`app.js`) calls the `/api/*` functions; those functions are the only code that
touches the database. Postgres credentials never reach the browser.

---

## Tech stack

- **Frontend:** plain HTML + CSS + vanilla JavaScript (ES modules), no framework, no bundler
- **Backend:** Vercel Serverless Functions (Node.js) under `/api`
- **Database:** Postgres via the **`pg`** package — works with Vercel Postgres / Neon,
  Prisma Postgres, Supabase, or any plain Postgres connection string (`POSTGRES_URL`)
- No external API dependencies beyond the database connection

---

## Local development

You need the [Vercel CLI](https://vercel.com/docs/cli) so the `/api` functions run locally:

```bash
npm install
npm i -g vercel

vercel link                 # link this folder to your Vercel project
vercel env pull .env.local  # fetch the Postgres connection string
npm run setup-db            # create tables + seed defaults

vercel dev                  # serves index.html + the /api functions at localhost:3000
```

> Want to just preview the UI without a database? Open `index.html` directly — it loads, but
> every data call returns an error until the `/api` backend + Postgres are connected. Use
> `vercel dev` for a working local copy.

---

## Deploy to Vercel

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Project Cost Manager (HTML/JS + Vercel Postgres)"
   git branch -M main
   git remote add origin https://github.com/<you>/cost-manager.git
   git push -u origin main
   ```

2. **Create a Vercel project**
   Go to [vercel.com](https://vercel.com), sign in **with your Google account**, click
   **Add New → Project**, and import the GitHub repo. No framework preset is needed — Vercel
   serves the static files and auto-detects the `/api` functions. Deploy.

3. **Create & link the Postgres database**
   In the project dashboard go to **Storage → Create Database**, choose **Postgres** (Vercel
   now provisions this through **Neon**, its native Postgres provider), name it, and link it
   to this project. Vercel automatically injects the connection environment variables —
   including **`POSTGRES_URL`**, which this app reads. Redeploy if prompted so the variables
   take effect.

   > The `@vercel/postgres` package prints a deprecation notice because Vercel moved Postgres
   > to Neon. It still works here — the integration sets the `POSTGRES_URL` it reads. If you
   > later want to silence it, swap `@vercel/postgres` for `@neondatabase/serverless` (same
   > SQL-template API) without changing query code.

4. **Run the one-time schema setup**
   After the deploy is live, visit:
   ```
   https://<your-project>.vercel.app/api/setup
   ```
   This creates the `entries` and `options` tables and seeds the default workstreams and cost
   categories. You should see `{"ok":true,...}`. It's idempotent — safe to hit again. (Or run
   `npm run setup-db` locally against the same database.)

5. **Done** — open the live `.vercel.app` URL on any device. Data lives in Vercel Postgres and
   survives redeployments.

---

## Safeguards

- Renaming a workstream, cost category, or staff member updates existing entries so reports stay consistent.
- An option can only be deleted when no entries reference it.
- All amounts are stored as `NUMERIC(14,2)` and displayed in USD.
- User-entered text is HTML-escaped before rendering (no script injection from descriptions/notes).
- Deleting an entry moves it to the **Trash** (soft delete); it can be restored for 30 days,
  after which it is permanently removed. "Delete forever" / "Empty trash" remove it immediately.

> **Upgrading from a Lot-based version:** the schema changes (nullable `lot`, new `staff` and
> `deleted_at` columns, removal of lot-scoped budgets) are applied automatically and
> idempotently the next time any API function runs `ensureSchema()` — including by re-visiting
> `/api/setup` (or running `npm run setup-db`). No manual migration is needed.
# mash
