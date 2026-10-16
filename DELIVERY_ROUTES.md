# Solavida V90 delivery routes — pre-release

This extends the saved V89.1 delivery-performance and EOD-export improvements, based on V88 main commit 17b27c773990895c500dae1871808d469006330f. Existing database connection and financial completion RPC remain unchanged.

## Owner / dispatcher
1. Open Delivery / Map and choose the delivery date. Area is optional.
2. Check pending orders. Customers can be from different areas. Move selected stops up to set the sequence.
3. Check all personnel, choose the driver, and Save route.
4. Check the saved trip, then Mark on the way at actual departure. This updates the linked Orders atomically.
5. Use Show route on map to reopen a saved route. Missing locations remain list entries; no coordinates are guessed.
6. Add verified customer coordinates using Pin. Other customers can be added as visits, not automatic sales.
7. Owner can grant dispatcher access to an active employee who has a personal login.

## Delivery personnel
Use the assigned trip, Open navigation, then Arrived. Open order / Complete delivery uses the existing quantities, returns, cash and credit process. Finish trip after every stop is completed. Times come from the database server.

Personnel without personal logins can be assigned. They cannot personally confirm arrival until they have accounts. An Owner proxy arrival requires a note and records the Owner's identity. A tap is a declaration, not GPS proof of attendance.

## Owner report
Owner's Reports → Delivery Routes uses the existing date range. Trip numbers are four digits, numbered separately each Philippine business date; always identify a trip with its date. Expand a trip for recorded times, quantities, personnel and activity. Export for Excel downloads CSV; Print provides a printable report.

Original departure stop order and locations are retained. Later authorized reorder actions require a reason. Completion quantities are snapshots; existing Owner financial corrections continue through their existing audited process and do not rewrite the route snapshot.

## Current limits
- Manual ordering and straight connecting lines only. No automatic road optimization, driving-minute estimates, live GPS tracking or fuel-cost claim.
- Coordinates currently require verified latitude/longitude. Google Maps navigation opens only on user request. OpenStreetMap tiles and Leaflet require network access; list operations remain available if the map cannot load.
- Visit outcomes are notes. They do not post empty-container returns into an inventory ledger or create a sale.
- A saved unstarted plan can be cancelled with a reason and recreated. Orders remain pending, and the cancelled route audit remains. Personnel cannot yet be replaced after departure; only stop sequence can be changed with authorization.
- Refresh retrieves new orders and progress; no background live tracking.

## Validation
`npm ci`, `npm test`, `npm run test:ui` (requires `npx playwright install chromium`). PostgreSQL tests use an isolated PGlite database, synthetic fixtures and the original live delivery RPC definitions. Browser tests intercept all external requests; they do not contact or write the live database. No real test sales are inserted.

## Deployment gate — NOT YET DEPLOYED
Before applying the migration, verify a recoverable backup for Supabase project novgwsnjlgrkzqnpajlx and retain recovery details privately. Do not substitute a schema-only snapshot for a data backup. Connected tools currently do not expose backup status.

Recheck current main and live schema for concurrent changes. Apply supabase/migrations/20261014124432_delivery_routes.sql once using the migration mechanism. The migration adds tables, guarded RPCs, RLS and two order triggers. It does not rewrite existing rows, replace financial functions, or delete business records.

Then merge the verified branch to main and verify Render service srv-db3l4p60tbcc738001v0 at https://solavida-pos.onrender.com. Owner login and deployed map/report must be checked without disposable live orders. Do not declare successful deployment until verified.

## Rollback
Before dispatching real trips, retain the main commit above and the previous frontend. If a frontend rollback is needed after real trips exist, preserve all route tables/events. Coordinate active trips first: reverting the UI alone removes arrival controls while the new order guard still requires them. A database administrator can disable ONLY the new delivery_order_guard trigger as a temporary emergency compatibility measure, retaining delivery_order_record to capture completions. Do not drop route tables or restore an old database over current sales. Record the reason, time and responsible administrator; re-enable the guard when the route interface is restored.
