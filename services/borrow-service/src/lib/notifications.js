const { pushEvents } = require('./socket-emitter');
const { sendEmail } = require('./email-sender');

const TEMPLATE_TO_EVENT = {
  RESERVATION_CREATED:       'reservation:created',
  RESERVATION_CONFIRMED:     'reservation:confirmed',
  RESERVATION_CANCELLED:     'reservation:cancelled',
  RESERVATION_EXPIRED:       'reservation:expired',
  LOAN_CREATED:              'loan:created',
  LOAN_RETURNED:             'loan:returned',
  LOAN_OVERDUE:              'loan:overdue',
  LOAN_DUE_REMINDER:         'loan:status_changed',
  LOAN_RENEWAL_REQUEST:      'loan:renewal_requested',
  LOAN_RENEWAL_REVIEWED:     'loan:renewal_reviewed',
  FINE_CREATED:              'fine:created',
  FINE_PAYMENT_RECORDED:     'fine:paid',
  FINE_WAIVED:               'fine:waived',
};

// Roles that should receive domain events for staff-facing modules
const STAFF_ROOMS = ['admin', 'librarian'];

async function createNotificationRecord(tx, payload) {
  const record = await tx.customer_notifications.create({
    data: {
      customer_id: payload.customer_id,
      channel: payload.channel || 'IN_APP',
      template_code: payload.template_code || null,
      subject: payload.subject || null,
      body: payload.body,
      reference_type: payload.reference_type || null,
      reference_id: payload.reference_id || null,
      status: payload.status || 'PENDING',
      metadata: payload.metadata || {},
    },
  });

  const notificationData = {
    id: record.id,
    subject: payload.subject || null,
    body: payload.body,
    template_code: payload.template_code || null,
    reference_type: payload.reference_type || null,
    reference_id: payload.reference_id || null,
    metadata: payload.metadata || {},
    created_at: record.created_at,
  };

  const events = [
    {
      room: `customer:${payload.customer_id}`,
      event: 'notification:new',
      data: notificationData,
    },
  ];

  const domainEvent = TEMPLATE_TO_EVENT[payload.template_code];
  if (domainEvent) {
    const staffPayload = {
      ...notificationData,
      customer_id: payload.customer_id,
    };
    for (const room of STAFF_ROOMS) {
      events.push({ room, event: domainEvent, data: staffPayload });
    }
  }

  setImmediate(() => void pushEvents(events));

  if (payload.email && payload.template_code) {
    setImmediate(() => void sendEmail(payload.email, payload.template_code, payload.email_data || {}));
  }

  return record;
}

module.exports = {
  createNotificationRecord,
};
