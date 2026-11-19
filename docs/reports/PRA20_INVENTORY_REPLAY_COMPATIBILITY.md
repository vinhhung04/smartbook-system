PRA20 Inventory replay compatibility

New reserve requests bind their normalized original actor, creator, external
reservation ID/number, customer, variant, warehouse, quantity, expiry in UTC and
effective customer/staff channel. The immutable creation identity is saved with
the RESERVE stock movement. Quantity strings and equivalent timestamp offsets
compare by their business values. The original key is required for a replay;
a second key cannot take ownership of an existing external reservation ID.

Ordinary authenticated callers cannot replace their actor using a body field.
Only the authenticated reserved Borrow service principal, with its exact signed
service/issuer/audience claims, can retain the approved original creator during
saga recovery. No raw user JWT is persisted. An original-key retry of a released
reservation returns its terminal record and never reserves stock again.

New supplier-delivery GRNs save the normalized creation identity in their
GOODS_RECEIPT_CREATED_FROM_SUPPLIER_INVOICE audit record, inside the creation
transaction. Actor, delivery/warehouse, counts, costs, locations and notes are
bound. Item ordering and equivalent numbers do not change identity. Later draft
counting, assignment, posting or notes do not rewrite the original request.
Normal replay and concurrent unique-key recovery apply the same checks.

Historical requests

Older reserve movements do not preserve both verified original caller and
reservation channel. Older GRN rows can have edited counts, costs, notes and
assignment; a current row is not evidence of its original request. These cases
return HTTP409 with LEGACY_RESERVE_RECONCILIATION_REQUIRED or
LEGACY_RECEIPT_RECONCILIATION_REQUIRED. Changed normalized new requests return
IDEMPOTENCY_PAYLOAD_CONFLICT. No schema backfill invents missing identity.

Safe operator handling

1. Keep the original key, external IDs and response. Do not create fresh keys to
   force a retry, edit movement metadata, or alter historical creation audits.
2. For a reserve, use the authorized Borrow reconciliation workflow and the
   internal read-only Inventory evidence endpoint to compare the approved
   persisted intent with the exact remote hold, consume/return movements and
   local reservation/loan. An incomplete/truncated snapshot is not proof that a
   movement is absent. If original authority or payload cannot be established,
   retain manual review rather than resume automatically.
3. Release/cancel only through the existing authorized business command, with
   its own stable key and verified current custody. A replacement reservation
   needs a new business ID after the original outcome is reconciled.
4. For a GRN, compare the actual supplier delivery, receipt and stock movements.
   A manager may cancel and recreate only when the existing cancellation checks
   permit reversal and the physical counts are verified. If stock has already
   moved or been borrowed, leave it for reconciliation; do not bypass reversal
   checks or create a second active receipt for that delivery.

This is an intentional fail-closed upgrade boundary. The service preserves
historical records and exposes an explicit review condition instead of silently
claiming that a caller-supplied replacement payload was the original request.
