// Shelf inputs the borrow flow now requires from staff, for integration scripts.
//
// `get(path)` performs an authenticated GET through the gateway and resolves to the
// parsed JSON body (each script passes its own request helper).

async function pickOptions(get, { variantId, warehouseId, reservationId }) {
  const query = new URLSearchParams({ variant_id: variantId, warehouse_id: warehouseId, ...(reservationId ? { reservation_id: reservationId } : {}) });
  const body = await get(`/api/borrow-integration/pick-options?${query}`);
  return (body?.data || []).map((row) => ({ id: row.location_id, free: row.available_qty + row.held_qty, held: row.held_qty }));
}

/**
 * Shelves to report `quantity` copies as picked from: the shelves already holding the
 * reservation first, then the fullest. Comes up short when stock is short, so the
 * borrow call then fails as it would for a librarian.
 */
export async function shelfPicks(get, { variantId, warehouseId, quantity, reservationId }) {
  const rows = (await pickOptions(get, { variantId, warehouseId, reservationId }))
    .sort((a, b) => b.held - a.held || b.free - a.free);
  const picks = [];
  let left = quantity;
  for (const row of rows) {
    if (left === 0) break;
    const take = Math.min(row.free, left);
    if (take > 0) {
      picks.push({ location_id: row.id, quantity: take });
      left -= take;
    }
  }
  return picks;
}

/** Return body for a whole loan: every copy put back on the shelf holding most of its book. */
export async function returnToShelf(get, loanId) {
  const loanBody = await get(`/borrow/loans/${loanId}`);
  const loan = loanBody?.data || loanBody;
  const variantId = loan?.loan_items?.[0]?.variant_id;
  const rows = variantId ? await pickOptions(get, { variantId, warehouseId: loan.warehouse_id }) : [];
  let shelfId = rows.sort((a, b) => b.free - a.free)[0]?.id;
  if (!shelfId) {
    const locations = await get(`/api/warehouses/${loan.warehouse_id}/locations`);
    shelfId = (locations?.locations || []).find((location) => location.is_active)?.id;
  }
  if (!shelfId) throw new Error(`no shelf to return loan ${loanId} to`);
  return { returned_to_location_id: shelfId };
}
