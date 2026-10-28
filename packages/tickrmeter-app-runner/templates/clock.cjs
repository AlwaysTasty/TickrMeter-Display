'use strict';

// Public clock data. Change the IANA timezone and title to the user's preference.
const timeZone = 'Europe/Copenhagen';
exports.collect = async ({ now }) => ({
  observedAt: now.toISOString(),
  display: {
    layout: 'clock', title: 'COPENHAGEN',
    time: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    date: new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(now)
  },
  led: { color: 'off', mode: 'off' }
});
