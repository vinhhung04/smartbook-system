const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function mapMovementType(rawType, fromLocationId, toLocationId) {
  const normalized = String(rawType || '').toUpperCase();

  if (normalized.includes('TRANSFER') || (fromLocationId && toLocationId)) {
    return 'transfer';
  }

  if (normalized.includes('OUT')) {
    return 'outbound';
  }

  return 'inbound';
}

async function getStockMovements(req, res) {
  try {
    const movements = await prisma.stock_movements.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        book_variants: {
          select: {
            id: true,
            sku: true,
            isbn13: true,
            isbn10: true,
            internal_barcode: true,
            books: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
        warehouses: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        locations_stock_movements_from_location_idTolocations: {
          select: {
            id: true,
            location_code: true,
          },
        },
        locations_stock_movements_to_location_idTolocations: {
          select: {
            id: true,
            location_code: true,
          },
        },
      },
      take: 500,
    });

    const data = movements.map((movement) => {
      const fromLocation = movement.locations_stock_movements_from_location_idTolocations;
      const toLocation = movement.locations_stock_movements_to_location_idTolocations;
      const type = mapMovementType(movement.movement_type, movement.from_location_id, movement.to_location_id);

      const transferNote = fromLocation && toLocation
        ? `${fromLocation.location_code} -> ${toLocation.location_code}`
        : null;

      return {
        id: movement.id,
        movement_number: movement.movement_number,
        created_at: movement.created_at,
        movement_type: movement.movement_type,
        type,
        quantity: movement.quantity,
        delta: type === 'outbound' ? -movement.quantity : movement.quantity,
        unit_cost: Number(movement.unit_cost || 0),
        warehouse_id: movement.warehouse_id,
        warehouse_name: movement.warehouses?.name || null,
        warehouse_code: movement.warehouses?.code || null,
        from_location_id: movement.from_location_id,
        to_location_id: movement.to_location_id,
        from_location_code: fromLocation?.location_code || null,
        to_location_code: toLocation?.location_code || null,
        transfer_note: transferNote,
        variant_id: movement.variant_id,
        sku: movement.book_variants?.sku || null,
        barcode:
          movement.book_variants?.internal_barcode
          || movement.book_variants?.isbn13
          || movement.book_variants?.isbn10
          || null,
        book_id: movement.book_variants?.books?.id || null,
        book_title: movement.book_variants?.books?.title || 'Chưa có tên sách',
        created_by_user_id: movement.created_by_user_id,
        reference_type: movement.reference_type,
        reference_id: movement.reference_id,
      };
    });

    return res.json(data);
  } catch (error) {
    console.error('Error while fetching stock movements:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getStockMovements,
};
