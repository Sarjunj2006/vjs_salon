// Free, AI-free WhatsApp bot: customers navigate a numbered menu instead of
// free-form chat. Uses the same booking-logic.js as the website, so a slot
// booked here can never clash with one booked on the site or in admin.
const { getAvailability, createBooking, isValidMobile } = require('./booking-logic');
const { notifyBooking } = require('./whatsapp-client');
const payments = require('./payments');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function freshState() {
  return { step: 'main_menu', data: {} };
}

function mainMenuText(db) {
  const s = db.settings;
  return `Welcome to ${s.salonName}! 👋\nReply with a number:\n\n`
    + `1. Book an appointment\n`
    + `2. View services & prices\n`
    + `3. Hours & location\n`
    + `4. Talk to a staff member\n\n`
    + `(You can type "menu" anytime to come back here.)`;
}

function professionalList(db) {
  return [{ id: 'any', name: 'Any Professional', role: 'Best available match' }, ...db.team];
}

function buildDateOptions() {
  const days = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const prefix = i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : DOW[d.getDay()]);
    days.push({ iso, label: `${prefix}, ${d.getDate()} ${MON[d.getMonth()]}` });
  }
  return days;
}

// WhatsApp menus get unwieldy with 15-min granularity (~40 slots/day), so
// prefer on-the-hour/half-hour times; fall back to the full list if that's empty.
function whatsappFriendlySlots(available) {
  const filtered = available.filter(t => /:00 |:30 /.test(t));
  return filtered.length ? filtered : available.slice(0, 20);
}

function parseChoice(text, max) {
  const n = parseInt(String(text).trim(), 10);
  if (Number.isInteger(n) && n >= 1 && n <= max) return n;
  return null;
}

/**
 * Handles one incoming WhatsApp message for a given db + phone number.
 * Mutates db.conversations[phone] with the current step/state and returns
 * the reply text. Caller is responsible for calling writeDB(db) after.
 */
async function handleIncomingMessage(db, phone, incomingText) {
  if (!db.conversations) db.conversations = {};
  if (!db.conversations[phone]) db.conversations[phone] = freshState();
  const convo = db.conversations[phone];
  const text = (incomingText || '').trim();
  const lower = text.toLowerCase();

  // Global reset command, works from any step.
  if (['menu', 'cancel', 'restart', 'hi', 'hello', 'hey'].includes(lower)) {
    convo.step = 'main_menu';
    convo.data = {};
    return mainMenuText(db);
  }

  switch (convo.step) {
    case 'main_menu': {
      const choice = parseChoice(text, 4);
      if (choice === 1) {
        convo.step = 'choose_professional';
        convo.data = {};
        const list = professionalList(db);
        return `Who would you like to book with?\n\n`
          + list.map((p, i) => `${i + 1}. ${p.name}${p.role ? ' — ' + p.role : ''}`).join('\n');
      }
      if (choice === 2) {
        if (!db.services.length) return `No services listed yet — please check back soon or reply "4" to talk to staff.\n\n${mainMenuText(db)}`;
        const list = db.services.map(s => `• ${s.name} (${s.duration}) — ${s.price}`).join('\n');
        return `Our services:\n\n${list}\n\n${mainMenuText(db)}`;
      }
      if (choice === 3) {
        const s = db.settings;
        return `📍 ${s.address}\n🕐 ${s.hours}\n📞 ${s.phoneDisplay || s.phone}\n\n${mainMenuText(db)}`;
      }
      if (choice === 4) {
        const s = db.settings;
        return `A staff member will follow up with you here shortly. For anything urgent, call ${s.phoneDisplay || s.phone}.\n\n${mainMenuText(db)}`;
      }
      return `Sorry, I didn't catch that.\n\n${mainMenuText(db)}`;
    }

    case 'choose_professional': {
      const list = professionalList(db);
      const choice = parseChoice(text, list.length);
      if (!choice) return `Please reply with a number from 1 to ${list.length}, or type "menu" to start over.`;
      const p = list[choice - 1];
      convo.data.professionalId = p.id;
      convo.data.professionalName = p.name;
      convo.step = 'choose_service';
      if (!db.services.length) {
        convo.step = 'main_menu';
        return `Sorry, no services are set up yet — please reply "4" to talk to staff directly.\n\n${mainMenuText(db)}`;
      }
      return `Great, ${p.name}. Which service?\n\n`
        + db.services.map((s, i) => `${i + 1}. ${s.name} (${s.duration}) — ${s.price}`).join('\n');
    }

    case 'choose_service': {
      const choice = parseChoice(text, db.services.length);
      if (!choice) return `Please reply with a number from 1 to ${db.services.length}, or type "menu" to start over.`;
      const svc = db.services[choice - 1];
      convo.data.serviceId = svc.id;
      convo.data.serviceName = svc.name;
      convo.data.serviceDuration = svc.duration;
      convo.data.servicePrice = svc.price;
      convo.step = 'choose_date';
      convo.data.dateOptions = buildDateOptions();
      return `Which day works for you?\n\n`
        + convo.data.dateOptions.map((d, i) => `${i + 1}. ${d.label}`).join('\n');
    }

    case 'choose_date': {
      const options = convo.data.dateOptions || buildDateOptions();
      const choice = parseChoice(text, options.length);
      if (!choice) return `Please reply with a number from 1 to ${options.length}, or type "menu" to start over.`;
      const picked = options[choice - 1];
      const { available } = getAvailability(db, convo.data.professionalId, picked.iso);
      const slots = whatsappFriendlySlots(available);
      if (!slots.length) {
        return `Sorry, no times are open with ${convo.data.professionalName} on ${picked.label}. Pick another day:\n\n`
          + options.map((d, i) => `${i + 1}. ${d.label}`).join('\n');
      }
      convo.data.date = picked.iso;
      convo.data.dateLabel = picked.label;
      convo.data.availableSlots = slots;
      convo.step = 'choose_time';
      return `Times open on ${picked.label}:\n\n`
        + slots.map((t, i) => `${i + 1}. ${t}`).join('\n');
    }

    case 'choose_time': {
      const slots = convo.data.availableSlots || [];
      const choice = parseChoice(text, slots.length);
      if (!choice) return `Please reply with a number from 1 to ${slots.length}, or type "menu" to start over.`;
      convo.data.time = slots[choice - 1];
      convo.step = 'enter_name';
      return `Got it — ${convo.data.time} on ${convo.data.dateLabel}. What's your name?`;
    }

    case 'enter_name': {
      if (!text || text.length < 2) return `Please tell me your name to continue.`;
      convo.data.name = text;
      convo.step = 'enter_mobile';
      return `Thanks, ${text}! What's your 10-digit mobile number?`;
    }

    case 'enter_mobile': {
      if (!isValidMobile(text)) return `That doesn't look like a valid 10-digit number — please try again.`;
      convo.data.mobile = text;
      convo.step = 'confirm';
      const d = convo.data;
      return `Please confirm:\n\n`
        + `Service: ${d.serviceName}\n`
        + `With: ${d.professionalName}\n`
        + `When: ${d.dateLabel} at ${d.time}\n`
        + `Name: ${d.name}\n`
        + `Mobile: ${d.mobile}\n\n`
        + `Reply YES to confirm, or NO to cancel.`;
    }

    case 'confirm': {
      if (['yes', 'y', 'confirm'].includes(lower)) {
        const result = createBooking(db, convo.data, 'whatsapp');
        convo.step = 'main_menu';
        convo.data = {};
        if (!result.ok) {
          return `Sorry — ${result.error}\n\n${mainMenuText(db)}`;
        }
        notifyBooking(db, result.booking).catch(err => console.error('Booking notification error:', err.message));

        if (payments.isConfigured() && db.settings.depositEnabled) {
          try {
            const amountPaise = Math.round((db.settings.depositAmount || 50) * 100);
            const link = await payments.createPaymentLink({
              referenceId: result.booking.orderId,
              customerName: result.booking.name,
              customerPhone: result.booking.mobile,
              description: `Deposit for ${result.booking.serviceName}`,
              amountPaise
            });
            const rupees = (amountPaise / 100).toFixed(0);
            return `Booked! ✅ Order ID: ${result.booking.orderId}\n\nTo confirm your slot, please pay a ₹${rupees} deposit here:\n${link.shortUrl}\n\nWe'll see you soon!\n\n${mainMenuText(db)}`;
          } catch (err) {
            console.error('Payment link creation failed:', err.message);
          }
        }
        return `Booked! ✅ Your order ID is ${result.booking.orderId}. We'll see you then!\n\n${mainMenuText(db)}`;
      }
      if (['no', 'n', 'cancel'].includes(lower)) {
        convo.step = 'main_menu';
        convo.data = {};
        return `No problem, cancelled.\n\n${mainMenuText(db)}`;
      }
      return `Please reply YES to confirm or NO to cancel.`;
    }

    default: {
      convo.step = 'main_menu';
      convo.data = {};
      return mainMenuText(db);
    }
  }
}

module.exports = { handleIncomingMessage };
