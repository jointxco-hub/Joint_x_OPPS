# Sanitization Report

## Result

The bootstrap package is schema-only and data-free. Review found no production row values or credentials.

## Confirmed absent

- Production tenant, order, inventory, supplier, client, user, project, or auth identifiers
- Customer or supplier names
- Real order numbers, SKUs, quantities, stock totals, costs, or commercial terms
- Email addresses or phone numbers
- Auth identities, passwords, API keys, access tokens, project references, or credential-bearing URLs
- Production hostnames or database URLs
- Hashes derived from production rows or business totals
- Inventory Phase 1 tables, mappings, reservations, allocations, versions, or workflow fields

## Generic content retained

Only schema identifiers, generic status/default strings, column types, and the explicit local safety token `approved-local-only` are present. The token is not a secret and grants no database access.

The separate existing two-tenant seed remains the only proposed fixture source. It is not copied into this bootstrap.

## Repository baseline warning

Some checked-in migrations outside this package contain synthetic demo rows, public demo hostnames, test emails, product images, and fixed demo values. They were not copied into the bootstrap. Their treatment must be decided before a strict “no business rows after the full migration chain” assertion can pass.

