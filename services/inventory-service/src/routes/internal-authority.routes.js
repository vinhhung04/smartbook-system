const router = require('express').Router();
const { reconcileMetadata } = require('../services/authority-normalization.service');
const { readAuthorities } = require('../controllers/metadata-reconciliation.controller');

router.post('/normalize', async (req, res) => {
  const expectedKey = String(process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key').trim();
  const providedKey = String(req.headers['x-internal-service-key'] || '').trim();
  if (!providedKey || providedKey !== expectedKey) return res.status(403).json({ message: 'Forbidden' });
  try {
    const result = reconcileMetadata(req.body?.metadata || {}, await readAuthorities());
    return res.json(result);
  } catch (error) {
    console.error('Unable to normalize internal authority metadata', error);
    return res.status(500).json({ message: 'Unable to normalize authority metadata' });
  }
});

module.exports = router;
