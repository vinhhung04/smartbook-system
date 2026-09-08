export type BookLocation = {
  warehouse_id: string;
  location_id: string;
  warehouse_name: string;
  location_code: string;
  quantity: number;
  available_quantity: number;
  receiving_quantity: number;
  label: string;
  is_receiving: boolean;
};

export type BookSummary = {
  id: string;
  title: string;
  subtitle: string | null;
  author: string;
  category: string;
  publisher: string;
  isbn: string;
  cover_image_url: string | null;
  location: string;
  locations: BookLocation[];
  location_count: number;
  quantity: number;
  available_quantity: number;
  receiving_quantity: number;
};

export type BarcodeResolveResult = {
  variant_id: string;
  barcode: string;
  title: string;
  book_id: string;
};
