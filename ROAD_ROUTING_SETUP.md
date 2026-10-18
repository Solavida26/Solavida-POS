# Road routing — staged, not activated

Owner/Dispatcher-only Suggest stop order and Google Maps embedded road preview.
The dispatcher accepts the suggestion before saving via the existing trip planner.
Saved/departed trips are never silently reordered. Return to Solavida defaults on;
when unchecked the last selected stop remains the fixed endpoint.

## Activation gate
Do not merge/deploy until Google setup and live verification are complete.
No Google credentials or billing changes have been made by this branch.

1. Owner authorizes Google Cloud billing for Routes API.
2. Enable only Routes API and Maps Embed API. Use separate API-restricted keys:
   server Routes key; browser Embed key restricted to https://solavida-pos.onrender.com/*.
3. Verify a provider-side Routes quota, initially 100 requests/day (at most 3,100/month).
   Inspect other projects sharing the billing account: the free allowance is shared.
   This app cap alone cannot guarantee a zero bill. Budget alerts are not hard caps.
4. Set Supabase secrets GOOGLE_ROUTES_API_KEY, GOOGLE_MAPS_EMBED_KEY,
   GOOGLE_ROUTES_ENABLED=true, GOOGLE_ROUTES_QUOTA_CONFIRMED=true only after approval
   and actual quota verification. Otherwise the function fails closed.
5. Deploy delivery-road-route including its road-route.js dependency, with JWT
   verification enabled. The handler also checks session and dispatch permission.
6. Publish required Google-compatible Terms and Privacy pages before activation.
7. Verify Embed restriction, real road coverage, one approved calculation, quota,
   and denial for non-dispatch staff. No test sale or trip is necessary. Then merge UI.

## Request behavior
Opening/refreshing/saving never calls Compute Routes. Suggest stop order makes one
call, without automatic retries. Timeout retries may consume additional requests.
Embed map loads are separate from Compute Routes calls. 1–20 precisely pinned stops.
Returned order is validated as a full permutation. Estimates exclude traffic and
unloading/collection time. Google route results are shown on Google Maps, not OSM.
No persistent cache of Google geometry, estimates or API responses. Business records
save the dispatcher's confirmed sequence. No credentials or upstream errors logged.
Only coordinates, not customer names, are sent to Google for calculations.

Tests use simulated responses, not a connected Google account. Actual API verification
and final activation are still pending. Existing Live functionality is unchanged.
