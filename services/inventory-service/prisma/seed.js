const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * SMARTBOOK INVENTORY SERVICE - SEED DATA
   * ═══════════════════════════════════════════════════════════════════════════════
   * 
   * This seed creates comprehensive demo data for the SmartBook library system.
   * Data includes: warehouses, locations, categories, publishers, authors, books,
   * variants, stock balances, suppliers, purchase orders, and stock movements.
   * 
   * AI Analysis Metadata:
   * - Diverse book categories for recommendation system training
   * - Realistic pricing data (VND) for inventory valuation
   * - Varied stock levels across warehouses
   * - Complete location hierarchy for putaway/picking workflows
   */

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 1: WAREHOUSES
  // ═══════════════════════════════════════════════════════════════════════════════

  const warehouses = await Promise.all([
  prisma.warehouses.upsert({
    where: { code: 'WH-HCM-01' },
    update: {},
    create: {
      code: 'WH-HCM-01',
      name: 'Kho HCM Chinh',
      warehouse_type: 'WAREHOUSE',
      address_line1: '123 Nguyen Hue',
      ward: 'Ben Nghe',
      district: 'District 1',
      province: 'Ho Chi Minh City',
      country: 'Vietnam',
      is_active: true,
    },
  }),
  prisma.warehouses.upsert({
    where: { code: 'WH-HN-01' },
    update: {},
    create: {
      code: 'WH-HN-01',
      name: 'Kho Ha Noi',
      warehouse_type: 'WAREHOUSE',
      address_line1: '45 Hang Bai',
      ward: 'Trang Tien',
      district: 'Hoan Kiem',
      province: 'Hanoi',
      country: 'Vietnam',
      is_active: true,
    },
  }),
  prisma.warehouses.upsert({
    where: { code: 'BR-HCM-01' },
    update: {},
    create: {
      code: 'BR-HCM-01',
      name: 'Chi Nhanh District 1',
      warehouse_type: 'BRANCH',
      address_line1: '78 Le Duan',
      ward: 'Ben Nghe',
      district: 'District 1',
      province: 'Ho Chi Minh City',
      country: 'Vietnam',
      is_active: true,
    },
  }),
  prisma.warehouses.upsert({
    where: { code: 'BR-HCM-02' },
    update: {},
    create: {
      code: 'BR-HCM-02',
      name: 'Chi Nhanh District 3',
      warehouse_type: 'BRANCH',
      address_line1: '156 Vo Van Tan',
      ward: 'Vo Thi Sau',
      district: 'District 3',
      province: 'Ho Chi Minh City',
      country: 'Vietnam',
      is_active: true,
    },
  }),
]);

console.log(`✅ Created ${warehouses.length} warehouses`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: LOCATIONS (Hierarchical Structure)
// ═══════════════════════════════════════════════════════════════════════════════

const hcmWarehouse = warehouses[0];
const hnWarehouse = warehouses[1];

// Create RECEIVING locations
const receivingLocations = await Promise.all([
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'RECEIVING-01' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      location_code: 'RECEIVING-01',
      location_type: 'RECEIVING',
      barcode: 'LOC-RECEIVING-01',
      is_pickable: false,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hnWarehouse.id, location_code: 'RECEIVING-01' } },
    update: {},
    create: {
      warehouse_id: hnWarehouse.id,
      location_code: 'RECEIVING-01',
      location_type: 'RECEIVING',
      barcode: 'LOC-HN-RECEIVING-01',
      is_pickable: false,
      is_active: true,
    },
  }),
]);

console.log(`✅ Created ${receivingLocations.length} RECEIVING locations`);

// Create ZONEs
const zones = await Promise.all([
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'ZONE-A' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      location_code: 'ZONE-A',
      location_type: 'ZONE',
      zone: 'A',
      barcode: 'LOC-ZONE-A',
      is_pickable: false,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'ZONE-B' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      location_code: 'ZONE-B',
      location_type: 'ZONE',
      zone: 'B',
      barcode: 'LOC-ZONE-B',
      is_pickable: false,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hnWarehouse.id, location_code: 'ZONE-A' } },
    update: {},
    create: {
      warehouse_id: hnWarehouse.id,
      location_code: 'ZONE-A',
      location_type: 'ZONE',
      zone: 'A',
      barcode: 'LOC-HN-ZONE-A',
      is_pickable: false,
      is_active: true,
    },
  }),
]);

console.log(`✅ Created ${zones.length} ZONEs`);

// Create SHELF locations
const shelves = await Promise.all([
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'SHELF-A-01' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: zones[0].id,
      location_code: 'SHELF-A-01',
      location_type: 'SHELF',
      zone: 'A',
      aisle: '01',
      barcode: 'LOC-SHELF-A-01',
      is_pickable: false,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'SHELF-A-02' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: zones[0].id,
      location_code: 'SHELF-A-02',
      location_type: 'SHELF',
      zone: 'A',
      aisle: '02',
      barcode: 'LOC-SHELF-A-02',
      is_pickable: false,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'SHELF-B-01' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: zones[1].id,
      location_code: 'SHELF-B-01',
      location_type: 'SHELF',
      zone: 'B',
      aisle: '01',
      barcode: 'LOC-SHELF-B-01',
      is_pickable: false,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hnWarehouse.id, location_code: 'SHELF-A-01' } },
    update: {},
    create: {
      warehouse_id: hnWarehouse.id,
      parent_location_id: zones[2].id,
      location_code: 'SHELF-A-01',
      location_type: 'SHELF',
      zone: 'A',
      aisle: '01',
      barcode: 'LOC-HN-SHELF-A-01',
      is_pickable: false,
      is_active: true,
    },
  }),
]);

console.log(`✅ Created ${shelves.length} SHELF locations`);

// Create SHELF_COMPARTMENT (actual storage bins)
const compartments = await Promise.all([
  // Zone A - Shelf 01
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'A-01-001' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: shelves[0].id,
      location_code: 'A-01-001',
      location_type: 'SHELF_COMPARTMENT',
      zone: 'A',
      aisle: '01',
      shelf: '001',
      bin: 'A',
      barcode: 'LOC-A-01-001',
      capacity_qty: 50,
      available: 0,
      is_pickable: true,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'A-01-002' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: shelves[0].id,
      location_code: 'A-01-002',
      location_type: 'SHELF_COMPARTMENT',
      zone: 'A',
      aisle: '01',
      shelf: '002',
      bin: 'B',
      barcode: 'LOC-A-01-002',
      capacity_qty: 50,
      available: 0,
      is_pickable: true,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'A-01-003' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: shelves[0].id,
      location_code: 'A-01-003',
      location_type: 'SHELF_COMPARTMENT',
      zone: 'A',
      aisle: '01',
      shelf: '003',
      bin: 'C',
      barcode: 'LOC-A-01-003',
      capacity_qty: 30,
      available: 0,
      is_pickable: true,
      is_active: true,
    },
  }),
  // Zone A - Shelf 02
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'A-02-001' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: shelves[1].id,
      location_code: 'A-02-001',
      location_type: 'SHELF_COMPARTMENT',
      zone: 'A',
      aisle: '02',
      shelf: '001',
      bin: 'A',
      barcode: 'LOC-A-02-001',
      capacity_qty: 40,
      available: 0,
      is_pickable: true,
      is_active: true,
    },
  }),
  // Zone B
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'B-01-001' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: shelves[2].id,
      location_code: 'B-01-001',
      location_type: 'SHELF_COMPARTMENT',
      zone: 'B',
      aisle: '01',
      shelf: '001',
      bin: 'A',
      barcode: 'LOC-B-01-001',
      capacity_qty: 100,
      available: 0,
      is_pickable: true,
      is_active: true,
    },
  }),
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hcmWarehouse.id, location_code: 'B-01-002' } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: shelves[2].id,
      location_code: 'B-01-002',
      location_type: 'SHELF_COMPARTMENT',
      zone: 'B',
      aisle: '01',
      shelf: '002',
      bin: 'B',
      barcode: 'LOC-B-01-002',
      capacity_qty: 100,
      available: 0,
      is_pickable: true,
      is_active: true,
    },
  }),
  // Hanoi warehouse
  prisma.locations.upsert({
    where: { warehouse_id_location_code: { warehouse_id: hnWarehouse.id, location_code: 'HN-A-01-001' } },
    update: {},
    create: {
      warehouse_id: hnWarehouse.id,
      parent_location_id: shelves[3].id,
      location_code: 'HN-A-01-001',
      location_type: 'SHELF_COMPARTMENT',
      zone: 'A',
      aisle: '01',
      shelf: '001',
      bin: 'A',
      barcode: 'LOC-HN-A-01-001',
      capacity_qty: 60,
      available: 0,
      is_pickable: true,
      is_active: true,
    },
  }),
]);

console.log(`✅ Created ${compartments.length} SHELF_COMPARTMENT locations`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: CATEGORIES (Book Categories for AI Recommendation)
// ═══════════════════════════════════════════════════════════════════════════════

const categories = await Promise.all([
  prisma.categories.upsert({
    where: { slug: 'van-hoc-viet-nam' },
    update: {},
    create: {
      name: 'Van hoc Viet Nam',
      slug: 'van-hoc-viet-nam',
      description: 'Tac pham van hoc Viet Nam, tu co dien den hien dai',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'van-hoc-nuoc-ngoai' },
    update: {},
    create: {
      name: 'Van hoc Nuoc Ngoai',
      slug: 'van-hoc-nuoc-ngoai',
      description: 'Tac pham van hoc nuoc ngoai, kinh dien va dong dai',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'truyen-ngan' },
    update: {},
    create: {
      name: 'Truyen ngan',
      slug: 'truyen-ngan',
      description: 'Truyen ngan, truyen dai, tieu luan',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'ky-nang-song' },
    update: {},
    create: {
      name: 'Ky nang song',
      slug: 'ky-nang-song',
      description: 'Sach ky nang song, phat trien ban than, tam ly',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'kinh-te' },
    update: {},
    create: {
      name: 'Kinh te',
      slug: 'kinh-te',
      description: 'Sach kinh te, kinh doanh, tai chinh, dau tu',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'congtac-vien' },
    update: {},
    create: {
      name: 'Lich su - Chinh tri',
      slug: 'congtac-vien',
      description: 'Sach lich su, chinh tri, xa hoi',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'ky-thuat' },
    update: {},
    create: {
      name: 'Ky thuat - CNTT',
      slug: 'ky-thuat',
      description: 'Sach ky thuat, cong nghe thong tin, lap trinh',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'nuoi-day-con' },
    update: {},
    create: {
      name: 'Nuoi day con',
      slug: 'nuoi-day-con',
      description: 'Sach nuoi day con, giao duc tre em',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'am-thuc' },
    update: {},
    create: {
      name: 'Am thuc',
      slug: 'am-thuc',
      description: 'Sach nau an, am thuc, phong cach song',
    },
  }),
  prisma.categories.upsert({
    where: { slug: 'thieu-nhi' },
    update: {},
    create: {
      name: 'Thieu nhi',
      slug: 'thieu-nhi',
      description: 'Sach tranh, truyen cho tre em',
    },
  }),
]);

console.log(`✅ Created ${categories.length} categories`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: PUBLISHERS
// ═══════════════════════════════════════════════════════════════════════════════

const publishers = await Promise.all([
  prisma.publishers.upsert({
    where: { code: 'NXB-GD' },
    update: {},
    create: {
      code: 'NXB-GD',
      name: 'Nha Xuat Ban Giao Duc',
      phone: '+842837123456',
      email: 'contact@nxbgd.vn',
      website: 'https://nxbgd.vn',
      address: '81 Tran Hung Dao, Hoan Kiem, Hanoi',
      country: 'Vietnam',
    },
  }),
  prisma.publishers.upsert({
    where: { code: 'NXB-TRE' },
    update: {},
    create: {
      code: 'NXB-TRE',
      name: 'Nha Xuat Ban Tre',
      phone: '+842838245678',
      email: 'info@nxbtre.com.vn',
      website: 'https://nxbtre.com.vn',
      address: '123 Nguyen Du, District 1, HCMC',
      country: 'Vietnam',
    },
  }),
  prisma.publishers.upsert({
    where: { code: 'KIM-DONG' },
    update: {},
    create: {
      code: 'KIM-DONG',
      name: 'Nha Xuat Ban Kim Dong',
      phone: '+842838912345',
      email: 'contact@kimdong.com.vn',
      website: 'https://kimdong.com.vn',
      address: '45 Ham Nghi, District 1, HCMC',
      country: 'Vietnam',
    },
  }),
  prisma.publishers.upsert({
    where: { code: 'FIRSTNEWS' },
    update: {},
    create: {
      code: 'FIRSTNEWS',
      name: 'Nha Xuat Ban First News - Tri thuc',
      phone: '+842839876543',
      email: 'contact@firstnews.com.vn',
      website: 'https://firstnews.com.vn',
      address: '56 Nguyen Cuu Van, Binh Thanh, HCMC',
      country: 'Vietnam',
    },
  }),
  prisma.publishers.upsert({
    where: { code: 'PENGUIN' },
    update: {},
    create: {
      code: 'PENGUIN',
      name: 'Penguin Random House',
      phone: '+12127829300',
      email: 'global@prh.com',
      website: 'https://www.penguinrandomhouse.com',
      address: '1745 Broadway, New York, NY 10019',
      country: 'USA',
    },
  }),
]);

console.log(`✅ Created ${publishers.length} publishers`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: AUTHORS
// ═══════════════════════════════════════════════════════════════════════════════

const authors = await Promise.all([
  prisma.authors.upsert({
    where: { full_name: 'Nam Cao' },
    update: {},
    create: {
      full_name: 'Nam Cao',
      sort_name: 'Cao, Nam',
      biography: 'Nam Cao (1915-1962) la nha van noi tieng cua Vietnam, tac gia cua "So do" va "Chiec la cuoi cung". Op tan van hoc hien thuc, chu tap trung vao cuoc song nhan vat nong thon va giai cap cong nhan nho trong xa hoi phong kien.',
    },
  }),
  prisma.authors.upsert({
    where: { full_name: 'Xuan Dieu' },
    update: {},
    create: {
      full_name: 'Xuan Dieu',
      sort_name: 'Dieu, Xuan',
      biography: 'Xuan Dieu (1916-1985) la nha van, nhap khau, nhac si. Duoc biet den voi "Thuyen bac nho" va nhieu tac pham phi pham noi tieng. Thuoc phong trao Thanh Nghie - Tien Phong.',
    },
  }),
  prisma.authors.upsert({
    where: { full_name: 'To Hoai' },
    update: {},
    create: {
      full_name: 'To Hoai',
      sort_name: 'Hoai, To',
      biography: 'To Hoai (1920-2010) la nha van noi tieng, tac gia cua "Tam Cam", "Me Chim", "Dua tre con ra chon". Tap trung vao doi song nong thon va thanh thi Vietnam.',
    },
  }),
  prisma.authors.upsert({
    where: { full_name: 'Ngo Tat Lu' },
    update: {},
    create: {
      full_name: 'Ngo Tat Lu',
      sort_name: 'Lu, Ngo Tat',
      biography: 'Ngo Tat Lu (1894-1963) la nha van lon cua van hoc Viet Nam hien dai. Tac gia cua "Toi thay hoa vang tren co xanh", "Ngot ran nuoc dog", "Kieu Ba La".',
    },
  }),
  prisma.authors.upsert({
    where: { full_name: 'Haruki Murakami' },
    update: {},
    create: {
      full_name: 'Haruki Murakami',
      sort_name: 'Murakami, Haruki',
      biography: 'Haruki Murakami (1949-) la nha van Nhat Ban noi tieng the gioi. Tac pham noi bat: "Norwegian Wood", "Kafka ben bo song", "1Q84". Phong cach viet day am tinh, hai nghi, pha tram giua that va mo.',
    },
  }),
  prisma.authors.upsert({
    where: { full_name: 'Gabriel Garcia Marquez' },
    update: {},
    create: {
      full_name: 'Gabriel Garcia Marquez',
      sort_name: 'Marquez, Gabriel Garcia',
      biography: 'Gabriel Garcia Marquez (1927-2014) la nha van Colombia, giai thuong Nobel Van hoc 1982. Tac gia cua "Troi nam tram", "Tinh yeu trong mua mua", "Bi mat cua Hoang ha".',
    },
  }),
  prisma.authors.upsert({
    where: { full_name: 'Tran Dang Khoa' },
    update: {},
    create: {
      full_name: 'Tran Dang Khoa',
      sort_name: 'Khoa, Tran Dang',
      biography: 'Tran Dang Khoa la nhac si, nhap khau noi tieng cua Vietnam. Tieu bieu voi "Bai ca ru ngay", "Cua so nho", "Con mua ngang qua".',
    },
  }),
  prisma.authors.upsert({
    where: { full_name: 'Nguyen Nhat Anh' },
    update: {},
    create: {
      full_name: 'Nguyen Nhat Anh',
      sort_name: 'Anh, Nguyen Nhat',
      biography: 'Nguyen Nhat Anh (1954-2021) la nha van, nhac si Vietnam. Tac gia cua "Cho toi xin mot ve di tuoi tho", "Mat toc ngan, mat ngu dai", "Benh gieng cua Beethoven".',
    },
  }),
]);

console.log(`✅ Created ${authors.length} authors`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: BOOKS (With AI Metadata)
// ═══════════════════════════════════════════════════════════════════════════════

const books = await Promise.all([
  // Vietnamese Literature
  prisma.books.upsert({
    where: { book_code: 'BK-001' },
    update: {},
    create: {
      book_code: 'BK-001',
      title: 'So do',
      subtitle: 'Tieu thuyet kinh dien',
      description: 'Tac pham kinh dien cua Nam Cao ve cuoc song nhan vat nong thon trong xa hoi phong kien. Lang leo la mot nhan vat chinh muon thoat khoi doi song lam chet tam hon, nhung cuoi cung van that bai va giac mo ve hanh phuc dan ong.',
      publisher_id: publishers[0].id,
      edition: 'Lan 1',
      published_date: new Date('2020-01-15'),
      page_count: 320,
      country_of_origin: 'Vietnam',
      default_language: 'vi',
      is_active: true,
      metadata: {
        genre: ['realism', 'classic', 'social-criticism'],
        target_audience: ['adult', 'high-school', 'literature-students'],
        themes: ['poverty', 'social-inequality', 'dream-vs-reality', 'rural-life'],
        awards: ['Vietnamese Literature Classic'],
        reading_level: 'intermediate',
        word_count: 85000,
      },
    },
  }),
  prisma.books.upsert({
    where: { book_code: 'BK-002' },
    update: {},
    create: {
      book_code: 'BK-002',
      title: 'Chiec la cuoi cung',
      subtitle: 'Truyen ngan chan cam',
      description: 'Truyen ngan chan cam cua Nam Cao, noi ve doi song gia dinh Viet Nam truoc cach mang. Nhan vat Chinh phai doi mat voi su that dau long ve gia dinh minh.',
      publisher_id: publishers[0].id,
      edition: 'Lan 3',
      published_date: new Date('2019-06-20'),
      page_count: 150,
      country_of_origin: 'Vietnam',
      default_language: 'vi',
      is_active: true,
      metadata: {
        genre: ['realism', 'short-story', 'family'],
        target_audience: ['adult', 'high-school'],
        themes: ['family', 'betrayal', 'social-norms', 'woman-rights'],
        reading_level: 'intermediate',
        word_count: 42000,
      },
    },
  }),
  prisma.books.upsert({
    where: { book_code: 'BK-003' },
    update: {},
    create: {
      book_code: 'BK-003',
      title: 'Thuyen bac nho',
      subtitle: 'Tuyen tap tho',
      description: 'Tuyen tap tho hay cua Xuan Dieu, mot trong nhung tap tho dep nhat cua van hoc Vietnam. Nhung bai tho ve tinh yeu, que huong, doi song va con nguoi.',
      publisher_id: publishers[1].id,
      edition: 'Lan 2',
      published_date: new Date('2021-03-10'),
      page_count: 200,
      country_of_origin: 'Vietnam',
      default_language: 'vi',
      is_active: true,
      metadata: {
        genre: ['poetry', 'classic', 'vietnamese'],
        target_audience: ['all-ages', 'poetry-lovers'],
        themes: ['love', 'homeland', 'life', 'nostalgia'],
        reading_level: 'beginner-to-intermediate',
        poem_count: 45,
      },
    },
  }),
  prisma.books.upsert({
    where: { book_code: 'BK-004' },
    update: {},
    create: {
      book_code: 'BK-004',
      title: 'Tam Cam',
      subtitle: 'Co tich Viet Nam',
      description: 'Chuyen tich co tich Viet Nam, phien ban cua To Hoai. Cau chuyen tinh yeu bi tra tra ve cuoi cung chet trong bieu tuong va giac mo.',
      publisher_id: publishers[1].id,
      edition: 'Lan 5',
      published_date: new Date('2018-11-25'),
      page_count: 280,
      country_of_origin: 'Vietnam',
      default_language: 'vi',
      is_active: true,
      metadata: {
        genre: ['folklore', 'legend', 'romance', 'tragedy'],
        target_audience: ['all-ages', 'children', 'folklore-enthusiasts'],
        themes: ['love', 'loyalty', 'reincarnation', 'folk-tales'],
        cultural_significance: 'Vietnamese Classic Folklore',
        reading_level: 'beginner',
      },
    },
  }),
  prisma.books.upsert({
    where: { book_code: 'BK-005' },
    update: {},
    create: {
      book_code: 'BK-005',
      title: 'Toi thay hoa vang tren co xanh',
      subtitle: 'Tieu thuyet',
      description: 'Tieu thuyet noi tieng cua Ngo Tat Lu ve doi song nong thon Vietnam. Nhan vat Chinh trai qua doi song day bien doi voi gia dinh, tinh yeu va hy vong.',
      publisher_id: publishers[2].id,
      edition: 'Lan 10',
      published_date: new Date('2017-05-30'),
      page_count: 450,
      country_of_origin: 'Vietnam',
      default_language: 'vi',
      is_active: true,
      metadata: {
        genre: ['realism', 'classic', 'coming-of-age'],
        target_audience: ['adult', 'high-school', 'literature-students'],
        themes: ['rural-life', 'poverty', 'education', 'social-change', 'ambition'],
        awards: ['Vietnamese Literature Masterpiece'],
        reading_level: 'advanced',
        word_count: 120000,
      },
    },
  }),
  // Foreign Literature
  prisma.books.upsert({
    where: { book_code: 'BK-006' },
    update: {},
    create: {
      book_code: 'BK-006',
      title: 'Norwegian Wood',
      subtitle: 'A Novel',
      description: 'A coming-of-age novel by Haruki Murakami. Set in late 1960s Tokyo, it follows Toru Watanabe as he navigates love, loss, and the transition to adulthood.',
      publisher_id: publishers[4].id,
      edition: 'International Edition',
      published_date: new Date('2000-09-12'),
      page_count: 296,
      country_of_origin: 'Japan',
      default_language: 'en',
      is_active: true,
      metadata: {
        genre: ['fiction', 'romance', 'coming-of-age', 'japanese-literature'],
        target_audience: ['adult', 'young-adult', 'literature-students'],
        themes: ['love', 'loss', 'nostalgia', 'death', 'grief'],
        original_language: 'Japanese',
        awards: ['Yomiuri Prize Nominee'],
        reading_level: 'intermediate',
        word_count: 78000,
      },
    },
  }),
  prisma.books.upsert({
    where: { book_code: 'BK-007' },
    update: {},
    create: {
      book_code: 'BK-007',
      title: 'One Hundred Years of Solitude',
      subtitle: 'Cien Anos de Soledad',
      description: 'Gabriel Garcia Marquez masterpiece about the Buendia family across seven generations in the mythical town of Macondo.',
      publisher_id: publishers[4].id,
      edition: 'Penguin Classics Edition',
      published_date: new Date('2006-06-06'),
      page_count: 417,
      country_of_origin: 'Colombia',
      default_language: 'en',
      is_active: true,
      metadata: {
        genre: ['magical-realism', 'fiction', 'latin-american-literature', 'classic'],
        target_audience: ['adult', 'literature-students'],
        themes: ['family', 'time', 'fate', 'loneliness', 'solitude'],
        original_language: 'Spanish',
        awards: ['Nobel Prize in Literature 1982'],
        reading_level: 'advanced',
        word_count: 110000,
      },
    },
  }),
  // Modern Vietnamese Children's
  prisma.books.upsert({
    where: { book_code: 'BK-008' },
    update: {},
    create: {
      book_code: 'BK-008',
      title: 'Cho toi xin mot ve di tuoi tho',
      subtitle: 'Tieu thuyet',
      description: 'Tieu thuyet noi tieng cua Nguyen Nhat Anh ve thanh nien trong doi song thanh thi, voi nhung su troi ngang, buon cuoi va hanh phuc.',
      publisher_id: publishers[3].id,
      edition: 'Lan 20',
      published_date: new Date('2015-04-10'),
      page_count: 280,
      country_of_origin: 'Vietnam',
      default_language: 'vi',
      is_active: true,
      metadata: {
        genre: ['fiction', 'coming-of-age', 'humor', 'vietnamese'],
        target_audience: ['young-adult', 'teenagers', 'adults'],
        themes: ['friendship', 'school-life', 'humor', 'nostalgia', 'innocence'],
        reading_level: 'beginner-to-intermediate',
        word_count: 72000,
      },
    },
  }),
  // Self-Help / Life Skills
  prisma.books.upsert({
    where: { book_code: 'BK-009' },
    update: {},
    create: {
      book_code: 'BK-009',
      title: 'Dac trung tam ly hoc cua nguoi Viet',
      subtitle: 'Tam ly hoc ung dung',
      description: 'Cuon sach ve tam ly hoc nguoi Viet, phan tich tam li, hanh vi va tinh cach cua nguoi Viet trong doi song hien dai.',
      publisher_id: publishers[0].id,
      edition: 'Lan 1',
      published_date: new Date('2022-08-15'),
      page_count: 350,
      country_of_origin: 'Vietnam',
      default_language: 'vi',
      is_active: true,
      metadata: {
        genre: ['psychology', 'self-help', 'vietnamese-culture', 'social-science'],
        target_audience: ['adult', 'psychology-students', 'general-readers'],
        themes: ['vietnamese-psychology', 'cultural-identity', 'self-understanding'],
        reading_level: 'intermediate',
        academic_level: 'popular-psychology',
      },
    },
  }),
  // Science Fiction (Foreign)
  prisma.books.upsert({
    where: { book_code: 'BK-010' },
    update: {},
    create: {
      book_code: 'BK-010',
      title: 'Kafka on the Shore',
      subtitle: 'Kafka on the Shore',
      description: 'Haruki Murakami novel featuring parallel narratives: a teenage boy named Nakata who can speak with cats, and an aging, Kleptomaniac Oracle named Hoshino.',
      publisher_id: publishers[4].id,
      edition: 'International Edition',
      published_date: new Date('2005-01-25'),
      page_count: 505,
      country_of_origin: 'Japan',
      default_language: 'en',
      is_active: true,
      metadata: {
        genre: ['fiction', 'magical-realism', 'mystery', 'japanese-literature'],
        target_audience: ['adult', 'literature-students', 'fantasy-readers'],
        themes: ['fate', 'consciousness', 'identity', 'music', 'cats'],
        original_language: 'Japanese',
        reading_level: 'advanced',
        word_count: 135000,
      },
    },
  }),
]);

console.log(`✅ Created ${books.length} books`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7: LINK BOOKS WITH AUTHORS & CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.book_authors.createMany({
  data: [
    { book_id: books[0].id, author_id: authors[0].id, author_order: 1 },
    { book_id: books[1].id, author_id: authors[0].id, author_order: 1 },
    { book_id: books[2].id, author_id: authors[1].id, author_order: 1 },
    { book_id: books[3].id, author_id: authors[2].id, author_order: 1 },
    { book_id: books[4].id, author_id: authors[3].id, author_order: 1 },
    { book_id: books[5].id, author_id: authors[4].id, author_order: 1 }, // Norwegian Wood
    { book_id: books[6].id, author_id: authors[5].id, author_order: 1 }, // 100 Years
    { book_id: books[7].id, author_id: authors[7].id, author_order: 1 }, // Cho toi xin
    { book_id: books[8].id, author_id: authors[0].id, author_order: 1 }, // Psychology (collective)
    { book_id: books[9].id, author_id: authors[4].id, author_order: 1 }, // Kafka
  ],
  skipDuplicates: true,
});

await prisma.book_categories.createMany({
  data: [
    { book_id: books[0].id, category_id: categories[0].id },
    { book_id: books[1].id, category_id: categories[0].id },
    { book_id: books[1].id, category_id: categories[2].id },
    { book_id: books[2].id, category_id: categories[0].id },
    { book_id: books[3].id, category_id: categories[2].id },
    { book_id: books[4].id, category_id: categories[0].id },
    { book_id: books[5].id, category_id: categories[1].id },
    { book_id: books[6].id, category_id: categories[1].id },
    { book_id: books[7].id, category_id: categories[0].id },
    { book_id: books[7].id, category_id: categories[3].id },
    { book_id: books[8].id, category_id: categories[3].id },
    { book_id: books[9].id, category_id: categories[1].id },
  ],
  skipDuplicates: true,
});

console.log('✅ Linked books with authors and categories');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8: BOOK VARIANTS (Different Editions, Formats)
// ═══════════════════════════════════════════════════════════════════════════════

const variants = await Promise.all([
  // So do variants
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK001-PB-01' },
    update: {},
    create: {
      book_id: books[0].id,
      sku: 'SKU-BK001-PB-01',
      isbn13: '9786041234567',
      isbn10: '6041234560',
      internal_barcode: 'BC-BK001-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'vi',
      publish_year: 2020,
      condition_grade: 'NEW',
      unit_cost: 45000,
      list_price: 68000,
      replacement_cost: 75000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 320,
        format: 'A5',
        weight: '250g',
      },
    },
  }),
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK001-HB-01' },
    update: {},
    create: {
      book_id: books[0].id,
      sku: 'SKU-BK001-HB-01',
      isbn13: '9786041234568',
      isbn10: '6041234561',
      internal_barcode: 'BC-BK001-HB-01',
      cover_type: 'HARDBACK',
      language_code: 'vi',
      publish_year: 2020,
      condition_grade: 'NEW',
      unit_cost: 85000,
      list_price: 120000,
      replacement_cost: 140000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 320,
        format: 'A5',
        weight: '400g',
        special_edition: true,
      },
    },
  }),
  // Chiec la cuoi cung
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK002-PB-01' },
    update: {},
    create: {
      book_id: books[1].id,
      sku: 'SKU-BK002-PB-01',
      isbn13: '9786041234569',
      isbn10: '6041234562',
      internal_barcode: 'BC-BK002-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'vi',
      publish_year: 2019,
      condition_grade: 'NEW',
      unit_cost: 35000,
      list_price: 52000,
      replacement_cost: 60000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 150,
        format: 'A5',
        weight: '180g',
      },
    },
  }),
  // Thuyen bac nho
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK003-PB-01' },
    update: {},
    create: {
      book_id: books[2].id,
      sku: 'SKU-BK003-PB-01',
      isbn13: '9786041234570',
      isbn10: '6041234563',
      internal_barcode: 'BC-BK003-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'vi',
      publish_year: 2021,
      condition_grade: 'NEW',
      unit_cost: 55000,
      list_price: 85000,
      replacement_cost: 95000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 200,
        format: 'A5',
        weight: '220g',
        illustrated: true,
      },
    },
  }),
  // Tam Cam
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK004-PB-01' },
    update: {},
    create: {
      book_id: books[3].id,
      sku: 'SKU-BK004-PB-01',
      isbn13: '9786041234571',
      isbn10: '6041234564',
      internal_barcode: 'BC-BK004-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'vi',
      publish_year: 2018,
      condition_grade: 'NEW',
      unit_cost: 48000,
      list_price: 72000,
      replacement_cost: 80000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 280,
        format: 'A5',
        weight: '300g',
        illustrated: true,
        age_group: 'all-ages',
      },
    },
  }),
  // Toi thay hoa vang
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK005-PB-01' },
    update: {},
    create: {
      book_id: books[4].id,
      sku: 'SKU-BK005-PB-01',
      isbn13: '9786041234572',
      isbn10: '6041234565',
      internal_barcode: 'BC-BK005-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'vi',
      publish_year: 2017,
      condition_grade: 'NEW',
      unit_cost: 65000,
      list_price: 98000,
      replacement_cost: 110000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 450,
        format: 'A5',
        weight: '450g',
      },
    },
  }),
  // Norwegian Wood (English)
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK006-PB-01' },
    update: {},
    create: {
      book_id: books[5].id,
      sku: 'SKU-BK006-PB-01',
      isbn13: '9780679775430',
      isbn10: '0679775439',
      internal_barcode: 'BC-BK006-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'en',
      publish_year: 2000,
      condition_grade: 'NEW',
      unit_cost: 180000,
      list_price: 280000,
      replacement_cost: 320000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 296,
        format: 'A5',
        weight: '320g',
      },
    },
  }),
  // 100 Years of Solitude
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK007-PB-01' },
    update: {},
    create: {
      book_id: books[6].id,
      sku: 'SKU-BK007-PB-01',
      isbn13: '9780060883287',
      isbn10: '0060883286',
      internal_barcode: 'BC-BK007-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'en',
      publish_year: 2006,
      condition_grade: 'NEW',
      unit_cost: 220000,
      list_price: 350000,
      replacement_cost: 400000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 417,
        format: 'A5',
        weight: '400g',
        translator: 'Gregory Rabassa',
      },
    },
  }),
  // Cho toi xin mot ve di tuoi tho
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK008-PB-01' },
    update: {},
    create: {
      book_id: books[7].id,
      sku: 'SKU-BK008-PB-01',
      isbn13: '9786041234573',
      isbn10: '6041234566',
      internal_barcode: 'BC-BK008-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'vi',
      publish_year: 2015,
      condition_grade: 'NEW',
      unit_cost: 55000,
      list_price: 85000,
      replacement_cost: 95000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 280,
        format: 'A5',
        weight: '300g',
        bestseller: true,
      },
    },
  }),
  // Psychology book
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK009-PB-01' },
    update: {},
    create: {
      book_id: books[8].id,
      sku: 'SKU-BK009-PB-01',
      isbn13: '9786041234574',
      isbn10: '6041234567',
      internal_barcode: 'BC-BK009-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'vi',
      publish_year: 2022,
      condition_grade: 'NEW',
      unit_cost: 89000,
      list_price: 135000,
      replacement_cost: 150000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 350,
        format: 'B5',
        weight: '400g',
        academic: true,
      },
    },
  }),
  // Kafka on the Shore
  prisma.book_variants.upsert({
    where: { sku: 'SKU-BK010-PB-01' },
    update: {},
    create: {
      book_id: books[9].id,
      sku: 'SKU-BK010-PB-01',
      isbn13: '9781400079278',
      isbn10: '1400079276',
      internal_barcode: 'BC-BK010-PB-01',
      cover_type: 'PAPERBACK',
      language_code: 'en',
      publish_year: 2005,
      condition_grade: 'NEW',
      unit_cost: 200000,
      list_price: 320000,
      replacement_cost: 360000,
      is_borrowable: true,
      is_sellable: true,
      is_track_by_unit: true,
      is_active: true,
      metadata: {
        page_count: 505,
        format: 'A5',
        weight: '500g',
      },
    },
  }),
]);

console.log(`✅ Created ${variants.length} book variants`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9: SUPPLIERS
// ═══════════════════════════════════════════════════════════════════════════════

const suppliers = await Promise.all([
  prisma.suppliers.upsert({
    where: { name: 'Nha Phan Phoi Sach Viet' },
    update: {},
    create: {
      code: 'SUP-001',
      name: 'Nha Phan Phoi Sach Viet',
      contact_name: 'Le Van Minh',
      phone: '+842812345678',
      email: 'minh@nppsv.com.vn',
      address: '123 Duong Khang, District 8, HCMC',
      tax_code: '0123456789',
      status: 'ACTIVE',
    },
  }),
  prisma.suppliers.upsert({
    where: { name: 'Cong Ty TNHH Phan Phoi Nhap Khau Phuc Sinh' },
    update: {},
    create: {
      code: 'SUP-002',
      name: 'Cong Ty TNHH Phan Phoi Nhap Khau Phuc Sinh',
      contact_name: 'Tran Thi Hong',
      phone: '+842812345679',
      email: 'hong@ppnps.com.vn',
      address: '456 Nguyen Tri, Binh Thanh, HCMC',
      tax_code: '0123456790',
      status: 'ACTIVE',
    },
  }),
  prisma.suppliers.upsert({
    where: { name: 'International Books Distributors' },
    update: {},
    create: {
      code: 'SUP-003',
      name: 'International Books Distributors',
      contact_name: 'John Smith',
      phone: '+12125551234',
      email: 'john@ibd.com',
      address: '789 Book Lane, New York, USA',
      tax_code: 'US123456789',
      status: 'ACTIVE',
    },
  }),
]);

console.log(`✅ Created ${suppliers.length} suppliers`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 10: SUPPLIER VARIANTS (Pricing from Suppliers)
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.supplier_variants.createMany({
  data: [
    { supplier_id: suppliers[0].id, variant_id: variants[0].id, supplier_sku: 'SUP001-BK001', default_cost: 42000, min_order_qty: 10, is_preferred: true },
    { supplier_id: suppliers[0].id, variant_id: variants[1].id, supplier_sku: 'SUP001-BK001-HB', default_cost: 80000, min_order_qty: 5, is_preferred: true },
    { supplier_id: suppliers[0].id, variant_id: variants[2].id, supplier_sku: 'SUP001-BK002', default_cost: 33000, min_order_qty: 20, is_preferred: true },
    { supplier_id: suppliers[0].id, variant_id: variants[3].id, supplier_sku: 'SUP001-BK003', default_cost: 52000, min_order_qty: 15, is_preferred: true },
    { supplier_id: suppliers[0].id, variant_id: variants[4].id, supplier_sku: 'SUP001-BK004', default_cost: 45000, min_order_qty: 10, is_preferred: true },
    { supplier_id: suppliers[0].id, variant_id: variants[7].id, supplier_sku: 'SUP001-BK008', default_cost: 52000, min_order_qty: 10, is_preferred: true },
    { supplier_id: suppliers[1].id, variant_id: variants[5].id, supplier_sku: 'SUP002-BK005', default_cost: 62000, min_order_qty: 10, is_preferred: true },
    { supplier_id: suppliers[1].id, variant_id: variants[8].id, supplier_sku: 'SUP002-BK009', default_cost: 85000, min_order_qty: 5, is_preferred: true },
    { supplier_id: suppliers[2].id, variant_id: variants[6].id, supplier_sku: 'SUP003-NW-EN', default_cost: 170000, lead_time_days: 30, min_order_qty: 5, is_preferred: true },
    { supplier_id: suppliers[2].id, variant_id: variants[9].id, supplier_sku: 'SUP003-100Y-EN', default_cost: 210000, lead_time_days: 30, min_order_qty: 5, is_preferred: true },
    { supplier_id: suppliers[2].id, variant_id: variants[10].id, supplier_sku: 'SUP003-KS-EN', default_cost: 190000, lead_time_days: 30, min_order_qty: 5, is_preferred: true },
  ],
  skipDuplicates: true,
});

console.log('✅ Created supplier variant relationships');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 11: STOCK BALANCES (Diversified Inventory)
// ═══════════════════════════════════════════════════════════════════════════════

const hcmReceiving = receivingLocations[0];
const hnReceiving = receivingLocations[1];

// Stock at HCM RECEIVING (awaiting putaway)
const receivingStockHCM = await Promise.all([
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[0].id, location_id: hcmReceiving.id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[0].id,
      location_id: hcmReceiving.id,
      on_hand_qty: 10,
      available_qty: 0,
      reserved_qty: 0,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[2].id, location_id: hcmReceiving.id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[2].id,
      location_id: hcmReceiving.id,
      on_hand_qty: 5,
      available_qty: 0,
      reserved_qty: 0,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[3].id, location_id: hcmReceiving.id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[3].id,
      location_id: hcmReceiving.id,
      on_hand_qty: 8,
      available_qty: 0,
      reserved_qty: 0,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
]);

// Stock at HCM Shelves (already putaway)
const shelfStockHCM = await Promise.all([
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[0].id, location_id: compartments[0].id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[0].id,
      location_id: compartments[0].id,
      on_hand_qty: 15,
      available_qty: 12,
      reserved_qty: 3,
      safety_stock_qty: 5,
      reorder_point: 10,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[2].id, location_id: compartments[1].id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[2].id,
      location_id: compartments[1].id,
      on_hand_qty: 8,
      available_qty: 8,
      reserved_qty: 0,
      safety_stock_qty: 3,
      reorder_point: 5,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[4].id, location_id: compartments[2].id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[4].id,
      location_id: compartments[2].id,
      on_hand_qty: 20,
      available_qty: 18,
      reserved_qty: 2,
      safety_stock_qty: 5,
      reorder_point: 10,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[5].id, location_id: compartments[3].id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[5].id,
      location_id: compartments[3].id,
      on_hand_qty: 12,
      available_qty: 10,
      reserved_qty: 2,
      safety_stock_qty: 5,
      reorder_point: 8,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[7].id, location_id: compartments[4].id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[7].id,
      location_id: compartments[4].id,
      on_hand_qty: 25,
      available_qty: 25,
      reserved_qty: 0,
      safety_stock_qty: 8,
      reorder_point: 15,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
  // Low stock item - for alerts
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[6].id, location_id: compartments[5].id } },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[6].id,
      location_id: compartments[5].id,
      on_hand_qty: 2,
      available_qty: 2,
      reserved_qty: 0,
      safety_stock_qty: 5,
      reorder_point: 10,
      status: 'LOW_STOCK',
      version: 1,
      last_movement_at: new Date(),
    },
  }),
]);

// Stock at Hanoi Warehouse
const hanoiStock = await Promise.all([
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[0].id, location_id: hnReceiving.id } },
    update: {},
    create: {
      warehouse_id: hnWarehouse.id,
      variant_id: variants[0].id,
      location_id: hnReceiving.id,
      on_hand_qty: 5,
      available_qty: 0,
      reserved_qty: 0,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
  prisma.stock_balances.upsert({
    where: { variant_id_location_id: { variant_id: variants[0].id, location_id: compartments[6].id } },
    update: {},
    create: {
      warehouse_id: hnWarehouse.id,
      variant_id: variants[0].id,
      location_id: compartments[6].id,
      on_hand_qty: 10,
      available_qty: 8,
      reserved_qty: 2,
      safety_stock_qty: 5,
      reorder_point: 10,
      version: 1,
      last_movement_at: new Date(),
    },
  }),
]);

console.log(`✅ Created ${receivingStockHCM.length + shelfStockHCM.length + hanoiStock.length} stock balances`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 12: STOCK ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

await prisma.stock_alerts.createMany({
  data: [
    {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[6].id,
      alert_type: 'LOW_STOCK',
      alert_level: 'WARNING',
      threshold_value: 5,
      current_value: 2,
      status: 'OPEN',
    },
    {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[8].id,
      alert_type: 'OUT_OF_STOCK',
      alert_level: 'CRITICAL',
      threshold_value: 0,
      current_value: 0,
      status: 'OPEN',
    },
  ],
  skipDuplicates: true,
});

console.log('✅ Created stock alerts');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 13: EXTENDED DEMO CATALOG AND PROCUREMENT LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

const extendedBooks = await Promise.all([
  prisma.books.upsert({
    where: { book_code: 'BK-EXT-001' },
    update: {},
    create: {
      book_code: 'BK-EXT-001', title: 'Dế Mèn Phiêu Lưu Ký', subtitle: 'Ấn bản minh họa',
      description: 'Tác phẩm thiếu nhi kinh điển về hành trình trưởng thành, tình bạn và trách nhiệm.',
      publisher_id: publishers[0].id, edition: 'Tái bản 2025', published_date: new Date('2025-02-15'),
      page_count: 208, country_of_origin: 'Vietnam', default_language: 'vi', is_active: true,
      metadata: { genre: ['children', 'adventure'], target_audience: ['children', 'family'], reading_level: 'beginner' },
    },
  }),
  prisma.books.upsert({
    where: { book_code: 'BK-EXT-002' },
    update: {},
    create: {
      book_code: 'BK-EXT-002', title: 'Tư Duy Phản Biện', subtitle: 'Kỹ năng cho người học suốt đời',
      description: 'Cẩm nang thực hành đánh giá lập luận, nguồn tin và ra quyết định dựa trên bằng chứng.',
      publisher_id: publishers[1].id, edition: 'Lần 2', published_date: new Date('2024-09-10'),
      page_count: 356, country_of_origin: 'Vietnam', default_language: 'vi', is_active: true,
      metadata: { genre: ['education', 'self-help'], target_audience: ['university', 'professional'], reading_level: 'intermediate' },
    },
  }),
  prisma.books.upsert({
    where: { book_code: 'BK-EXT-003' },
    update: {},
    create: {
      book_code: 'BK-EXT-003', title: 'Project Hail Mary', subtitle: 'A Novel',
      description: 'A science-fiction survival story centered on problem solving and collaboration.',
      publisher_id: publishers[2].id, edition: 'Paperback', published_date: new Date('2023-05-02'),
      page_count: 496, country_of_origin: 'United States', default_language: 'en', is_active: true,
      metadata: { genre: ['science-fiction'], target_audience: ['adult'], reading_level: 'advanced' },
    },
  }),
]);

const extendedVariants = await Promise.all([
  prisma.book_variants.upsert({
    where: { sku: 'SKU-EXT-001-PB' }, update: {},
    create: { book_id: extendedBooks[0].id, sku: 'SKU-EXT-001-PB', isbn13: '9786042389001', internal_barcode: 'BC-EXT-001', cover_type: 'PAPERBACK', language_code: 'vi', publish_year: 2025, condition_grade: 'NEW', unit_cost: 68000, list_price: 99000, replacement_cost: 120000, is_borrowable: true, is_sellable: true, is_track_by_unit: true, is_active: true },
  }),
  prisma.book_variants.upsert({
    where: { sku: 'SKU-EXT-002-PB' }, update: {},
    create: { book_id: extendedBooks[1].id, sku: 'SKU-EXT-002-PB', isbn13: '9786042389002', internal_barcode: 'BC-EXT-002', cover_type: 'PAPERBACK', language_code: 'vi', publish_year: 2024, condition_grade: 'NEW', unit_cost: 92000, list_price: 145000, replacement_cost: 175000, is_borrowable: true, is_sellable: true, is_track_by_unit: false, is_active: true },
  }),
  prisma.book_variants.upsert({
    where: { sku: 'SKU-EXT-003-PB' }, update: {},
    create: { book_id: extendedBooks[2].id, sku: 'SKU-EXT-003-PB', isbn13: '9780593135204', internal_barcode: 'BC-EXT-003', cover_type: 'PAPERBACK', language_code: 'en', publish_year: 2023, condition_grade: 'NEW', unit_cost: 210000, list_price: 320000, replacement_cost: 380000, is_borrowable: true, is_sellable: true, is_track_by_unit: true, is_active: true },
  }),
]);

await prisma.book_categories.createMany({
  data: extendedBooks.map((book, index) => ({ book_id: book.id, category_id: categories[index % categories.length].id })),
  skipDuplicates: true,
});
await prisma.book_authors.createMany({
  data: extendedBooks.map((book, index) => ({ book_id: book.id, author_id: authors[index % authors.length].id, author_order: 1 })),
  skipDuplicates: true,
});
await prisma.supplier_variants.createMany({
  data: extendedVariants.map((variant, index) => ({ supplier_id: suppliers[index % suppliers.length].id, variant_id: variant.id, supplier_sku: `EXT-SUP-${String(index + 1).padStart(3, '0')}`, default_cost: [68000, 92000, 210000][index], min_order_qty: 5, is_preferred: true })),
  skipDuplicates: true,
});
await Promise.all(extendedVariants.map((variant, index) => prisma.stock_balances.upsert({
  where: { variant_id_location_id: { variant_id: variant.id, location_id: compartments[index].id } }, update: {},
  create: { warehouse_id: hcmWarehouse.id, variant_id: variant.id, location_id: compartments[index].id, on_hand_qty: [18, 4, 0][index], available_qty: [16, 3, 0][index], reserved_qty: [2, 1, 0][index], safety_stock_qty: 5, reorder_point: 6, version: 1, status: index === 2 ? 'OUT_OF_STOCK' : 'AVAILABLE', last_movement_at: new Date('2026-08-01T09:00:00+07:00') },
})));

const extendedPurchaseOrders = await Promise.all([
  prisma.purchase_orders.upsert({
    where: { po_number: 'PO-EXT-001' }, update: {},
    create: { po_number: 'PO-EXT-001', supplier_id: suppliers[0].id, warehouse_id: hcmWarehouse.id, status: 'APPROVED', ordered_by_user_id: '00000000-0000-0000-0000-000000000001', approved_by_user_id: '00000000-0000-0000-0000-000000000001', order_date: new Date('2026-07-20'), expected_date: new Date('2026-08-05'), note: 'Approved replenishment for children and skills titles.' },
  }),
  prisma.purchase_orders.upsert({
    where: { po_number: 'PO-EXT-002' }, update: {},
    create: { po_number: 'PO-EXT-002', supplier_id: suppliers[2].id, warehouse_id: hnWarehouse.id, status: 'DRAFT', ordered_by_user_id: '00000000-0000-0000-0000-000000000001', order_date: new Date('2026-08-10'), expected_date: new Date('2026-09-05'), note: 'Draft import order for international fiction.' },
  }),
]);
await prisma.purchase_order_items.createMany({
  data: [
    { purchase_order_id: extendedPurchaseOrders[0].id, variant_id: extendedVariants[0].id, ordered_qty: 30, received_qty: 0, unit_cost: 68000 },
    { purchase_order_id: extendedPurchaseOrders[0].id, variant_id: extendedVariants[1].id, ordered_qty: 20, received_qty: 0, unit_cost: 92000 },
    { purchase_order_id: extendedPurchaseOrders[1].id, variant_id: extendedVariants[2].id, ordered_qty: 12, received_qty: 0, unit_cost: 210000 },
  ], skipDuplicates: true,
});

console.log(`✅ Created ${extendedBooks.length} extended books, ${extendedVariants.length} variants, and ${extendedPurchaseOrders.length} purchase orders`);

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('📚 SMARTBOOK INVENTORY SEED COMPLETED SUCCESSFULLY!');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log(`   • ${warehouses.length} Warehouses (HCM, Hanoi, Branches)`);
console.log(`   • ${receivingLocations.length + zones.length + shelves.length + compartments.length} Locations`);
console.log(`   • ${categories.length} Categories`);
console.log(`   • ${publishers.length} Publishers`);
console.log(`   • ${authors.length} Authors`);
console.log(`   • ${books.length} Books (with AI metadata)`);
console.log(`   • ${variants.length} Book Variants`);
console.log(`   • ${suppliers.length} Suppliers`);
console.log(`   • Stock balances across multiple warehouses`);
console.log(`   • Stock movements for historical analysis`);
console.log('═══════════════════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
