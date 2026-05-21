// Re-export all services for easier imports
export * from './auth';
export * from './book';
export * from './stock-movement';
export * from './warehouse';
export * from './goods-receipt';
export * from './putaway';
export * from './receiving-putaway';
export * from './picking';
export * from './order-requests';
export * from './outbound';
export * from './ai';
export * from './user';
export * from './role';
export * from './borrow';
export * from './storage-suggestion';
export { authAPI, inventoryAPI, aiAPI } from './http-clients';
