const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId } = require("../utils/validation");

/**
 * Normalize ISBN by removing hyphens and spaces
 */
function normalizeIsbn(isbn) {
  if (!isbn) return null;
  return isbn.replace(/[-\s]/g, "").toUpperCase();
}

/**
 * Normalize text for comparison (lowercase, trim, collapse spaces)
 */
function normalizeText(text) {
  if (!text) return "";
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Calculate Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Calculate fuzzy match score (0-1)
 */
function fuzzyScore(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  if (s1 === s2) return 1;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(s1, s2);
  return 1 - distance / maxLen;
}

/**
 * Match a single extracted item against catalog
 */
async function matchSingleItem(item) {
  const isbn = normalizeIsbn(item.isbn || item.extracted_isbn);
  const title = item.title || item.extracted_title || "";

  // 1. Exact ISBN match
  if (isbn) {
    const exactMatch = await prisma.book_variants.findFirst({
      where: {
        OR: [
          { isbn13: isbn },
          { isbn10: isbn },
        ],
        is_active: true,
      },
      include: {
        books: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (exactMatch) {
      return {
        matched_variant_id: exactMatch.id,
        match_strategy: "EXACT_ISBN",
        match_confidence: 1.0,
        match_status: "MATCHED",
        matched_variant: exactMatch,
      };
    }
  }

  // 2. Normalized ISBN match (remove all non-digits)
  if (isbn) {
    const normalizedIsbn = isbn.replace(/\D/g, "");
    const normalizedMatch = await prisma.book_variants.findFirst({
      where: {
        OR: [
          { isbn13: { contains: normalizedIsbn } },
          { isbn10: { contains: normalizedIsbn } },
        ],
        is_active: true,
      },
      include: {
        books: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (normalizedMatch) {
      return {
        matched_variant_id: normalizedMatch.id,
        match_strategy: "NORMALIZED_ISBN",
        match_confidence: 0.95,
        match_status: "MATCHED",
        matched_variant: normalizedMatch,
      };
    }
  }

  // 3. Exact title match (case-insensitive)
  if (title.length >= 3) {
    const exactTitleMatch = await prisma.book_variants.findFirst({
      where: {
        books: {
          title: {
            equals: title,
            mode: "insensitive",
          },
        },
        is_active: true,
      },
      include: {
        books: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (exactTitleMatch) {
      return {
        matched_variant_id: exactTitleMatch.id,
        match_strategy: "EXACT_TITLE",
        match_confidence: 0.85,
        match_status: "LOW_CONFIDENCE",
        matched_variant: exactTitleMatch,
      };
    }
  }

  // 4. Fuzzy title match
  if (title.length >= 3) {
    // Get all active variants for fuzzy matching
    const candidates = await prisma.book_variants.findMany({
      where: { is_active: true },
      include: {
        books: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      take: 100,
    });

    let bestMatch = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const candidateTitle = candidate.books?.title || "";
      const score = fuzzyScore(title, candidateTitle);

      if (score > bestScore && score >= 0.7) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    if (bestMatch) {
      return {
        matched_variant_id: bestMatch.id,
        match_strategy: "FUZZY_TITLE",
        match_confidence: bestScore,
        match_status: bestScore >= 0.85 ? "MATCHED" : "LOW_CONFIDENCE",
        matched_variant: bestMatch,
      };
    }
  }

  // 5. No match found
  return {
    matched_variant_id: null,
    match_strategy: null,
    match_confidence: 0,
    match_status: "UNMATCHED",
    matched_variant: null,
  };
}

/**
 * POST /receiving-smart/match
 * Match extracted items against catalog
 */
async function matchItems(req, res) {
  const { items, warehouse_id } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      message: "Invalid payload: items must be a non-empty array"
    });
  }

  try {
    // Match each item
    const results = [];
    for (const item of items) {
      const match = await matchSingleItem(item);
      results.push({
        index: results.length,
        title: item.title || item.extracted_title || "",
        isbn: item.isbn || item.extracted_isbn || "",
        quantity: item.quantity || item.extracted_quantity || 1,
        unit_price: item.unit_price || item.extracted_unit_price || 0,
        ...match,
      });
    }

    // Summary
    const summary = {
      total: results.length,
      matched: results.filter((r) => r.match_status === "MATCHED").length,
      low_confidence: results.filter((r) => r.match_status === "LOW_CONFIDENCE").length,
      unmatched: results.filter((r) => r.match_status === "UNMATCHED").length,
    };

    return res.json({
      success: true,
      results,
      summary,
    });
  } catch (error) {
    console.error("Error matching items:", error);
    return res.status(500).json({
      message: "Internal server error while matching items",
    });
  }
}

/**
 * Generate receipt number for smart receiving
 */
async function generateReceiptNumber() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `SR-${dateStr}`;

  const lastReceipt = await prisma.goods_receipts.findFirst({
    where: {
      receipt_number: {
        startsWith: prefix,
      },
    },
    orderBy: {
      receipt_number: "desc",
    },
    select: {
      receipt_number: true,
    },
  });

  let sequence = 1;
  if (lastReceipt) {
    const lastSeq = parseInt(lastReceipt.receipt_number.split("-").pop() || "0");
    sequence = lastSeq + 1;
  }

  return `${prefix}-${sequence.toString().padStart(4, "0")}`;
}

/**
 * POST /receiving-smart/drafts
 * Create a smart receiving draft
 */
async function createDraft(req, res) {
  const {
    warehouse_id,
    supplier_name,
    invoice_number,
    invoice_date,
    raw_extraction,
    source_file_name,
    source_file_type,
    items,
    user_id,
  } = req.body;

  // Validation
  if (!warehouse_id) {
    return res.status(400).json({ message: "warehouse_id is required" });
  }
  if (!user_id) {
    return res.status(400).json({ message: "user_id is required" });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      message: "items must be a non-empty array"
    });
  }

  try {
    // Create draft with items
    const draft = await prisma.smart_receiving_drafts.create({
      data: {
        warehouse_id,
        supplier_name: supplier_name || null,
        invoice_number: invoice_number || null,
        invoice_date: invoice_date ? new Date(invoice_date) : null,
        raw_extraction: raw_extraction || {},
        source_file_name: source_file_name || null,
        source_file_type: source_file_type || null,
        status: "DRAFT",
        created_by_user_id: user_id,
        smart_receiving_items: {
          create: items.map((item) => ({
            extracted_title: item.title || item.extracted_title || null,
            extracted_isbn: item.isbn || item.extracted_isbn || null,
            extracted_quantity: item.quantity || item.extracted_quantity || 1,
            extracted_unit_price: item.unit_price || item.extracted_unit_price || 0,
            matched_variant_id: item.matched_variant_id || null,
            match_strategy: item.match_strategy || null,
            match_confidence: item.match_confidence || null,
            match_status: item.match_status || "UNMATCHED",
          })),
        },
      },
      include: {
        smart_receiving_items: {
          include: {
            book_variants: {
              include: {
                books: true,
              },
            },
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      draft_id: draft.id,
      status: draft.status,
      items_count: draft.smart_receiving_items.length,
      draft,
    });
  } catch (error) {
    console.error("Error creating smart receiving draft:", error);
    return res.status(500).json({
      message: "Internal server error while creating draft",
    });
  }
}

/**
 * GET /receiving-smart/drafts/:id
 * Get draft details
 */
async function getDraft(req, res) {
  const draftId = parseId(req.params.id);

  if (!draftId) {
    return res.status(400).json({ message: "Invalid draft id" });
  }

  try {
    const draft = await prisma.smart_receiving_drafts.findUnique({
      where: { id: draftId },
      include: {
        smart_receiving_items: {
          include: {
            book_variants: {
              include: {
                books: true,
              },
            },
          },
          orderBy: { created_at: "asc" },
        },
        warehouses: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft not found" });
    }

    return res.json({
      success: true,
      draft,
    });
  } catch (error) {
    console.error("Error getting draft:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

/**
 * GET /receiving-smart/drafts
 * List all drafts
 */
async function listDrafts(req, res) {
  const { warehouse_id, status, page = 1, limit = 20 } = req.query;

  const where = {};
  if (warehouse_id) where.warehouse_id = warehouse_id;
  if (status) where.status = status;

  try {
    const [drafts, total] = await Promise.all([
      prisma.smart_receiving_drafts.findMany({
        where,
        include: {
          smart_receiving_items: {
            select: {
              id: true,
              match_status: true,
            },
          },
          warehouses: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.smart_receiving_drafts.count({ where }),
    ]);

    return res.json({
      success: true,
      drafts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error listing drafts:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

/**
 * PUT /receiving-smart/drafts/:id
 * Update draft items (user corrections)
 */
async function updateDraft(req, res) {
  const draftId = parseId(req.params.id);

  if (!draftId) {
    return res.status(400).json({ message: "Invalid draft id" });
  }

  const { items } = req.body;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({
      message: "items must be an array",
    });
  }

  try {
    const draft = await prisma.smart_receiving_drafts.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft not found" });
    }

    if (draft.status !== "DRAFT") {
      return res.status(400).json({
        message: "Can only update DRAFT drafts",
      });
    }

    // Update each item
    for (const itemUpdate of items) {
      if (!itemUpdate.id) continue;

      await prisma.smart_receiving_items.update({
        where: { id: itemUpdate.id },
        data: {
          corrected_variant_id: itemUpdate.corrected_variant_id || null,
          corrected_quantity: itemUpdate.corrected_quantity || null,
          is_user_corrected: itemUpdate.is_user_corrected || false,
          match_status: itemUpdate.match_status || "MANUAL_CORRECTED",
          updated_at: new Date(),
        },
      });
    }

    // Get updated draft
    const updatedDraft = await prisma.smart_receiving_drafts.findUnique({
      where: { id: draftId },
      include: {
        smart_receiving_items: {
          include: {
            book_variants: {
              include: {
                books: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      success: true,
      draft: updatedDraft,
    });
  } catch (error) {
    console.error("Error updating draft:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

/**
 * POST /receiving-smart/drafts/:id/convert
 * Convert draft to goods receipt
 */
async function convertDraft(req, res) {
  const draftId = parseId(req.params.id);
  const { user_id } = req.body;

  if (!draftId) {
    return res.status(400).json({ message: "Invalid draft id" });
  }
  if (!user_id) {
    return res.status(400).json({ message: "user_id is required" });
  }

  try {
    const draft = await prisma.smart_receiving_drafts.findUnique({
      where: { id: draftId },
      include: {
        smart_receiving_items: true,
      },
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft not found" });
    }

    if (draft.status !== "DRAFT") {
      return res.status(400).json({
        message: `Cannot convert draft with status: ${draft.status}`,
      });
    }

    // Get valid items (must have matched_variant_id or corrected_variant_id)
    const validItems = draft.smart_receiving_items.filter(
      (item) => item.matched_variant_id || item.corrected_variant_id
    );

    if (validItems.length === 0) {
      return res.status(400).json({
        message: "No items with matched variants to convert",
      });
    }

    // Generate receipt number
    const receiptNumber = await generateReceiptNumber();

    // Create goods receipt
    const goodsReceipt = await prisma.goods_receipts.create({
      data: {
        receipt_number: receiptNumber,
        warehouse_id: draft.warehouse_id,
        source_type: "SMART_RECEIVING",
        source_reference_id: draft.id,
        status: "DRAFT",
        received_by_user_id: user_id,
        note: `Smart Receiving - Invoice: ${draft.invoice_number || "N/A"}`,
      },
    });

    // Create goods receipt items
    for (const item of validItems) {
      const variantId = item.corrected_variant_id || item.matched_variant_id;
      const quantity = item.corrected_quantity || item.extracted_quantity;

      await prisma.goods_receipt_items.create({
        data: {
          goods_receipt_id: goodsReceipt.id,
          variant_id: variantId,
          quantity: quantity,
          unit_cost: item.extracted_unit_price,
          condition_grade: "NEW",
        },
      });

      // Link back to smart_receiving_item
      await prisma.smart_receiving_items.update({
        where: { id: item.id },
        data: {
          goods_receipt_item_id: (await prisma.goods_receipt_items.findFirst({
            where: {
              goods_receipt_id: goodsReceipt.id,
              variant_id: variantId,
            },
            orderBy: { id: "desc" },
          }))?.id,
        },
      });
    }

    // Update draft status
    await prisma.smart_receiving_drafts.update({
      where: { id: draftId },
      data: {
        status: "CONVERTED",
        goods_receipt_id: goodsReceipt.id,
        updated_at: new Date(),
      },
    });

    return res.json({
      success: true,
      message: "Draft converted to goods receipt",
      goods_receipt_id: goodsReceipt.id,
      receipt_number: receiptNumber,
      items_count: validItems.length,
    });
  } catch (error) {
    console.error("Error converting draft:", error);
    return res.status(500).json({
      message: "Internal server error while converting draft",
    });
  }
}

/**
 * DELETE /receiving-smart/drafts/:id
 * Cancel a draft
 */
async function cancelDraft(req, res) {
  const draftId = parseId(req.params.id);

  if (!draftId) {
    return res.status(400).json({ message: "Invalid draft id" });
  }

  try {
    const draft = await prisma.smart_receiving_drafts.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft not found" });
    }

    if (draft.status !== "DRAFT") {
      return res.status(400).json({
        message: "Can only cancel DRAFT drafts",
      });
    }

    await prisma.smart_receiving_drafts.update({
      where: { id: draftId },
      data: {
        status: "CANCELLED",
        updated_at: new Date(),
      },
    });

    return res.json({
      success: true,
      message: "Draft cancelled",
    });
  } catch (error) {
    console.error("Error cancelling draft:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

module.exports = {
  matchItems,
  createDraft,
  getDraft,
  listDrafts,
  updateDraft,
  convertDraft,
  cancelDraft,
};
