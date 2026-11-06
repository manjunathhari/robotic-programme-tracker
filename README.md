# Robotic Programme Tracker — Manipal Hospital Whitefield

Online database, monthly data entry and reports for the robotic surgery programme. It covers hospital totals, department and surgeon contribution, R1/R2/R3 complexity, and growth by month, quarter and financial year.

- **Plan & roadmap:** [PLAN.md](PLAN.md)
- **Database schema:** [db/001_schema.sql](db/001_schema.sql)

## Layout
```
app/            static web app (index.html, app.js, styles.css, config.js, vendor/)
db/             SQL schema (already applied to Supabase)
.github/        GitHub Pages deploy workflow
```

## One-time setup
1. **Supabase → Authentication → URL Configuration → Redirect URLs:** add the GitHub Pages URL of this app. Without it, sign-in returns to the registry app instead.
2. Sign in once, then open **Admin** and add colleagues' emails with a role (viewer / editor / admin).

## Run locally
Serve `app/` with any static server (`python3 -m http.server -d app 8080`) and open http://localhost:8080. Add `http://localhost:8080` to the Supabase redirect URLs first.

## Data rules
- Months are stored as the first day of the month. The financial year runs April–March.
- Blank ≠ zero. Leave a box empty if the number isn't known yet.
- Gastro total = sum of the surgeon grid unless typed in separately. The app warns when they disagree.
- Every insert, update and delete is written to `rp_audit`.

## Data privacy
This repository holds code only. No case numbers are stored here. All programme data lives in Supabase, readable only by signed-in emails on the access list. The Supabase URL and publishable key in `app/config.js` are public by design; row-level security is what protects the data.
