# Joint X OPPS Tracker Rules

This repo owns live OPPS production tracking. Treat production tracker behavior as a protected workflow.

- Do not collapse merch production into one vague "Production" state.
- Keep broad `orders.status` values stable unless the task explicitly requires schema/status workflow changes.
- Use `pipeline_stage` and the production detail fields to explain the actual work.
- Preserve production methods and detail stages for DTF, vinyl, screen printing, embroidery, pressing, tailoring, cropping / alterations, labeling, mixed, custom work, waiting for design assets, waiting on stock / blanks, QC, rework, and packing.
- Keep client-facing production updates separate from internal hold-up notes.
- Do not touch service worker, notifications, PayFast, X LAB sync, or payment flows as drive-by cleanup.
