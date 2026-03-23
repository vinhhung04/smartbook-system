function createMovementNumber(baseTimestamp, index, prefix = '') {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  if (prefix) {
    return `MV-${prefix}-${baseTimestamp}-${index + 1}-${suffix}`;
  }
  return `MV-${baseTimestamp}-${index + 1}-${suffix}`;
}

function toSerializableError(error) {
  const code = String(error?.code || '').toUpperCase();
  const msg = String(error?.message || '').toLowerCase();
  return code === 'P2034' || code === '40001' || msg.includes('could not serialize');
}

module.exports = {
  createMovementNumber,
  toSerializableError,
};
