// Sends guest-facing booking emails via Resend. Never throws — a failed
// email should not fail the booking/admin action that triggered it, so
// failures are just logged (visible in Netlify function logs).
// Env vars required: RESEND_API_KEY. Optional: RESEND_FROM.

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Domki Cesarz <rezerwacje@domkicesarz.com>';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function template(type, booking) {
  const house = `Domek ${esc(booking.houseId)}`;
  const dates = `${esc(booking.checkIn)} → ${esc(booking.checkOut)}`;
  const name = esc(booking.firstName);

  if (type === 'received') {
    return {
      subject: 'Otrzymaliśmy Twoją prośbę o rezerwację — Domki Cesarz',
      html: `<p>Cześć ${name},</p>
        <p>Dziękujemy za prośbę o rezerwację w Domkach Cesarz.</p>
        <p><strong>${house}</strong><br>${dates}</p>
        <p>Skontaktujemy się wkrótce w celu potwierdzenia i ustalenia wpłaty zadatku (${esc(booking.depositAmount)} zł).</p>
        <p>Domki Cesarz</p>`
    };
  }
  if (type === 'confirmed') {
    return {
      subject: 'Rezerwacja potwierdzona — Domki Cesarz',
      html: `<p>Cześć ${name},</p>
        <p>Twoja rezerwacja została <strong>potwierdzona</strong>.</p>
        <p><strong>${house}</strong><br>${dates}</p>
        <p>Do zobaczenia!</p>
        <p>Domki Cesarz</p>`
    };
  }
  if (type === 'cancelled') {
    return {
      subject: 'Rezerwacja anulowana — Domki Cesarz',
      html: `<p>Cześć ${name},</p>
        <p>Niestety Twoja rezerwacja na termin ${dates} (${house}) została anulowana.</p>
        <p>Napisz do nas lub zadzwoń — chętnie pomożemy znaleźć inny termin.</p>
        <p>Domki Cesarz</p>`
    };
  }
  return null;
}

async function sendBookingEmail(type, booking) {
  const tpl = template(type, booking);
  if (!tpl) return;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error(`RESEND_API_KEY not set — skipping "${type}" email to ${booking.email}`);
    return;
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || DEFAULT_FROM,
        to: booking.email,
        subject: tpl.subject,
        html: tpl.html
      })
    });
    if (!res.ok) {
      console.error(`Resend send failed (${res.status}) for "${type}" email to ${booking.email}:`, await res.text());
    }
  } catch (err) {
    console.error(`Resend send error for "${type}" email to ${booking.email}:`, err);
  }
}

module.exports = { sendBookingEmail };
