/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { notificationTarget } from './notificationTarget';

const ID = '00000000-0000-4000-8000-000000000001';

describe('notificationTarget', () => {
  it('opens the loan, reservation, wallet or book a notification is about', () => {
    expect(notificationTarget({ reference_type: 'LOAN_TRANSACTION', reference_id: ID, metadata: {} })).toBe(`/customer/my-books/loan/${ID}`);
    expect(notificationTarget({ reference_type: 'LOAN_RESERVATION', reference_id: ID, metadata: {} })).toBe(`/customer/my-books/reservation/${ID}`);
    expect(notificationTarget({ reference_type: 'FINE', reference_id: ID, metadata: {} })).toBe('/customer/wallet');
    expect(notificationTarget({ reference_type: 'BOOK', reference_id: ID, metadata: {} })).toBe(`/customer/book/${ID}`);
  });

  it('does not treat a loan item id as a loan id', () => {
    expect(notificationTarget({ reference_type: 'LOAN_ITEM', reference_id: ID, metadata: {} })).toBeNull();
    expect(notificationTarget({ reference_type: 'LOAN_ITEM', reference_id: ID, metadata: { loan_id: ID } })).toBe(`/customer/my-books/loan/${ID}`);
  });

  it('ignores unknown types and malformed ids', () => {
    expect(notificationTarget({ reference_type: 'ADMIN_MESSAGE', reference_id: ID, metadata: {} })).toBeNull();
    expect(notificationTarget({ reference_type: 'LOAN_TRANSACTION', reference_id: '../../login', metadata: {} })).toBeNull();
    expect(notificationTarget({ reference_type: null, reference_id: null, metadata: {} })).toBeNull();
  });

  it('only targets screens that exist', () => {
    const appDir = path.join(__dirname, '..', '..', 'app', 'customer');
    expect(fs.existsSync(path.join(appDir, 'my-books', 'loan', '[id].tsx'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'my-books', 'reservation', '[id].tsx'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, '(tabs)', 'wallet.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(appDir, 'book', '[id].tsx'))).toBe(true);
  });
});
