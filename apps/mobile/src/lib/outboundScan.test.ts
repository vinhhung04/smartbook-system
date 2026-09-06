import { resolveScannedCode } from './outboundScan';
import type { AvailableOutboundTask, OutboundTaskListItem } from '../types/outbound';

function makeAvailable(overrides: Partial<AvailableOutboundTask> = {}): AvailableOutboundTask {
  return {
    id: 'task-1',
    type: 'OUTBOUND',
    task_type: 'outbound',
    title: 'OUT-001',
    status: 'READY_FOR_OUTBOUND',
    warehouse: 'WH-HCM-01',
    warehouse_id: 'wh-1',
    created_at: '2026-01-01T00:00:00.000Z',
    claimable: true,
    claim_endpoint: '/api/outbound/orders/outbound/task-1/claim-self',
    ...overrides,
  };
}

function makeMine(overrides: Partial<OutboundTaskListItem> = {}): OutboundTaskListItem {
  return {
    task_type: 'outbound',
    task_id: 'task-2',
    order_number: 'OUT-002',
    status: 'READY_FOR_OUTBOUND',
    source_warehouse_code: 'WH-HCM-01',
    source_warehouse_name: null,
    target_warehouse_code: null,
    target_warehouse_name: null,
    outbound_assigned_user_id: 'user-1',
    total_quantity: 3,
    ready_quantity: 3,
    ...overrides,
  };
}

describe('resolveScannedCode', () => {
  it('resolves an unclaimed order in the available list to claim-then-confirm', () => {
    const result = resolveScannedCode('OUT-001', 'outbound', [makeAvailable()], []);
    expect(result).toEqual({
      kind: 'claim-then-confirm',
      taskId: 'task-1',
      taskType: 'outbound',
      claimEndpoint: '/api/outbound/orders/outbound/task-1/claim-self',
      orderNumber: 'OUT-001',
      status: 'READY_FOR_OUTBOUND',
    });
  });

  it('resolves an already-assigned order in the mine list to confirm directly', () => {
    const result = resolveScannedCode('OUT-002', 'outbound', [], [makeMine()]);
    expect(result).toEqual({
      kind: 'confirm',
      taskId: 'task-2',
      taskType: 'outbound',
      orderNumber: 'OUT-002',
      status: 'READY_FOR_OUTBOUND',
    });
  });

  it('matches case-insensitively', () => {
    const result = resolveScannedCode('out-001', 'outbound', [makeAvailable()], []);
    expect(result.kind).toBe('claim-then-confirm');
  });

  it('still resolves an assigned order that is not yet ready — readiness is the caller\'s job', () => {
    // resolveScannedCode only answers "which order is this?"; canConfirmOutbound
    // (applied by the scan screen) decides whether PICKING/REPICKING is ready.
    const result = resolveScannedCode('OUT-002', 'outbound', [], [makeMine({ status: 'PICKING' })]);
    expect(result).toEqual({
      kind: 'confirm',
      taskId: 'task-2',
      taskType: 'outbound',
      orderNumber: 'OUT-002',
      status: 'PICKING',
    });
  });

  it('carries a REPICKING status through so the caller can check the repick chain', () => {
    const result = resolveScannedCode('OUT-002', 'outbound', [], [makeMine({ status: 'REPICKING' })]);
    expect(result).toMatchObject({ kind: 'confirm', status: 'REPICKING' });
  });

  it('does not cross-match a transfer order while scanning in outbound mode', () => {
    const transferTask = makeAvailable({ task_type: 'transfer', title: 'TRF-001' });
    const result = resolveScannedCode('TRF-001', 'outbound', [transferTask], []);
    expect(result).toEqual({ kind: 'wrong-mode', correctMode: 'transfer' });
  });

  it('resolves a transfer order when scanning in transfer mode', () => {
    const transferTask = makeAvailable({ task_type: 'transfer', title: 'TRF-001' });
    const result = resolveScannedCode('TRF-001', 'transfer', [transferTask], []);
    expect(result.kind).toBe('claim-then-confirm');
  });

  it('returns not-found for a code that matches nothing at all', () => {
    const result = resolveScannedCode('UNKNOWN-CODE', 'outbound', [makeAvailable()], [makeMine()]);
    expect(result).toEqual({ kind: 'not-found' });
  });

  it('prefers the available (unclaimed) match over a same-code mine match', () => {
    const available = makeAvailable({ title: 'OUT-999' });
    const mine = makeMine({ order_number: 'OUT-999', task_id: 'task-mine' });
    const result = resolveScannedCode('OUT-999', 'outbound', [available], [mine]);
    expect(result.kind).toBe('claim-then-confirm');
  });
});
