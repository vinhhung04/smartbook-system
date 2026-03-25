const express = require('express');
const { prisma } = require('../lib/prisma');
const { createNotificationRecord } = require('../lib/notifications');

const router = express.Router();

router.post('/send', async (req, res) => {
  try {
    const { customer_id, subject, body } = req.body;
    if (!customer_id || !body) return res.status(400).json({ message: 'customer_id and body are required' });

    const customer = await prisma.customers.findUnique({ where: { id: customer_id } });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const record = await prisma.$transaction(async (tx) => {
      return createNotificationRecord(tx, {
        customer_id,
        channel: 'IN_APP',
        template_code: 'ADMIN_MESSAGE',
        subject: subject || 'Thông báo từ thư viện',
        body,
        reference_type: 'ADMIN_MESSAGE',
        status: 'SENT',
      });
    });

    return res.status(201).json({ data: record });
  } catch (error) {
    console.error('sendNotification error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
