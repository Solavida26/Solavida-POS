# Daily EOD print layout — 12 November 2026

Implements the owner's sample: Sales Summary (Total Sales, Total TC) and Per Area Sales (Walk-in/North/South/Central) on the left; daily sales Payments and Previous Payments (credit collections received on the EOD business date) on the right. Cash reconciliation and remarks follow, then detailed sales with TC and previous collections. Other methods/areas remain visible when present. A4 portrait print, repeated detail headers, matching Excel-compatible CSV.

Total TC sums actual container quantities from completed orders, not orders or customers. Actual Cash Deposited / Counted uses the existing cash-reconciliation input and does not assert a bank deposit occurred. Missing actual cash/variance print as blanks for manual entry. No new deposit records, business writes, EOD reopening, authentication changes or schema changes. The existing EOD calculations are preserved; its order query now also reads the existing area column.

Validation: node tests/eod-layout.test.cjs passed calculations, TC/area totals, separate payment totals, variance, blank versus zero, cancelled sales, escaping, print/export parity, loaded-date guards and source wiring. Browser visual validation remains unavailable in this execution environment. The printable HTML and generated output were inspected in source; do not describe this as a browser test.

Rollback: restore index.html from 61ff0f216ec1cc080fd6139fc9c220246d69fc32. The new eod-layout.js then becomes unused. Existing report, cashier route-access and receipt features remain in that baseline.
