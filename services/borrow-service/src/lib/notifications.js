const { pushEvents } = require('./socket-emitter');
const { sendEmail } = require('./email-sender');

const TEMPLATE_TO_EVENT = {
  RESERVATION_CREATED: 'reservation:status_changed',
  RESERVATION_CONFIRMED: 'reservation:status_changed',
  RESERVATION_CANCELLED: 'reservation:status_changed',
  LOAN_CREATED: 'loan:status_changed',
  LOAN_RETURNED: 'loan:status_changed',
  LOAN_OVERDUE: 'loan:status_changed',
  LOAN_DUE_REMINDER: 'loan:status_changed',
  LOAN_RENEWAL_REQUEST: 'loan:status_changed',
  LOAN_RENEWAL_REVIEWED: 'loan:status_changed',
  FINE_CREATED: 'fine:created',
  FINE_PAYMENT_RECORDED: 'fine:created',
  FINE_WAIVED: 'fine:created',
};

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
    events.push({
      room: 'admin',
      event: domainEvent,
      data: {
        ...notificationData,
        customer_id: payload.customer_id,
      },
    });
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
