# Compact cashier trip desk — 2026-11-14

Approved preview integrated into the existing live application source, preserving the original delivery completion RPC and 58 mm receipt content.

- Delivery / Map: one row per trip, search by driver/personnel/area/customer, status opens a compact customer list.
- Individual or all-trip receipts use the existing approved receipt; batch uses one print window with a page break between receipts.
- Arrived records the existing audited arrival then opens the existing delivery form without leaving the trip.
- Completion retains actual quantities, received-by, returned containers, contributors, cash/credit and payment method. Repeated submissions are guarded while saving; database protections remain unchanged.
- Finish Trip is enabled only when all stops are completed/skipped. Existing database validation remains authoritative.
- Owner Reports remain read-only, including trip history, departure/finish and HH:MM:SS duration.

No production database/schema changes or test business transactions are required or performed for this UI release.

## Verification

Local checks: JavaScript syntax; 59 isolated database route checks; sales summary and EOD calculation tests; desktop/mobile route UI tests; actual order completion popup and unchanged RPC payload; batch receipt content; sales-summary UI tests. UI tests block all network requests except local files and supply isolated sample fixtures.

## Rollback

Pre-change application: `5be27ce59d08d68311584e369056ce2952400fe1`, GitHub branch `backup/pre-trip-desk-20261114`.
Previous live Render deployment: `dep-dbrt22u417fc73esk2dg`.
Restore the three application files (`index.html`, `delivery-routes.js`, `delivery-receipt.js`) from the backup commit in a new commit on main, then verify Render publishes that commit. This does not reverse any store transactions or change inventory/customer/payment records.

## Store use

Refresh only after saving any unfinished order. Delivery / Map → find trip → status → print receipts / record arrival / complete delivery → Finish Trip.
