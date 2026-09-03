// prisma/seed-books.ts
//
// One-off script to bulk-populate the catalogue so you don't have to add
// books by hand through the admin UI. Safe to re-run — it skips any
// accession_number that already exists.
//
// Usage:
//   npx tsx prisma/seed-books.ts

import 'dotenv/config';
import { db as prisma } from '../config/prisma.ts';

const books = [
  { title: 'Things Fall Apart', author: 'Chinua Achebe', accession_number: 'ACC-0001', isbn: '9780385474542', publisher: 'Anchor Books', publication_year: 1958, category: 'Fiction', total_copies: 4 },
  { title: 'Half of a Yellow Sun', author: 'Chimamanda Ngozi Adichie', accession_number: 'ACC-0002', isbn: '9781400095209', publisher: 'Anchor Books', publication_year: 2006, category: 'Fiction', total_copies: 3 },
  { title: 'Purple Hibiscus', author: 'Chimamanda Ngozi Adichie', accession_number: 'ACC-0003', isbn: '9781616202415', publisher: 'Algonquin Books', publication_year: 2003, category: 'Fiction', total_copies: 3 },
  { title: 'The Alchemist', author: 'Paulo Coelho', accession_number: 'ACC-0004', isbn: '9780062315007', publisher: 'HarperOne', publication_year: 1988, category: 'Fiction', total_copies: 5 },
  { title: 'Sapiens: A Brief History of Humankind', author: 'Yuval Noah Harari', accession_number: 'ACC-0005', isbn: '9780062316097', publisher: 'Harper', publication_year: 2011, category: 'Non-fiction', total_copies: 4 },
  { title: 'Atomic Habits', author: 'James Clear', accession_number: 'ACC-0006', isbn: '9780735211292', publisher: 'Avery', publication_year: 2018, category: 'Self-help', total_copies: 5 },
  { title: 'Clean Code', author: 'Robert C. Martin', accession_number: 'ACC-0007', isbn: '9780132350884', publisher: 'Prentice Hall', publication_year: 2008, category: 'Computer Science', total_copies: 3 },
  { title: 'Introduction to Algorithms', author: 'Thomas H. Cormen', accession_number: 'ACC-0008', isbn: '9780262033848', publisher: 'MIT Press', publication_year: 2009, category: 'Computer Science', total_copies: 2 },
  { title: 'Structure and Interpretation of Computer Programs', author: 'Harold Abelson', accession_number: 'ACC-0009', isbn: '9780262510875', publisher: 'MIT Press', publication_year: 1996, category: 'Computer Science', total_copies: 2 },
  { title: 'A Brief History of Time', author: 'Stephen Hawking', accession_number: 'ACC-0010', isbn: '9780553380163', publisher: 'Bantam', publication_year: 1988, category: 'Science', total_copies: 3 },
  { title: 'Cosmos', author: 'Carl Sagan', accession_number: 'ACC-0011', isbn: '9780345539434', publisher: 'Ballantine Books', publication_year: 1980, category: 'Science', total_copies: 2 },
  { title: 'The Selfish Gene', author: 'Richard Dawkins', accession_number: 'ACC-0012', isbn: '9780198788607', publisher: 'Oxford University Press', publication_year: 1976, category: 'Science', total_copies: 2 },
  { title: 'Principles of Economics', author: 'N. Gregory Mankiw', accession_number: 'ACC-0013', isbn: '9781305585126', publisher: 'Cengage Learning', publication_year: 2014, category: 'Economics', total_copies: 3 },
  { title: 'The Wealth of Nations', author: 'Adam Smith', accession_number: 'ACC-0014', isbn: '9780553585971', publisher: 'Bantam Classics', publication_year: 1776, category: 'Economics', total_copies: 2 },
  { title: '1984', author: 'George Orwell', accession_number: 'ACC-0015', isbn: '9780451524935', publisher: 'Signet Classics', publication_year: 1949, category: 'Fiction', total_copies: 5 },
  { title: 'Animal Farm', author: 'George Orwell', accession_number: 'ACC-0016', isbn: '9780451526342', publisher: 'Signet Classics', publication_year: 1945, category: 'Fiction', total_copies: 4 },
  { title: 'To Kill a Mockingbird', author: 'Harper Lee', accession_number: 'ACC-0017', isbn: '9780061120084', publisher: 'Harper Perennial', publication_year: 1960, category: 'Fiction', total_copies: 4 },
  { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', accession_number: 'ACC-0018', isbn: '9780743273565', publisher: "Scribner", publication_year: 1925, category: 'Fiction', total_copies: 3 },
  { title: 'Man\'s Search for Meaning', author: 'Viktor E. Frankl', accession_number: 'ACC-0019', isbn: '9780807014295', publisher: 'Beacon Press', publication_year: 1946, category: 'Psychology', total_copies: 3 },
  { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', accession_number: 'ACC-0020', isbn: '9780374533557', publisher: 'Farrar, Straus and Giroux', publication_year: 2011, category: 'Psychology', total_copies: 3 },
];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const book of books) {
    const existing = await prisma.book.findFirst({
      where: { accession_number: book.accession_number },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.book.create({
      data: { ...book, available_copies: book.total_copies },
    });
    created++;
  }

  console.log(`Done. Created ${created} book(s), skipped ${skipped} already-existing.`);
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });