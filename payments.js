// Razorpay integration — deposit collection for both the website (Checkout
// popup) and WhatsApp (payment link message). Kept as its own module so
// server.js and whatsapp-agent.js can both use it without circular requires.
const crypto = require('crypto');

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// Fallback deposit amount in paise, used only if the admin hasn't set one
// in Settings. ₹50 default.
const DEFAULT_DEPOSIT_AMOUNT = parseInt(process.env.DEPOSIT_AMOUNT_PAISE, 10) || 5000;

function isConfigured() {
  return !!(KEY_ID && KEY_SECRET);
}

async function razorpayRequest(path, method, body) {
  const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.description || 'Razorpay request failed';
    throw new Error(msg);
  }
  return data;
}

/**
 * Creates a Razorpay Order for the website Checkout popup.
 * receipt should be the booking's orderId (e.g. "VJS1001") for easy tracing.
 * amountPaise defaults to DEFAULT_DEPOSIT_AMOUNT if not given.
 */
async function createOrder(receipt, amountPaise) {
  const amount = amountPaise || DEFAULT_DEPOSIT_AMOUNT;
  const order = await razorpayRequest('orders', 'POST', {
    amount,
    currency: 'INR',
    receipt,
    notes: { booking_order_id: receipt }
  });
  return { orderId: order.id, amount, keyId: KEY_ID };
}

/**
 * Creates a Razorpay Payment Link for WhatsApp — a plain URL the customer
 * opens in their own browser to pay, since WhatsApp can't embed a checkout popup.
 * referenceId should be the booking's orderId, used later to match the
 * webhook event back to the right booking.
 */
async function createPaymentLink({ referenceId, customerName, customerPhone, description, amountPaise }) {
  const amount = amountPaise || DEFAULT_DEPOSIT_AMOUNT;
  const link = await razorpayRequest('payment_links', 'POST', {
    // upi_link: true, // re-add once UPI is approved on the Razorpay account
    amount,
    currency: 'INR',
    reference_id: referenceId,
    description: description || `Booking deposit — ${referenceId}`,
    customer: {
      name: customerName,
      contact: '+91' + customerPhone
    },
    notify: { sms: false, email: false }, // we deliver the link via WhatsApp ourselves
    notes: { booking_order_id: referenceId }
  });
  return { paymentLinkId: link.id, shortUrl: link.short_url, amount };
}

/**
 * Verifies the signature Razorpay Checkout hands back to the browser after a
 * successful payment (website flow only).
 */
function verifyCheckoutSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  return expected === razorpay_signature;
}

/**
 * Verifies an incoming webhook actually came from Razorpay (used for both
 * payment_link.paid and payment.captured events).
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return expected === signature;
}

module.exports = {
  isConfigured,
  createOrder,
  createPaymentLink,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  DEFAULT_DEPOSIT_AMOUNT
};
