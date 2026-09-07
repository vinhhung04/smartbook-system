import { canCancelReservation, getReservationStatusDisplay } from './reservationStatus';

describe('getReservationStatusDisplay', () => {
  it('maps READY_FOR_PICKUP to a success tone', () => {
    expect(getReservationStatusDisplay('READY_FOR_PICKUP')).toEqual({
      label: 'Sẵn sàng nhận',
      tone: 'success',
    });
  });

  it('maps CANCELLED and EXPIRED to a danger tone', () => {
    expect(getReservationStatusDisplay('CANCELLED').tone).toBe('danger');
    expect(getReservationStatusDisplay('EXPIRED').tone).toBe('danger');
  });
});

describe('canCancelReservation', () => {
  it('allows cancelling while pending, confirmed or ready for pickup', () => {
    expect(canCancelReservation('PENDING')).toBe(true);
    expect(canCancelReservation('CONFIRMED')).toBe(true);
    expect(canCancelReservation('READY_FOR_PICKUP')).toBe(true);
  });

  it('blocks cancelling once converted, cancelled or expired', () => {
    expect(canCancelReservation('CONVERTED_TO_LOAN')).toBe(false);
    expect(canCancelReservation('CANCELLED')).toBe(false);
    expect(canCancelReservation('EXPIRED')).toBe(false);
  });
});
