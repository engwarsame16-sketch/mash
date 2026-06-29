# Project Cost Manager — Afgooye–Baraawe Road Corridor

A single-user web app for tracking costs on the **Afgooye–Baraawe Road Corridor Project**
(Lot 1 / Lot 2, multiple technical workstreams). Built as a **plain HTML + CSS + vanilla
JavaScript** frontend with a small set of **serverless API functions** that persist data to
**Vercel Postgres**, so your data survives redeployments and is reachable from any device via
the live URL.

No framework, no build step. No login. No subscriptions. No external accounting integrations.

---

## Features

- **Dashboard** — Total Spent, Spent This Month, Spend by Lot, a Cost Category donut chart,
  and a Workstream bar chart.
- **Transactions** — sortable (date / amount), filterable (Lot / Workstream / Category) table
  with add / edit / delete.
- **Categories** — manage the available Workstream and Cost Category options without code changes.
- **Reports** — monthly spend-trend bar chart plus a Lot × Workstream × Category breakdown table.

All charts are hand-rolled SVG — there are **no external script/CDN dependencies** in the browser.

### Data model (each cost entry)

| Field | Notes |
|---|---|
| Description | e.g. `Eng. AK — June Salary`, `SOMGEG Lab — Soil Testing Batch 1` |
| Amount (USD) | non-negative number |
| Date | calendar date |
| Lot | `Lot 1` / `Lot 2` / `Both/Shared` (fixed) |
| Workstream | managed list — Traffic Study, Geotechnical Investigation, LiDAR & Drone Survey, Security & Safeguards, Materials Investigation, Other |
| Cost Category | managed list — Staff Salary, Lab & Testing Contract, Equipment & Subcontractor, Other |
| Notes / remarks | optional free text |

---

## How it works

```
index.html        ← static page shell (sidebar + main area)
styles.css        ← all styling
app.js            ← the whole frontend: routing, rendering, SVG charts, modal
api/              ← Vercel serverless functions (the only backend)
  setup.js        ← GET /api/setup  → create tables + seed defaults
  entries.js      ← GET (list) / POST (create)
  entries/[id].js ← PUT (update) / DELETE
  options.js      ← GET (list) / POST (add workstream/category)
  options/[id].js ← PUT (rename) / DELETE
lib/db.js         ← @vercel/postgres connection + schema + seed data
scripts/setup-db.mjs ← CLI alternative to /api/setup
vercel.json       ← routes the dynamic /api/.../:id endpoints
```

The browser (`app.js`) calls the `/api/*` functions; those functions are the only code that
touches the database. Postgres credentials never reach the browser.

---

## Tech stack

- **Frontend:** plain HTML + CSS + vanilla JavaScript (ES modules), no framework, no bundler
- **Backend:** Vercel Serverless Functions (Node.js) under `/api`
- **Database:** Vercel Postgres via **`@vercel/postgres`**
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

- Renaming a workstream or cost category updates existing entries so reports stay consistent.
- An option can only be deleted when no entries reference it.
- All amounts are stored as `NUMERIC(14,2)` and displayed in USD.
- User-entered text is HTML-escaped before rendering (no script injection from descriptions/notes).
# mash
