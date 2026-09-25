// Phone numbers are stored however staff typed them ("(512) 555-0147",
// "512.555.0147"). Twilio needs E.164 ("+15125550147"). US numbers only
// get a default country code; anything already starting with + is kept.
export function toE164(raw, defaultCountry = '1') {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// "+15125550147" -> "(512) 555-0147" for display; anything else unchanged.
export function formatPhone(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(String(e164 || ''));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 || '';
}

// Last 4 digits, for showing where a code was sent without revealing the number.
export function maskPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : '•••';
}

export function maskEmail(raw) {
  const s = String(raw || '');
  const at = s.indexOf('@');
  if (at < 1) return '•••';
  return `${s[0]}•••${s.slice(at)}`;
}
