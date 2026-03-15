const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function getAllBooks(req, res) {
  try {
    const books = await prisma.book.findMany();
    return res.json(books);
  } catch (error) {
    console.error('Error while fetching books:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getAllBooks,
};