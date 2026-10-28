'use strict';

// Synthetic demo only. Replace with the user's authorized data connection.
// Pass signal to fetch, use secrets from mapped environment variables, verify
// responses, and preserve the source observation time instead of relabeling old data.
exports.collect = async ({ now }) => ({
  observedAt: now.toISOString(),
  display: { layout: 'metric', title: 'DEMO OPEN RATE', value: '42.5%', footer: 'SAMPLE DATA', icon: 'mail' },
  led: { color: 'green', mode: 'solid' }
});
