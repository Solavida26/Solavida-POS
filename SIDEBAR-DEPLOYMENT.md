# Approved sidebar layout — 15 November 2026

Removes the full-width header. Solavida branding is at the top of the left sidebar; the existing signed-in account and Sign Out button are at its bottom. Navigation scrolls independently to preserve account access on short screens. Content starts near the top of each page. The same existing logout element and event handler are retained.

No database changes, permission changes, sample records, or business transactions are introduced.

Verification: desktop, laptop, mobile portrait/landscape, bottom-left Sign Out visibility, Owner/Staff logout and cleared fields, existing delivery/trip and sales/EOD regression checks.

Rollback: restore index.html and visual-v93.css from commit c3e0cc4027c4f0209db79023ca1adf26d851b96e, retained at backup/pre-sidebar-20261115, in a new main commit. Prior live Render deployment: dep-dbs3dic9v7es73ben0kg. Business records are unaffected by this UI rollback.
