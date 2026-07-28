// Known recurring calendar events that affect book demand seasonality.
// Tết dates are lunar (move every year), so they're hardcoded per year rather
// than computed — only a handful of years are needed, updated periodically.
const SEASONAL_EVENTS = [
  { name: 'Tựu trường', month: 8, startDay: 15, month2: 9, endDay: 15 },
  { name: 'Tết Nguyên Đán 2025', start: '2025-01-22', end: '2025-02-05' },
  { name: 'Tết Nguyên Đán 2026', start: '2026-02-10', end: '2026-02-24' },
  { name: 'Tết Nguyên Đán 2027', start: '2027-01-30', end: '2027-02-13' },
  { name: 'Tết Nguyên Đán 2028', start: '2028-01-19', end: '2028-02-02' },
];

function findSeasonalEvent(date) {
  const iso = date.toISOString().slice(0, 10);

  for (const event of SEASONAL_EVENTS) {
    if (event.start && event.end) {
      if (iso >= event.start && iso <= event.end) {
        return event.name;
      }
    } else if (event.month && event.month2) {
      const year = date.getUTCFullYear();
      const start = new Date(Date.UTC(year, event.month - 1, event.startDay));
      const end = new Date(Date.UTC(year, event.month2 - 1, event.endDay));
      if (date >= start && date <= end) {
        return event.name;
      }
    }
  }

  return null;
}

module.exports = { findSeasonalEvent };
