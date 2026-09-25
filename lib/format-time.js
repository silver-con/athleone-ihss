// "2:14 PM" today, "Yesterday 2:14 PM", "Mon 2:14 PM" this week, "Sep 14"
// before that — in the agency's time zone (US Central, like the rest of
// the app's EVV times).
const TZ = 'America/Chicago';

function dayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function formatMessageTime(value, now = new Date()) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
  const days = Math.round((new Date(dayKey(now)) - new Date(dayKey(d))) / 86400000);
  if (days <= 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d)} ${time}`;
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(d);
}
