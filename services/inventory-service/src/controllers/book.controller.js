const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const UNCATEGORIZED_NAME = 'Chưa phân loại';
const UNCATEGORIZED_SLUG = 'chua-phan-loai';
const UNCATEGORIZED_PUBLISHER_CODE = 'UNCATEGORIZED-PUBLISHER';

function parseId(value) {
  return String(value || '').trim() || null;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function mapBookSummary(book) {
  const authorName = book.book_authors?.[0]?.authors?.full_name || 'Chưa cập nhật';
  const categoryName = book.book_categories?.[0]?.categories?.name || 'Chưa phân loại';
  const variants = book.book_variants || [];
  const locationMap = new Map();

  const quantity = variants.reduce((bookSum, variant) => {
    const stockQty = (variant.stock_balances || []).reduce((sum, stock) => {
      const currentQty = stock.on_hand_qty || 0;

      if (currentQty > 0) {
        const locationCode = stock.locations?.location_code || '-';
        const warehouseName = stock.warehouses?.name || stock.warehouses?.code || 'Kho';
        const key = `${stock.warehouse_id}:${stock.location_id}`;
        const existing = locationMap.get(key);

        if (existing) {
          existing.quantity += currentQty;
        } else {
          locationMap.set(key, {
            warehouse_id: stock.warehouse_id,
            location_id: stock.location_id,
            warehouse_name: warehouseName,
            location_code: locationCode,
            quantity: currentQty,
            label: `${warehouseName} / ${locationCode}`,
          });
        }
      }

      return sum + currentQty;
    }, 0);
    return bookSum + stockQty;
  }, 0);

  const firstVariant = variants[0] || null;
  const locations = Array.from(locationMap.values()).sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label));
  const locationSummary = locations.length > 0 ? `${locations[0].label}${locations.length > 1 ? ` +${locations.length - 1}` : ''}` : '-';
  const defaultLocation = locations[0] || null;

  return {
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    description: book.description,
    summary_vi: book.metadata?.summary_vi || null,
    author: authorName,
    category: categoryName,
    publisher: book.publishers?.name || 'Chưa cập nhật',
    isbn: firstVariant?.isbn13 || firstVariant?.isbn10 || firstVariant?.internal_barcode || firstVariant?.sku || '-',
    language: firstVariant?.language_code || book.default_language || 'vi',
    publish_year: firstVariant?.publish_year || null,
    list_price: Number(firstVariant?.list_price || 0),
    unit_cost: Number(firstVariant?.unit_cost || 0),
    cover_image_url: firstVariant?.cover_image_url || null,
    variant_id: firstVariant?.id || null,
    default_warehouse_id: defaultLocation?.warehouse_id || null,
    default_location_id: defaultLocation?.location_id || null,
    reservable: Boolean(firstVariant?.id && defaultLocation?.warehouse_id && quantity > 0),
    location: locationSummary,
    locations,
    location_count: locations.length,
    quantity,
    is_incomplete: Boolean(book.metadata?.is_incomplete),
    variant_count: variants.length,
    created_at: book.created_at,
    updated_at: book.updated_at,
  };
}

async function getAllBooks(req, res) {
  try {
    const search = String(req.query?.search || req.query?.q || '').trim().toLowerCase();
    const authorFilter = String(req.query?.author || '').trim().toLowerCase();
    const categoryFilter = String(req.query?.category || '').trim().toLowerCase();
    const publisherFilter = String(req.query?.publisher || '').trim().toLowerCase();
    const availability = String(req.query?.availability || '').trim().toLowerCase();

    const books = await prisma.books.findMany({
      include: {
        publishers: {
          select: {
            id: true,
            name: true,
          },
        },
        book_authors: {
          orderBy: { author_order: 'asc' },
          include: {
            authors: {
              select: {
                id: true,
                full_name: true,
              },
            },
          },
        },
        book_categories: {
          include: {
            categories: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        book_variants: {
          include: {
            stock_balances: {
              include: {
                warehouses: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                  },
                },
                locations: {
                  select: {
                    id: true,
                    location_code: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    let rows = books.map(mapBookSummary);

    if (search) {
      rows = rows.filter((row) => {
        const tokens = [row.title, row.author, row.category, row.publisher, row.isbn]
          .map((v) => String(v || '').toLowerCase());
        return tokens.some((token) => token.includes(search));
      });
    }

    if (authorFilter) {
      rows = rows.filter((row) => String(row.author || '').toLowerCase().includes(authorFilter));
    }

    if (categoryFilter) {
      rows = rows.filter((row) => String(row.category || '').toLowerCase().includes(categoryFilter));
    }

    if (publisherFilter) {
      rows = rows.filter((row) => String(row.publisher || '').toLowerCase().includes(publisherFilter));
    }

    if (availability === 'available') {
      rows = rows.filter((row) => Number(row.quantity || 0) > 0);
    } else if (availability === 'unavailable') {
      rows = rows.filter((row) => Number(row.quantity || 0) <= 0);
    }

    return res.json(rows);
  } catch (error) {
    console.error('Error while fetching books:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getBookById(req, res) {
  const bookId = parseId(req.params.id);

  if (!bookId) {
    return res.status(400).json({ message: 'Invalid book id' });
  }

  try {
    const book = await prisma.books.findUnique({
      where: { id: bookId },
      include: {
        publishers: {
          select: {
            id: true,
            name: true,
          },
        },
        book_authors: {
          orderBy: { author_order: 'asc' },
          include: {
            authors: {
              select: {
                id: true,
                full_name: true,
              },
            },
          },
        },
        book_categories: {
          include: {
            categories: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        book_variants: {
          include: {
            stock_balances: {
              include: {
                warehouses: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                  },
                },
                locations: {
                  select: {
                    id: true,
                    location_code: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    return res.json(mapBookSummary(book));
  } catch (error) {
    console.error('Error while fetching book by id:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

function normalizeBarcode(value) {
  return String(value || '').trim();
}

function normalizeIsbn13(value) {
  const normalized = String(value || '').trim().replace(/[^0-9]/g, '');
  if (!normalized) return '';
  return normalized;
}

function buildManualSku(barcode) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const compactBarcode = barcode.replace(/\s+/g, '').slice(0, 16);
  return `MANUAL-${compactBarcode || 'BOOK'}-${suffix}`;
}

function normalizeCoverImageUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith('data:image/')) return normalized;
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
  return null;
}

function normalizeLanguageCode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return normalized.slice(0, 10);
}

function normalizePublishYear(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 2100) {
    return undefined;
  }

  return parsed;
}

async function getOrCreateUncategorizedCategory(tx) {
  return tx.categories.upsert({
    where: { slug: UNCATEGORIZED_SLUG },
    update: {},
    create: {
      name: UNCATEGORIZED_NAME,
      slug: UNCATEGORIZED_SLUG,
      description: 'Danh mục tạm cho sách mới cần thủ thư hoàn thiện thông tin.',
    },
  });
}

async function getOrCreateUncategorizedPublisher(tx) {
  const existing = await tx.publishers.findFirst({
    where: { name: UNCATEGORIZED_NAME },
  });

  if (existing) {
    return existing;
  }

  return tx.publishers.create({
    data: {
      code: UNCATEGORIZED_PUBLISHER_CODE,
      name: UNCATEGORIZED_NAME,
      address: 'Tạm thời',
    },
  });
}

async function findBookByBarcode(req, res) {
  const barcode = normalizeBarcode(req.params.barcode || req.query.barcode);

  if (!barcode) {
    return res.status(400).json({ message: 'barcode is required' });
  }

  try {
    const variant = await prisma.book_variants.findFirst({
      where: {
        OR: [
          { internal_barcode: barcode },
          { isbn13: barcode },
          { isbn10: barcode },
          { sku: barcode },
        ],
      },
      include: {
        books: {
          select: {
            id: true,
            title: true,
            metadata: true,
          },
        },
      },
    });

    if (!variant) {
      return res.status(404).json({ message: 'Book variant not found by barcode' });
    }

    return res.json({
      variant_id: variant.id,
      barcode,
      title: variant.books?.title || 'Chưa có tiêu đề',
      unit_cost: variant.unit_cost,
      list_price: variant.list_price,
      is_incomplete: Boolean(variant.books?.metadata?.is_incomplete),
      book_id: variant.books?.id,
    });
  } catch (error) {
    console.error('Error while finding book by barcode:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function findBookByIsbn13(req, res) {
  const isbn13 = normalizeIsbn13(req.params.isbn13 || req.query.isbn13 || req.query.barcode);

  if (!isbn13) {
    return res.status(400).json({ message: 'isbn13 is required' });
  }

  if (!/^\d{13}$/.test(isbn13)) {
    return res.status(400).json({ message: 'isbn13 must contain exactly 13 digits' });
  }

  try {
    const variant = await prisma.book_variants.findFirst({
      where: { isbn13 },
      include: {
        books: {
          select: {
            id: true,
            title: true,
            metadata: true,
          },
        },
      },
    });

    if (!variant) {
      return res.status(404).json({ message: 'Book variant not found by isbn13' });
    }

    return res.json({
      variant_id: variant.id,
      isbn13,
      barcode: variant.internal_barcode || isbn13,
      title: variant.books?.title || 'Chưa có tiêu đề',
      unit_cost: variant.unit_cost,
      list_price: variant.list_price,
      is_incomplete: Boolean(variant.books?.metadata?.is_incomplete),
      book_id: variant.books?.id,
    });
  } catch (error) {
    console.error('Error while finding book by isbn13:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createIncompleteBook(req, res) {
  const rawIsbn13 = normalizeIsbn13(req.body?.isbn13);
  const barcode = normalizeBarcode(req.body?.barcode || rawIsbn13);
  const isbn13 = rawIsbn13 || (/^\d{13}$/.test(barcode) ? barcode : '');
  const title = String(req.body?.title || '').trim();
  const rawPrice = Number(req.body?.price);
  const coverImageUrl = normalizeCoverImageUrl(req.body?.cover_image_url);
  const languageCode = normalizeLanguageCode(req.body?.language) || 'vi';
  const publishYear = normalizePublishYear(req.body?.publish_year);
  const userId = req.user?.id || null;

  if (!isbn13 || !title || !Number.isFinite(rawPrice) || rawPrice < 0) {
    return res.status(400).json({
      message: 'isbn13, title and price >= 0 are required',
    });
  }

  if (!/^\d{13}$/.test(isbn13)) {
    return res.status(400).json({ message: 'isbn13 must contain exactly 13 digits' });
  }

  if (publishYear === undefined) {
    return res.status(400).json({ message: 'publish_year must be an integer from 1000 to 2100' });
  }

  try {
    const existingVariant = await prisma.book_variants.findFirst({
      where: {
        OR: [{ isbn13 }, { internal_barcode: isbn13 }, { isbn10: isbn13 }, { sku: isbn13 }],
      },
      include: {
        books: {
          select: {
            id: true,
            title: true,
            metadata: true,
          },
        },
      },
    });

    if (existingVariant) {
      return res.status(200).json({
        message: 'Book variant already exists',
        data: {
          book_id: existingVariant.books?.id,
          variant_id: existingVariant.id,
          barcode: existingVariant.internal_barcode || isbn13,
          isbn13: existingVariant.isbn13 || isbn13,
          title: existingVariant.books?.title,
          unit_cost: existingVariant.unit_cost,
          list_price: existingVariant.list_price,
          language: existingVariant.language_code,
          publish_year: existingVariant.publish_year,
          is_incomplete: Boolean(existingVariant.books?.metadata?.is_incomplete),
          created_new: false,
        },
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const [uncategorizedCategory, uncategorizedPublisher] = await Promise.all([
        getOrCreateUncategorizedCategory(tx),
        getOrCreateUncategorizedPublisher(tx),
      ]);

      const createdBook = await tx.books.create({
        data: {
          title,
          default_language: languageCode,
          publisher_id: uncategorizedPublisher.id,
          metadata: {
            is_incomplete: true,
            requires_librarian_review: true,
            incomplete_reason: 'Created from inbound barcode flow',
            created_by_user_id: userId,
          },
        },
      });

      await tx.book_categories.create({
        data: {
          book_id: createdBook.id,
          category_id: uncategorizedCategory.id,
        },
      });

      const variantData = {
        book_id: createdBook.id,
        sku: buildManualSku(isbn13),
        internal_barcode: isbn13,
        isbn13,
        unit_cost: rawPrice,
        list_price: rawPrice,
        language_code: languageCode,
        ...(publishYear !== null ? { publish_year: publishYear } : {}),
        ...(coverImageUrl ? { cover_image_url: coverImageUrl } : {}),
      };

      const createdVariant = await tx.book_variants.create({
        data: variantData,
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: 'INCOMPLETE_BOOK_CREATED_FROM_INBOUND',
          entity_type: 'BOOK',
          entity_id: createdBook.id,
          after_data: {
            title,
            barcode: isbn13,
            isbn13,
            category: UNCATEGORIZED_NAME,
            publisher: UNCATEGORIZED_NAME,
            note: 'Yeu cau Thu thu bo sung thong tin sach (Tac gia, NXB, The loai).',
          },
        },
      });

      return {
        book_id: createdBook.id,
        variant_id: createdVariant.id,
        barcode: isbn13,
        isbn13,
        title,
        unit_cost: createdVariant.unit_cost,
        list_price: createdVariant.list_price,
        language: createdVariant.language_code,
        publish_year: createdVariant.publish_year,
        is_incomplete: true,
        created_new: true,
      };
    });

    return res.status(201).json({
      message: 'Incomplete book created successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error while creating incomplete book:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getOrCreatePublisher(tx, publisherName) {
  const normalized = String(publisherName || '').trim();
  if (!normalized) return null;

  const existing = await tx.publishers.findFirst({ where: { name: normalized } });
  if (existing) return existing;

  return tx.publishers.create({
    data: {
      code: `PUB-${Date.now()}`,
      name: normalized,
    },
  });
}

async function getOrCreateCategory(tx, categoryName) {
  const normalized = String(categoryName || '').trim();
  if (!normalized) return null;

  const baseSlug = slugify(normalized) || 'category';
  let candidateSlug = baseSlug;
  let index = 1;

  while (true) {
    const existingBySlug = await tx.categories.findUnique({ where: { slug: candidateSlug } });

    if (!existingBySlug) {
      return tx.categories.create({
        data: {
          name: normalized,
          slug: candidateSlug,
        },
      });
    }

    if (existingBySlug.name.toLowerCase() === normalized.toLowerCase()) {
      return existingBySlug;
    }

    index += 1;
    candidateSlug = `${baseSlug}-${index}`;
  }
}

async function getOrCreateAuthor(tx, authorName) {
  const normalized = String(authorName || '').trim();
  if (!normalized) return null;

  const existing = await tx.authors.findFirst({ where: { full_name: normalized } });
  if (existing) return existing;

  return tx.authors.create({
    data: {
      full_name: normalized,
      sort_name: normalized,
    },
  });
}

function buildDefaultSku(bookId) {
  const compact = String(bookId || '').replace(/-/g, '').slice(0, 10).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SKU-${compact}-${suffix}`;
}

async function updateBookDetails(req, res) {
  const bookId = parseId(req.params.id);

  if (!bookId) {
    return res.status(400).json({ message: 'Invalid book id' });
  }

  const {
    title,
    subtitle,
    description,
    summary_vi,
    author_name,
    publisher_name,
    category_name,
    list_price,
    unit_cost,
    isbn13,
    isbn10,
    internal_barcode,
    cover_image_url,
    language,
    publish_year,
  } = req.body;

  const normalizedLanguage = language !== undefined ? normalizeLanguageCode(language) || 'vi' : undefined;
  const normalizedPublishYear = publish_year !== undefined ? normalizePublishYear(publish_year) : undefined;

  if (normalizedPublishYear === undefined && publish_year !== undefined) {
    return res.status(400).json({ message: 'publish_year must be an integer from 1000 to 2100' });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existingBook = await tx.books.findUnique({ where: { id: bookId } });
      if (!existingBook) {
        return null;
      }

      const [publisher, category, author] = await Promise.all([
        getOrCreatePublisher(tx, publisher_name),
        getOrCreateCategory(tx, category_name),
        getOrCreateAuthor(tx, author_name),
      ]);

      const book = await tx.books.update({
        where: { id: bookId },
        data: {
          ...(title !== undefined ? { title: String(title).trim() } : {}),
          ...(subtitle !== undefined ? { subtitle: String(subtitle).trim() || null } : {}),
          ...(description !== undefined ? { description: String(description).trim() || null } : {}),
          ...(normalizedLanguage !== undefined ? { default_language: normalizedLanguage } : {}),
          ...(publisher ? { publisher_id: publisher.id } : {}),
          metadata: {
            ...(existingBook.metadata || {}),
            ...(summary_vi !== undefined ? { summary_vi: String(summary_vi).trim() || null } : {}),
            ...(author || publisher || category ? { is_incomplete: false, requires_librarian_review: false } : {}),
          },
        },
      });

      if (author) {
        await tx.book_authors.deleteMany({ where: { book_id: bookId } });
        await tx.book_authors.create({
          data: {
            book_id: bookId,
            author_id: author.id,
            author_order: 1,
          },
        });
      }

      if (category) {
        await tx.book_categories.deleteMany({ where: { book_id: bookId } });
        await tx.book_categories.create({
          data: {
            book_id: bookId,
            category_id: category.id,
          },
        });
      }

      const firstVariant = await tx.book_variants.findFirst({ where: { book_id: bookId }, orderBy: { created_at: 'asc' } });

      const variantData = {
        ...(list_price !== undefined ? { list_price: Number(list_price) } : {}),
        ...(unit_cost !== undefined ? { unit_cost: Number(unit_cost) } : {}),
        ...(isbn13 !== undefined ? { isbn13: String(isbn13).trim() || null } : {}),
        ...(isbn10 !== undefined ? { isbn10: String(isbn10).trim() || null } : {}),
        ...(internal_barcode !== undefined ? { internal_barcode: String(internal_barcode).trim() || null } : {}),
        ...(cover_image_url !== undefined ? { cover_image_url: normalizeCoverImageUrl(cover_image_url) } : {}),
        ...(normalizedLanguage !== undefined ? { language_code: normalizedLanguage } : {}),
        ...(normalizedPublishYear !== undefined ? { publish_year: normalizedPublishYear } : {}),
      };

      if (Object.keys(variantData).length > 0) {
        if (firstVariant) {
          await tx.book_variants.update({ where: { id: firstVariant.id }, data: variantData });
        } else {
          await tx.book_variants.create({
            data: {
              book_id: bookId,
              sku: buildDefaultSku(bookId),
              ...variantData,
            },
          });
        }
      }

      const fullBook = await tx.books.findUnique({
        where: { id: book.id },
        include: {
          publishers: true,
          book_authors: { include: { authors: true }, orderBy: { author_order: 'asc' } },
          book_categories: { include: { categories: true } },
          book_variants: {
            include: {
              stock_balances: {
                include: {
                  warehouses: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                    },
                  },
                  locations: {
                    select: { location_code: true },
                  },
                },
              },
            },
          },
        },
      });

      return mapBookSummary(fullBook);
    });

    if (!updated) {
      return res.status(404).json({ message: 'Book not found' });
    }

    return res.json({
      message: 'Book details updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error while updating book details:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getAllBooks,
  getBookById,
  findBookByBarcode,
  findBookByIsbn13,
  createIncompleteBook,
  updateBookDetails,
};