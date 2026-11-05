# Café Work Queue staging review

Status: hold. Read-only checks found 19 Café OPPS orders and five paid linked invoices. Sixteen orders have service-order links; three do not. All invoices are linked to existing OPPS orders, so the current UNION ALL draft may display duplicate-looking work cards.

Before staging: design one order card with linked invoice detail and standalone invoice cards, confirm order eligibility, test counter_staff role in the isolated database, cover additional invoice statuses synthetically, and review security/permissions. Do not run any staging or production migration without authorization.
