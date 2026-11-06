# Plan — Robotic Programme Database & Reports

## Goal
One place to enter, look up and report robotic surgery volume at Manipal Hospital Whitefield. It replaces the scattered Excel trackers and grows month by month.

## What is captured each month (the data entry points)
1. Total robotic surgeries, whole hospital
2. Gastro Surgery robotic total. This fills in automatically from item 3.
3. Each gastro surgeon (Dr. Manjunath, Dr. Nikhil, Dr. Sanjeev) × package **R1 / R2 / R3**

An empty box means "not known yet" and is stored as blank, not zero. Every save is written to an audit log (who, when, old → new).

## Reports (all switchable Month / Quarter / Financial year, Apr–Mar)
| Need | Where in the app |
|---|---|
| Total robotic surgeries, progression | Dashboard: bar trend + FY-overlay line + KPI tiles |
| Department contribution | Contribution: stacked Gastro Surgery / Other specialties, plus % share table |
| Individual surgeon contribution | Contribution: stacked by surgeon; % of gastro and % of hospital |
| Surgeon vs surgeon comparison | **Surgeons** page: a card per surgeon, side-by-side cases, cumulative progression, share of gastro over time, volume × R-mix, head-to-head table (share of each R package, complexity index, best month, momentum, YoY) |
| Complexity (R1/R2/R3) | Complexity: package mix %, complexity index per surgeon, comparison table (surgeons, FYs, quarters) |
| Growth | Growth: sequential and like-for-like YoY growth, FY cumulative, for any series |
| Look-up | Lookup: filterable table at any granularity, CSV download |
| Pending entries | Dashboard: chips for months with missing data. Tap one to open that month. |

**Complexity index** = average package level (R1 = 1, R2 = 2, R3 = 3). It puts complexity on one number you can compare across surgeons, quarters and years. R2+R3 % is shown beside it.

**Like-for-like YoY** compares only the months that have data with the same months a year earlier, so a part-year is never compared with a full year.

## Moving into new years
Nothing needs to be set up when a new financial year starts. The Data entry page has a **Financial year** picker that always offers the next FY. Each month shows as ✓ complete, • partly entered, or empty, and future months are greyed out. Report filters move to the newest FY automatically. Past months, such as the missing Jan–Mar 2024, can be entered at any time. New surgeons are added, and departed ones switched off, in **Admin** without losing their history.

## Architecture
- **Database:** Supabase Postgres (Mumbai region). Tables are prefixed `rp_` inside the existing project, isolated from the surgical-registry tables, because the free-plan project limit is reached. Row-level security plus an email allow-list (`rp_access`) with admin / editor / viewer roles.
- **App:** a static single page (`app/`), with no build step and vendored Chart.js + supabase-js. It is hosted on GitHub Pages and works on a phone.
- **Sign-in:** Google (same account as the registry) or an emailed magic link.

## Phases
- [x] **Phase 1 — Consolidate.** Merge the 5 workbooks and flag conflicts (reconciliation notes kept privately, outside this repo).
- [x] **Phase 2 — Database.** Schema, security, audit and historical load.
- [x] **Phase 3 — Online entry + reports.** The web app above.
- [ ] **Phase 4 — Go live.** Add the Pages URL to Supabase Auth redirect URLs, add colleagues' emails, enter Oct 2026.
- [ ] **Phase 5 — Version comparison.** Compare complexity across 2–3 "versions" (robot platform / programme phase — *to be confirmed*). The schema already carries a `platform` column on surgeon-level rows.
- [ ] **Phase 6 — Extras as needed.** A monthly PDF/email summary, targets vs actuals, R-package revenue (links to the billing analysis), more departments and surgeons (Admin tab, no code change).

## Monthly routine (≈2 minutes)
1. Open the app → **Data entry** (it opens on last month).
2. Type the hospital total and the 9 surgeon × package numbers (the Gastro total adds itself up).
3. **Save.** The dashboards update immediately.
