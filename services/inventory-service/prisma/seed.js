const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting inventory-service seed...');

  // Create warehouses
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
  ]);
  console.log(`Created ${warehouses.length} warehouses`);

  // Create locations for WH-HCM-01
  // Structure: RECEIVING > ZONE > SHELF > SHELF_COMPARTMENT
  const hcmWarehouse = warehouses[0];

  // 1. RECEIVING location (RECEIVING type)
  const receivingLocation = await prisma.locations.upsert({
    where: {
      warehouse_id_location_code: {
        warehouse_id: hcmWarehouse.id,
        location_code: 'RECEIVING-01'
      }
    },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      location_code: 'RECEIVING-01',
      location_type: 'RECEIVING',
      barcode: 'LOC-RECEIVING-01',
      is_pickable: false,
      is_active: true,
    },
  });
  console.log('Created RECEIVING location');

  // 2. ZONE (parent location)
  const zoneA = await prisma.locations.upsert({
    where: {
      warehouse_id_location_code: {
        warehouse_id: hcmWarehouse.id,
        location_code: 'ZONE-A'
      }
    },
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
  });
  console.log('Created ZONE-A');

  // 3. SHELF (parent of compartments)
  const shelfA1 = await prisma.locations.upsert({
    where: {
      warehouse_id_location_code: {
        warehouse_id: hcmWarehouse.id,
        location_code: 'SHELF-A-01'
      }
    },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: zoneA.id,
      location_code: 'SHELF-A-01',
      location_type: 'SHELF',
      zone: 'A',
      aisle: '01',
      barcode: 'LOC-SHELF-A-01',
      is_pickable: false,
      is_active: true,
    },
  });
  console.log('Created SHELF-A-01');

  // 4. SHELF_COMPARTMENT (actual storage bins)
  const compartments = await Promise.all([
    prisma.locations.upsert({
      where: {
        warehouse_id_location_code: {
          warehouse_id: hcmWarehouse.id,
          location_code: 'A-01-001'
        }
      },
      update: {},
      create: {
        warehouse_id: hcmWarehouse.id,
        parent_location_id: shelfA1.id,
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
      where: {
        warehouse_id_location_code: {
          warehouse_id: hcmWarehouse.id,
          location_code: 'A-01-002'
        }
      },
      update: {},
      create: {
        warehouse_id: hcmWarehouse.id,
        parent_location_id: shelfA1.id,
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
  ]);
  console.log(`Created ${compartments.length} SHELF_COMPARTMENT locations`);

  // Create ZONE-B and SHELF for more capacity
  const zoneB = await prisma.locations.upsert({
    where: {
      warehouse_id_location_code: {
        warehouse_id: hcmWarehouse.id,
        location_code: 'ZONE-B'
      }
    },
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
  });

  const shelfB1 = await prisma.locations.upsert({
    where: {
      warehouse_id_location_code: {
        warehouse_id: hcmWarehouse.id,
        location_code: 'SHELF-B-01'
      }
    },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: zoneB.id,
      location_code: 'SHELF-B-01',
      location_type: 'SHELF',
      zone: 'B',
      aisle: '01',
      barcode: 'LOC-SHELF-B-01',
      is_pickable: false,
      is_active: true,
    },
  });

  await prisma.locations.upsert({
    where: {
      warehouse_id_location_code: {
        warehouse_id: hcmWarehouse.id,
        location_code: 'B-01-001'
      }
    },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      parent_location_id: shelfB1.id,
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
  });
  console.log('Created ZONE-B and B-01-001');

  // Create categories
  const categories = await Promise.all([
    prisma.categories.upsert({
      where: { slug: 'van-hoc' },
      update: {},
      create: {
        name: 'Van hoc',
        slug: 'van-hoc',
        description: 'Sach van hoc Viet Nam va the gioi',
      },
    }),
    prisma.categories.upsert({
      where: { slug: 'truyen-ngan' },
      update: {},
      create: {
        name: 'Truyen ngan',
        slug: 'truyen-ngan',
        description: 'Truyen ngan, truyen dai',
      },
    }),
    prisma.categories.upsert({
      where: { slug: 'ky-nang-song' },
      update: {},
      create: {
        name: 'Ky nang song',
        slug: 'ky-nang-song',
        description: 'Sach ky nang song, phat trien ban than',
      },
    }),
    prisma.categories.upsert({
      where: { slug: 'kinh-te' },
      update: {},
      create: {
        name: 'Kinh te',
        slug: 'kinh-te',
        description: 'Sach kinh te, kinh doanh',
      },
    }),
    prisma.categories.upsert({
      where: { slug: 'congtac-vien' },
      update: {},
      create: {
        name: 'Cong tac vien',
        slug: 'congtac-vien',
        description: 'Sach lich su, chinh tri',
      },
    }),
  ]);
  console.log(`Created ${categories.length} categories`);

  // Create publishers
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
  ]);
  console.log(`Created ${publishers.length} publishers`);

  // Create authors
  const authors = await Promise.all([
    prisma.authors.upsert({
      where: { full_name: 'Nam Cao' },
      update: {},
      create: {
        full_name: 'Nam Cao',
        sort_name: 'Cao, Nam',
        biography: 'Nam Cao (1915-1962) la nha van noi tieng cua Vietnam, tac gia cua "So do" va "Chiec la cuoi cung".',
      },
    }),
    prisma.authors.upsert({
      where: { full_name: 'Xuan Dieu' },
      update: {},
      create: {
        full_name: 'Xuan Dieu',
        sort_name: 'Dieu, Xuan',
        biography: 'Xuan Dieu (1916-1985) la nha van, nhap khau, tac gia cua nhieu tac pham noi tieng.',
      },
    }),
    prisma.authors.upsert({
      where: { full_name: 'To Hoai' },
      update: {},
      create: {
        full_name: 'To Hoai',
        sort_name: 'Hoai, To',
        biography: 'To Hoai (1920-2010) la nha van noi tieng, tac gia cua "Tam Cam".',
      },
    }),
    prisma.authors.upsert({
      where: { full_name: 'Ngo Tat Lu' },
      update: {},
      create: {
        full_name: 'Ngo Tat Lu',
        sort_name: 'Lu, Ngo Tat',
        biography: 'Ngo Tat Lu (1894-1963) la nha van lon cua van hoc Viet Nam hien dai.',
      },
    }),
  ]);
  console.log(`Created ${authors.length} authors`);

  // Create books
  const books = await Promise.all([
    prisma.books.upsert({
      where: { book_code: 'BK-001' },
      update: {},
      create: {
        book_code: 'BK-001',
        title: 'So do',
        subtitle: 'Tieu thuyet',
        description: 'Tac pham kinh dien cua Nam Cao ve cuoc song nhan vat nong thon.',
        publisher_id: publishers[0].id,
        edition: 'Lan 1',
        published_date: new Date('2020-01-15'),
        page_count: 320,
        country_of_origin: 'Vietnam',
        default_language: 'vi',
        is_active: true,
      },
    }),
    prisma.books.upsert({
      where: { book_code: 'BK-002' },
      update: {},
      create: {
        book_code: 'BK-002',
        title: 'Chiec la cuoi cung',
        subtitle: 'Truyen ngan',
        description: 'Truyen ngan chan cam cua Nam Cao.',
        publisher_id: publishers[0].id,
        edition: 'Lan 3',
        published_date: new Date('2019-06-20'),
        page_count: 150,
        country_of_origin: 'Vietnam',
        default_language: 'vi',
        is_active: true,
      },
    }),
    prisma.books.upsert({
      where: { book_code: 'BK-003' },
      update: {},
      create: {
        book_code: 'BK-003',
        title: 'Thuyen bac nho',
        subtitle: 'Tho',
        description: 'Tuyen tap tho hay cua Xuan Dieu.',
        publisher_id: publishers[1].id,
        edition: 'Lan 2',
        published_date: new Date('2021-03-10'),
        page_count: 200,
        country_of_origin: 'Vietnam',
        default_language: 'vi',
        is_active: true,
      },
    }),
    prisma.books.upsert({
      where: { book_code: 'BK-004' },
      update: {},
      create: {
        book_code: 'BK-004',
        title: 'Tam Cam',
        subtitle: 'Co tich',
        description: 'Chuyen tich co tich Viet Nam, phien ban cua To Hoai.',
        publisher_id: publishers[1].id,
        edition: 'Lan 5',
        published_date: new Date('2018-11-25'),
        page_count: 280,
        country_of_origin: 'Vietnam',
        default_language: 'vi',
        is_active: true,
      },
    }),
    prisma.books.upsert({
      where: { book_code: 'BK-005' },
      update: {},
      create: {
        book_code: 'BK-005',
        title: 'Toi thay hoa vang tren co xanh',
        subtitle: 'Tieu thuyet',
        description: 'Tieu thuyet noi tieng cua Ngo Tat Lu.',
        publisher_id: publishers[2].id,
        edition: 'Lan 10',
        published_date: new Date('2017-05-30'),
        page_count: 450,
        country_of_origin: 'Vietnam',
        default_language: 'vi',
        is_active: true,
      },
    }),
  ]);
  console.log(`Created ${books.length} books`);

  // Link books with authors
  await prisma.book_authors.createMany({
    data: [
      { book_id: books[0].id, author_id: authors[0].id, author_order: 1 },
      { book_id: books[1].id, author_id: authors[0].id, author_order: 1 },
      { book_id: books[2].id, author_id: authors[1].id, author_order: 1 },
      { book_id: books[3].id, author_id: authors[2].id, author_order: 1 },
      { book_id: books[4].id, author_id: authors[3].id, author_order: 1 },
    ],
    skipDuplicates: true,
  });
  console.log('Linked books with authors');

  // Link books with categories
  await prisma.book_categories.createMany({
    data: [
      { book_id: books[0].id, category_id: categories[0].id },
      { book_id: books[1].id, category_id: categories[1].id },
      { book_id: books[2].id, category_id: categories[0].id },
      { book_id: books[3].id, category_id: categories[1].id },
      { book_id: books[4].id, category_id: categories[0].id },
    ],
    skipDuplicates: true,
  });
  console.log('Linked books with categories');

  // Create book variants
  const variants = await Promise.all([
    prisma.book_variants.upsert({
      where: { sku: 'SKU-BK001-01' },
      update: {},
      create: {
        book_id: books[0].id,
        sku: 'SKU-BK001-01',
        isbn13: '9786041234567',
        isbn10: '6041234560',
        internal_barcode: 'BC-BK001-01',
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
      },
    }),
    prisma.book_variants.upsert({
      where: { sku: 'SKU-BK001-02' },
      update: {},
      create: {
        book_id: books[0].id,
        sku: 'SKU-BK001-02',
        isbn13: '9786041234568',
        isbn10: '6041234561',
        internal_barcode: 'BC-BK001-02',
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
      },
    }),
    prisma.book_variants.upsert({
      where: { sku: 'SKU-BK002-01' },
      update: {},
      create: {
        book_id: books[1].id,
        sku: 'SKU-BK002-01',
        isbn13: '9786041234569',
        isbn10: '6041234562',
        internal_barcode: 'BC-BK002-01',
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
      },
    }),
    prisma.book_variants.upsert({
      where: { sku: 'SKU-BK003-01' },
      update: {},
      create: {
        book_id: books[2].id,
        sku: 'SKU-BK003-01',
        isbn13: '9786041234570',
        isbn10: '6041234563',
        internal_barcode: 'BC-BK003-01',
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
      },
    }),
    prisma.book_variants.upsert({
      where: { sku: 'SKU-BK004-01' },
      update: {},
      create: {
        book_id: books[3].id,
        sku: 'SKU-BK004-01',
        isbn13: '9786041234571',
        isbn10: '6041234564',
        internal_barcode: 'BC-BK004-01',
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
      },
    }),
    prisma.book_variants.upsert({
      where: { sku: 'SKU-BK005-01' },
      update: {},
      create: {
        book_id: books[4].id,
        sku: 'SKU-BK005-01',
        isbn13: '9786041234572',
        isbn10: '6041234565',
        internal_barcode: 'BC-BK005-01',
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
      },
    }),
  ]);
  console.log(`Created ${variants.length} book variants`);

  // Create inventory units and stock in RECEIVING location for testing
  // Stock is first received at RECEIVING, then moved to SHELF_COMPARTMENT via putaway
  
  // First, add stock balances directly to RECEIVING location (simulating goods receipt)
  await prisma.stock_balances.upsert({
    where: {
      variant_id_location_id: {
        variant_id: variants[0].id,
        location_id: receivingLocation.id
      }
    },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[0].id,
      location_id: receivingLocation.id,
      on_hand_qty: 3,
      available_qty: 0, // RECEIVING area: available is 0 until processed
      version: 1,
      last_movement_at: new Date(),
    },
  });

  await prisma.stock_balances.upsert({
    where: {
      variant_id_location_id: {
        variant_id: variants[2].id,
        location_id: receivingLocation.id
      }
    },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[2].id,
      location_id: receivingLocation.id,
      on_hand_qty: 2,
      available_qty: 0,
      version: 1,
      last_movement_at: new Date(),
    },
  });

  // Add some stock directly to shelf compartments (for reverse testing)
  await prisma.stock_balances.upsert({
    where: {
      variant_id_location_id: {
        variant_id: variants[0].id,
        location_id: compartments[0].id
      }
    },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[0].id,
      location_id: compartments[0].id,
      on_hand_qty: 2,
      available_qty: 2,
      version: 1,
      last_movement_at: new Date(),
    },
  });

  await prisma.stock_balances.upsert({
    where: {
      variant_id_location_id: {
        variant_id: variants[2].id,
        location_id: compartments[1].id
      }
    },
    update: {},
    create: {
      warehouse_id: hcmWarehouse.id,
      variant_id: variants[2].id,
      location_id: compartments[1].id,
      on_hand_qty: 1,
      available_qty: 1,
      version: 1,
      last_movement_at: new Date(),
    },
  });
  console.log('Created stock balances in RECEIVING and shelf compartments');

  console.log('Inventory-service seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
