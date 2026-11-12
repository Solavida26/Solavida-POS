# Dispatcher route progress — 12 November 2026

Jean Salimbagat already has an active personal login and Owner-granted dispatcher permission. Arrival and completion incorrectly required trip membership or Owner role. This change extends those checks to the existing dispatcher permission; it does not promote staff to Owner or grant other staff access.

Dispatchers can plan/depart, record reported arrival, complete deliveries through Orders, complete visits and finish trips. Proxy arrival requires a short note identifying the reporter. Audit fields retain the signed-in cashier; assigned drivers and contributors stay unchanged. Arrival-before-completion, duplicate-payment protection and completed-history restrictions remain in force. Only Owner can grant/revoke dispatcher access.

Apply integration/dispatcher-progress.sql to production only after the synthetic database and browser checks pass. The SQL replaces two functions and contains no business-record writes. The exact production definitions are backed up in integration/dispatcher-progress-rollback.sql. Rollback: apply that file and restore delivery-routes.js from commit 29cf7fd189151e6fa2974a85dc0c114da7c513d9. No data restore is required.

Tests extend the existing route suite with dispatcher cash/credit completion, attribution, revocation, denied unassigned staff, arrival prerequisites and duplicate prevention. Browser tests exercise cashier arrival, reporter note, Orders completion navigation and finish controls. Tests use synthetic data only.
