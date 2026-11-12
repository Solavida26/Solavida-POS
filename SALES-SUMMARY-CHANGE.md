# Sales & Collections — 12 November 2026

Replaces the confusing generated-credit/payment-category summary with the owner's requested layout. The existing transaction list and audited correction controls remain available.

- Sales Summary: completed deliveries plus completed walk-in sales, using recorded business date; Total TC uses the recorded actual container quantity.
- Per Area: Walk-in, North, South, Central, plus any other/unassigned area actually present. Both Sales and TC reconcile to the summary.
- Payments: actual payment receipts by Philippine received date, plus non-cancelled credit collections by business date. Cash, GCash, Bank Transfer and Total. Other/Unspecified appears when nonzero so receipts are never hidden. A collection is not added to sales again.
- Collectibles: charge balances through the selected end date. Current means charges in the selected period; Previous includes all earlier charges. Account-level collections are allocated oldest-charge-first for reporting, independently per account. This is disclosed on screen, print and CSV; it does not alter ledger records. Later receipts do not reduce a historical end-date balance. Figures use current corrected records, not immutable historic snapshots.
- Summary, dedicated printable report and Excel-compatible CSV share one loaded snapshot. Changed dates require a fresh load before export or print. A read failure clears the summary; older overlapping requests cannot overwrite newer results.

No schema changes, record writes, login changes, new services or EOD changes. The report uses existing owner read permissions and paginated reads.

Validation: `node tests/sales-summary.test.cjs`, `node tests/sales-summary-ui.test.cjs`, plus the existing `npm test` and `npm run test:ui`. Browser tests use a simulated read-only database, never production transactions. Cases cover partial/cancelled/future collections, opening debts, account isolation, duplicate IDs, Philippine midnight, empty ranges, print/CSV parity, read failures, stale dates and mobile width.

Rollback: restore `index.html` from commit `6cb0413ed064c2e482947fdd77d041c8fca704ac` in a new commit on main. The old page has no reference to the new reporting module. Render redeploys main automatically. No database rollback is required. The baseline live index was verified against that commit's blob `9f1519b4d1fe310b6ecb113005cb4cfedc5683a1` before editing.

Verification passed: GitHub Actions run 43129489159 (job 130889788359), including the existing 48 route checks and browser checks plus the new calculation and browser tests. Independently reconciled the read-only production data for 1–12 November: Sales PHP 81,215; TC 3,892; receipts PHP 97,990; Current collectibles PHP 4,395; Previous PHP 3,995. No business records were changed.

Receipt-date observation: 41 payments totaling PHP 5,970 on 1 November sales have recorded Philippine receipt dates of 31 October. The report follows those stored receipt dates; it does not rewrite them.

Release tracked in PR #9. Render automatically publishes main to https://solavida-pos.onrender.com/. Browser screenshot reviewed before publication.
