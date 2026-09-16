// Free, AI-free WhatsApp bot: customers navigate a numbered menu instead of
// free-form chat. Uses the same booking-logic.js as the website, so a slot
// booked here can never clash with one booked on the site or in admin.
//
// Multilingual: every piece of text the bot sends lives in
// db.settings.botMessages[lang][key], editable from the admin panel.
// handleIncomingMessage() can return either a plain string (normal text
// reply) or an object { type: 'buttons', body, buttons } for the language
// picker — server.js's webhook handler checks which one it got and sends
// the right kind of WhatsApp message.
const { getAvailability, createBooking, isValidMobile } = require('./booking-logic');
const { notifyBooking } = require('./whatsapp-client');
const payments = require('./payments');
const DEFAULT_BOT_MESSAGES = require('./bot-messages-defaults');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const LANGUAGE_BUTTONS = [
  { id: 'lang_en', title: 'English' },
  { id: 'lang_ta', title: 'தமிழ்' },
  { id: 'lang_hi', title: 'हिन्दी' }
];
const LANGUAGE_CODES = { lang_en: 'en', lang_ta: 'ta', lang_hi: 'hi' };

function freshState() {
  return { step: 'main_menu', lang: null, data: {} };
}

// Looks up a message template for the given language, falling back to
// English, then the built-in defaults, so a missing/blank admin edit never
// breaks the bot. Fills in {placeholders} with the given values.
function t(db, lang, key, vars) {
  const messages = db.settings.botMessages || {};
  const template =
    (messages[lang] && messages[lang][key]) ||
    (messages.en && messages.en[key]) ||
    (DEFAULT_BOT_MESSAGES[lang] && DEFAULT_BOT_MESSAGES[lang][key]) ||
    DEFAULT_BOT_MESSAGES.en[key] ||
    '';
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? vars[name] : ''));
}

function mainMenuText(db, lang) {
  return t(db, lang, 'welcome', { salonName: db.settings.salonName });
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
 * either a plain string (text reply) or { type: 'buttons', body, buttons }.
 * Caller is responsible for calling writeDB(db) after, and for sending the
 * right kind of message based on the return type.
 */
async function handleIncomingMessage(db, phone, incomingText) {
  if (!db.conversations) db.conversations = {};
  if (!db.conversations[phone]) db.conversations[phone] = freshState();
  const convo = db.conversations[phone];
  if (convo.lang === undefined) convo.lang = null; // backward-compat for older saved conversations
  const text = (incomingText || '').trim();
  const lower = text.toLowerCase();

  // Language not chosen yet — handle the button tap, or (re)send the picker.
  if (!convo.lang) {
    if (LANGUAGE_CODES[text]) {
      convo.lang = LANGUAGE_CODES[text];
      convo.step = 'main_menu';
      convo.data = {};
      return mainMenuText(db, convo.lang);
    }
    return { type: 'buttons', body: t(db, 'en', 'chooseLanguageBody'), buttons: LANGUAGE_BUTTONS };
  }
  const lang = convo.lang;

  // Let the customer switch language anytime.
  if (['language', 'lang', 'மொழி', 'भाषा'].includes(lower)) {
    convo.lang = null;
    convo.step = 'main_menu';
    convo.data = {};
    return { type: 'buttons', body: t(db, 'en', 'chooseLanguageBody'), buttons: LANGUAGE_BUTTONS };
  }

  // Global reset command, works from any step.
  if (['menu', 'cancel', 'restart', 'hi', 'hello', 'hey'].includes(lower)) {
    convo.step = 'main_menu';
    convo.data = {};
    return mainMenuText(db, lang);
  }

  switch (convo.step) {
    case 'main_menu': {
      const choice = parseChoice(text, 4);
      if (choice === 1) {
        convo.step = 'choose_professional';
        convo.data = {};
        const list = professionalList(db);
        return t(db, lang, 'chooseProfessional')
          + list.map((p, i) => `${i + 1}. ${p.name}${p.role ? ' — ' + p.role : ''}`).join('\n');
      }
      if (choice === 2) {
        if (!db.services.length) return t(db, lang, 'noServicesYet') + mainMenuText(db, lang);
        const list = db.services.map(s => `• ${s.name} (${s.duration}) — ${s.price}`).join('\n');
        return t(db, lang, 'servicesListIntro') + list + '\n\n' + mainMenuText(db, lang);
      }
      if (choice === 3) {
        const s = db.settings;
        return t(db, lang, 'hoursLocationReply', { address: s.address, hours: s.hours, phone: s.phoneDisplay || s.phone })
          + mainMenuText(db, lang);
      }
      if (choice === 4) {
        const s = db.settings;
        return t(db, lang, 'staffReply', { phone: s.phoneDisplay || s.phone }) + mainMenuText(db, lang);
      }
      return t(db, lang, 'didntCatch') + mainMenuText(db, lang);
    }

    case 'choose_professional': {
      const list = professionalList(db);
      const choice = parseChoice(text, list.length);
      if (!choice) return t(db, lang, 'pleaseReplyNumber', { max: list.length });
      const p = list[choice - 1];
      convo.data.professionalId = p.id;
      convo.data.professionalName = p.name;
      convo.step = 'choose_service';
      if (!db.services.length) {
        convo.step = 'main_menu';
        return t(db, lang, 'noServicesSetup') + mainMenuText(db, lang);
      }
      return t(db, lang, 'chooseService', { professionalName: p.name })
        + db.services.map((s, i) => `${i + 1}. ${s.name} (${s.duration}) — ${s.price}`).join('\n');
    }

    case 'choose_service': {
      const choice = parseChoice(text, db.services.length);
      if (!choice) return t(db, lang, 'pleaseReplyNumber', { max: db.services.length });
      const svc = db.services[choice - 1];
      convo.data.serviceId = svc.id;
      convo.data.serviceName = svc.name;
      convo.data.serviceDuration = svc.duration;
      convo.data.servicePrice = svc.price;
      convo.step = 'choose_date';
      convo.data.dateOptions = buildDateOptions();
      return t(db, lang, 'chooseDate')
        + convo.data.dateOptions.map((d, i) => `${i + 1}. ${d.label}`).join('\n');
    }

    case 'choose_date': {
      const options = convo.data.dateOptions || buildDateOptions();
      const choice = parseChoice(text, options.length);
      if (!choice) return t(db, lang, 'pleaseReplyNumber', { max: options.length });
      const picked = options[choice - 1];
      const { available } = getAvailability(db, convo.data.professionalId, picked.iso);
      const slots = whatsappFriendlySlots(available);
      if (!slots.length) {
        return t(db, lang, 'noSlotsOnDate', { professionalName: convo.data.professionalName, dateLabel: picked.label })
          + options.map((d, i) => `${i + 1}. ${d.label}`).join('\n');
      }
      convo.data.date = picked.iso;
      convo.data.dateLabel = picked.label;
      convo.data.availableSlots = slots;
      convo.step = 'choose_time';
      return t(db, lang, 'chooseTime', { dateLabel: picked.label })
        + slots.map((tm, i) => `${i + 1}. ${tm}`).join('\n');
    }

    case 'choose_time': {
      const slots = convo.data.availableSlots || [];
      const choice = parseChoice(text, slots.length);
      if (!choice) return t(db, lang, 'pleaseReplyNumber', { max: slots.length });
      convo.data.time = slots[choice - 1];
      convo.step = 'enter_name';
      return t(db, lang, 'askName', { time: convo.data.time, dateLabel: convo.data.dateLabel });
    }

    case 'enter_name': {
      if (!text || text.length < 2) return t(db, lang, 'askNameRetry');
      convo.data.name = text;
      convo.step = 'enter_mobile';
      return t(db, lang, 'askMobile', { name: text });
    }

    case 'enter_mobile': {
      if (!isValidMobile(text)) return t(db, lang, 'invalidMobile');
      convo.data.mobile = text;
      convo.step = 'confirm';
      const d = convo.data;
      return t(db, lang, 'confirmSummary', {
        serviceName: d.serviceName, professionalName: d.professionalName,
        dateLabel: d.dateLabel, time: d.time, name: d.name, mobile: d.mobile
      });
    }

    case 'confirm': {
      if (['yes', 'y', 'confirm'].includes(lower)) {
        const result = createBooking(db, convo.data, 'whatsapp');
        convo.step = 'main_menu';
        convo.data = {};
        if (!result.ok) {
          return t(db, lang, 'bookingFailed', { error: result.error }) + mainMenuText(db, lang);
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
            return t(db, lang, 'bookingSuccessWithDeposit', { orderId: result.booking.orderId, amount: rupees, link: link.shortUrl })
              + mainMenuText(db, lang);
          } catch (err) {
            console.error('Payment link creation failed:', err.message);
          }
        }
        return t(db, lang, 'bookingSuccess', { orderId: result.booking.orderId }) + mainMenuText(db, lang);
      }
      if (['no', 'n', 'cancel'].includes(lower)) {
        convo.step = 'main_menu';
        convo.data = {};
        return t(db, lang, 'bookingCancelled') + mainMenuText(db, lang);
      }
      return t(db, lang, 'confirmYesNoPrompt');
    }

    default: {
      convo.step = 'main_menu';
      convo.data = {};
      return mainMenuText(db, lang);
    }
  }
}

module.exports = { handleIncomingMessage };
