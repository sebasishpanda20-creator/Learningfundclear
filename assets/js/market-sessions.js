/* Fixed market-session clock. Schedule arithmetic only: no exchange feed,
 * holiday calendar, early-close data or prices. No timers, no live data.
 * Uses IANA timezone names so DST transitions are handled by the host OS.
 */
(function (root) {
  'use strict';

  const VENUES = [
    {
      id: 'crypto',
      name: 'Crypto spot',
      zone: 'UTC',
      short: 'UTC',
      hours: '24/7 · UTC',
      alwaysOpen: true,
      windows: [[0, 1440]],
    },
    {
      id: 'new-york',
      name: 'New York',
      zone: 'America/New_York',
      short: 'ET',
      hours: 'Mon–Fri 09:30–16:00 ET',
      windows: [[570, 960]],
    },
    {
      id: 'london',
      name: 'London',
      zone: 'Europe/London',
      short: 'GMT/BST',
      hours: 'Mon–Fri 08:00–16:30 London',
      windows: [[480, 990]],
    },
    {
      id: 'tokyo',
      name: 'Tokyo',
      zone: 'Asia/Tokyo',
      short: 'JST',
      hours: 'Mon–Fri 09:00–11:30, 12:30–15:30 JST',
      windows: [[540, 690], [750, 930]],
    },
    {
      id: 'mumbai',
      name: 'Mumbai',
      zone: 'Asia/Kolkata',
      short: 'IST',
      hours: 'Mon–Fri 09:15–15:30 IST',
      windows: [[555, 930]],
    },
  ];

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function statusFor(venue, date = new Date()) {
    const parts = {};
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: venue.zone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
    for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
    const hour = Number(parts.hour) % 24;
    const minute = Number(parts.minute);
    const dow = WEEKDAYS.indexOf(String(parts.weekday).slice(0, 3));
    const weekday = dow >= 1 && dow <= 5;
    const open = venue.alwaysOpen === true || (weekday && venue.windows.some(([start, end]) => hour * 60 + minute >= start && hour * 60 + minute < end));
    return {
      open,
      time: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ' ' + (venue.short || parts.timeZoneName || venue.zone),
      zone: venue.zone,
    };
  }

  const esc = (value) =>
    String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* Fills [id=sessionGrid] from the fixed schedules. The markup matches the
   * .session-venue styles in crypto.css; nothing here polls an exchange. */
  function render(doc = document, date = new Date()) {
    const grid = doc.getElementById('sessionGrid');
    if (!grid) return false;
    grid.innerHTML = VENUES.map((venue) => {
      const status = statusFor(venue, date);
      return (
        '<div class="session-venue" data-open="' + status.open + '">' +
        '<div class="session-venue-head"><strong>' + esc(venue.name) + '</strong>' +
        '<span class="session-state">' + (status.open ? 'Open' : 'Closed') + '</span></div>' +
        '<span class="session-time">' + esc(status.time) + '</span>' +
        '<span class="session-zone">' + esc(venue.zone) + '</span>' +
        '<span class="session-hours">' + esc(venue.hours) + '</span></div>'
      );
    }).join('');
    const stamp = doc.getElementById('sessionNow');
    if (stamp) stamp.textContent = 'Updated ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return true;
  }

  function start(doc = document) {
    if (!render(doc)) return;
    setInterval(() => render(doc), 60000);
  }

  root.LfcMarketSessions = { VENUES, statusFor, render, start };

  if (typeof document !== 'undefined' && root === document.defaultView) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start());
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);