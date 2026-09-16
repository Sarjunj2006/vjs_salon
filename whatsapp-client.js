// Thin client for Meta's WhatsApp Cloud API (graph.facebook.com), plus
// message formatting for booking confirmations/alerts. Used by both
// server.js (website bookings, sending agent replies) and whatsapp-agent.js
// (staff alerts on WhatsApp-sourced bookings) — kept dependency-free of both
// so there's no circular require.

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH_API_VERSION = 'v21.0';

/**
 * Sends a plain-text WhatsApp message to `toDigits` (country code + number,
 * digits only, no leading +, e.g. "919876543210"). No-ops with a console log
 * if WhatsApp isn't configured yet, so the rest of the app keeps working.
 */
async function sendWhatsAppMessage(toDigits, text) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log('[WhatsApp] Not configured — would have sent to', toDigits + ':', text);
    return null;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toDigits,
        type: 'text',
        text: { body: text }
      })
    });
    const data = await res.json();
    if (!res.ok) console.error('[WhatsApp] send failed:', JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('[WhatsApp] send error:', err.message);
    return null;
  }
}

/**
 * Sends an interactive message with up to 3 tappable reply buttons.
 * `buttons` is an array of { id, title } — title max 20 characters (WhatsApp limit).
 */
async function sendWhatsAppButtons(toDigits, bodyText, buttons) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log('[WhatsApp] Not configured — would have sent buttons to', toDigits + ':', bodyText, buttons);
    return null;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toDigits,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.slice(0, 3).map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title.slice(0, 20) }
            }))
          }
        }
      })
    });
    const data = await res.json();
    if (!res.ok) console.error('[WhatsApp] send buttons failed:', JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('[WhatsApp] send buttons error:', err.message);
    return null;
  }
}

function formatCustomerConfirmation(db, booking) {
  const s = db.settings;
  return `Hi ${booking.name}! Your appointment at ${s.salonName} is confirmed ✅\n\n`
    + `Order ID: ${booking.orderId}\n`
    + `Service: ${booking.serviceName}\n`
    + `With: ${booking.professionalName}\n`
    + `When: ${booking.dateLabel} at ${booking.time}\n\n`
    + `Address: ${s.address}\n`
    + `See you soon!`;
}

function formatStaffAlert(db, booking) {
  const sourceLabel = booking.source === 'whatsapp' ? 'WhatsApp' : 'Website';
  return `🔔 New booking (${sourceLabel}) — ${booking.orderId}\n`
    + `${booking.name} (+91${booking.mobile})\n`
    + `${booking.serviceName} with ${booking.professionalName}\n`
    + `${booking.dateLabel} at ${booking.time}`
    + (booking.notes ? `\nNotes: ${booking.notes}` : '');
}

/**
 * Notifies staff of every new booking, and separately confirms with the
 * customer — but only for website bookings. WhatsApp-sourced bookings skip
 * the customer message here since the agent already sent a conversational
 * confirmation in the chat itself.
 */
async function notifyBooking(db, booking) {
  const staffNumber = (process.env.WHATSAPP_STAFF_NUMBER || db.settings.phone || '').replace(/\D/g, '');
  const tasks = [];
  if (staffNumber) tasks.push(sendWhatsAppMessage(staffNumber, formatStaffAlert(db, booking)));
  if (booking.source !== 'whatsapp') {
    const customerNumber = '91' + booking.mobile; // booking.mobile is stored as bare 10 digits
    tasks.push(sendWhatsAppMessage(customerNumber, formatCustomerConfirmation(db, booking)));
  }
  await Promise.allSettled(tasks);
}

module.exports = { sendWhatsAppMessage, sendWhatsAppButtons, notifyBooking, formatCustomerConfirmation, formatStaffAlert };
