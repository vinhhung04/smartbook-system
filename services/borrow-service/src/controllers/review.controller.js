const { prisma } = require('../lib/prisma');

async function getReviewsByBook(req, res) {
  try {
    const { bookId } = req.params;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));

    const [reviews, total] = await Promise.all([
      prisma.book_reviews.findMany({
        where: { book_id: bookId, status: 'VISIBLE' },
        include: {
          customers: {
            select: { id: true, customer_code: true, full_name: true },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.book_reviews.count({
        where: { book_id: bookId, status: 'VISIBLE' },
      }),
    ]);

    const stats = await prisma.book_reviews.aggregate({
      where: { book_id: bookId, status: 'VISIBLE' },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return res.json({
      data: reviews,
      stats: {
        averageRating: stats._avg.rating ? Number(stats._avg.rating.toFixed(1)) : 0,
        totalReviews: stats._count.rating,
      },
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('[review] getReviewsByBook error:', error);
    return res.status(500).json({ message: 'Failed to load reviews' });
  }
}

async function getBookRatingStats(req, res) {
  try {
    const bookIds = req.query.bookIds;
    if (!bookIds) {
      return res.status(400).json({ message: 'bookIds query parameter is required' });
    }

    const ids = String(bookIds).split(',').map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 100) {
      return res.status(400).json({ message: 'Provide 1-100 bookIds' });
    }

    const results = await prisma.book_reviews.groupBy({
      by: ['book_id'],
      where: { book_id: { in: ids }, status: 'VISIBLE' },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const statsMap = {};
    for (const row of results) {
      statsMap[row.book_id] = {
        averageRating: row._avg.rating ? Number(row._avg.rating.toFixed(1)) : 0,
        totalReviews: row._count.rating,
      };
    }

    return res.json({ data: statsMap });
  } catch (error) {
    console.error('[review] getBookRatingStats error:', error);
    return res.status(500).json({ message: 'Failed to load rating stats' });
  }
}

async function createOrUpdateMyReview(req, res) {
  try {
    const customerId = req.user?.customer_id || req.user?.id;
    if (!customerId) {
      return res.status(401).json({ message: 'Customer identity required' });
    }

    const { book_id, rating, comment } = req.body;
    if (!book_id) {
      return res.status(400).json({ message: 'book_id is required' });
    }
    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ message: 'rating must be an integer between 1 and 5' });
    }

    const review = await prisma.book_reviews.upsert({
      where: {
        uniq_book_reviews_customer_book: {
          customer_id: customerId,
          book_id,
        },
      },
      update: {
        rating: numRating,
        comment: comment || null,
        updated_at: new Date(),
      },
      create: {
        customer_id: customerId,
        book_id,
        rating: numRating,
        comment: comment || null,
      },
      include: {
        customers: {
          select: { id: true, customer_code: true, full_name: true },
        },
      },
    });

    return res.status(200).json({ data: review });
  } catch (error) {
    console.error('[review] createOrUpdateMyReview error:', error);
    return res.status(500).json({ message: 'Failed to save review' });
  }
}

async function getMyReviewForBook(req, res) {
  try {
    const customerId = req.user?.customer_id || req.user?.id;
    if (!customerId) {
      return res.status(401).json({ message: 'Customer identity required' });
    }

    const { bookId } = req.params;
    const review = await prisma.book_reviews.findUnique({
      where: {
        uniq_book_reviews_customer_book: {
          customer_id: customerId,
          book_id: bookId,
        },
      },
    });

    return res.json({ data: review });
  } catch (error) {
    console.error('[review] getMyReviewForBook error:', error);
    return res.status(500).json({ message: 'Failed to load my review' });
  }
}

async function deleteMyReview(req, res) {
  try {
    const customerId = req.user?.customer_id || req.user?.id;
    if (!customerId) {
      return res.status(401).json({ message: 'Customer identity required' });
    }

    const { bookId } = req.params;

    const existing = await prisma.book_reviews.findUnique({
      where: {
        uniq_book_reviews_customer_book: {
          customer_id: customerId,
          book_id: bookId,
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Review not found' });
    }

    await prisma.book_reviews.delete({
      where: { id: existing.id },
    });

    return res.json({ message: 'Review deleted' });
  } catch (error) {
    console.error('[review] deleteMyReview error:', error);
    return res.status(500).json({ message: 'Failed to delete review' });
  }
}

module.exports = {
  getReviewsByBook,
  getBookRatingStats,
  createOrUpdateMyReview,
  getMyReviewForBook,
  deleteMyReview,
};
