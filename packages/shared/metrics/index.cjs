const { metrics } = require('@opentelemetry/api');

function getMeter(serviceName) {
  return metrics.getMeter(serviceName);
}

module.exports = { getMeter };
