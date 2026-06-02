# Tracker Production Rules

OPPS handles T-shirt and merch production. Do not treat `in_production` as one vague customer-facing state.

Keep the broad order status stable, then add production detail:

- Main status: confirmed, in production, ready, shipped, delivered.
- Production method: DTF, vinyl, screen printing, embroidery, pressing, tailoring, cropping / alterations, labeling, mixed, or custom.
- Detailed stage: waiting for design assets, artwork check, print setup, queued for pressing, pressing, queued for embroidery, embroidering, queued for tailor, at tailor, cropping / alterations, finishing, quality check, rework, waiting on stock / blanks, packing.
- Client-facing update: a short explanation visible on the tracker.
- Internal note: what is holding the job up or what the team needs to know.

When editing trackers, keep orders feeling active. A client should not see only "Production" for days when the order is actually pressing, embroidering, at tailor, waiting on assets, or in QC.
