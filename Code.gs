/**
 * Scheduling form -> Google Calendar
 * Paste into a Google Apps Script project (script.google.com).
 * Edit CONFIG below, then Deploy > New deployment > Web app.
 */
const CONFIG = {
  BUSINESS_NAME: 'My Business',
  CALENDAR_ID: 'primary',          // 'primary' = your main calendar, or paste a calendar ID
  OPEN_HOUR: 9,                    // 9:00 AM
  CLOSE_HOUR: 17,                  // 5:00 PM
  WORK_DAYS: [1, 2, 3, 4, 5],      // 0=Sun ... 6=Sat
  SLOT_STEP_MIN: 30,               // start times every 30 min
  MIN_NOTICE_HOURS: 12,            // no same-hour bookings
  MAX_DAYS_AHEAD: 60,
  INVITE_CLIENT: true,             // client gets a Google Calendar invite by email
  SERVICES: [
    { name: 'Consultation', minutes: 30 },
    { name: 'Project Meeting', minutes: 60 },
    { name: 'Website Review', minutes: 45 }
  ]
};

function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.cfg = JSON.stringify({
    businessName: CONFIG.BUSINESS_NAME,
    services: CONFIG.SERVICES,
    workDays: CONFIG.WORK_DAYS,
    maxDaysAhead: CONFIG.MAX_DAYS_AHEAD
  });
  return t.evaluate()
    .setTitle(CONFIG.BUSINESS_NAME + ' – Book an Appointment')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // allows embedding in your site
}

function cal_() {
  return CONFIG.CALENDAR_ID === 'primary'
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
}

function service_(name) {
  const s = CONFIG.SERVICES.find(x => x.name === name);
  if (!s) throw new Error('Unknown service');
  return s;
}

function dayBounds_(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { start: new Date(y, m - 1, d, 0, 0), end: new Date(y, m - 1, d, 23, 59), y, m, d };
}

function isFree_(events, start, end) {
  return !events.some(e => !e.isAllDayEvent() &&
    e.getStartTime() < end && e.getEndTime() > start);
}

/** Called from the form: returns open start times for a date + service. */
function getAvailableSlots(dateStr, serviceName) {
  const svc = service_(serviceName);
  const b = dayBounds_(dateStr);
  if (!CONFIG.WORK_DAYS.includes(b.start.getDay())) return [];

  const events = cal_().getEvents(b.start, b.end);
  const earliest = new Date(Date.now() + CONFIG.MIN_NOTICE_HOURS * 3600e3);
  const tz = Session.getScriptTimeZone();
  const slots = [];

  for (let mins = CONFIG.OPEN_HOUR * 60; mins + svc.minutes <= CONFIG.CLOSE_HOUR * 60; mins += CONFIG.SLOT_STEP_MIN) {
    const start = new Date(b.y, b.m - 1, b.d, 0, mins);
    const end = new Date(start.getTime() + svc.minutes * 60e3);
    if (start < earliest) continue;
    if (isFree_(events, start, end)) {
      slots.push({ iso: start.toISOString(), label: Utilities.formatDate(start, tz, 'h:mm a') });
    }
  }
  return slots;
}

/** Called from the form: validates, re-checks availability, creates the event. */
function submitBooking(f) {
  const required = ['name', 'email', 'phone', 'service', 'slot'];
  required.forEach(k => { if (!f[k] || !String(f[k]).trim()) throw new Error('Missing field: ' + k); });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw new Error('Invalid email');

  const svc = service_(f.service);
  const start = new Date(f.slot);
  const end = new Date(start.getTime() + svc.minutes * 60e3);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000); // prevents two people grabbing the same slot
  try {
    const cal = cal_();
    if (!isFree_(cal.getEvents(start, end), start, end)) {
      throw new Error('That time was just taken. Please pick another slot.');
    }
    const description = [
      'Service: ' + svc.name + ' (' + svc.minutes + ' min)',
      'Name: ' + f.name,
      'Email: ' + f.email,
      'Phone: ' + f.phone,
      f.company ? 'Company: ' + f.company : '',
      f.notes ? '\nNotes:\n' + f.notes : '',
      '\nBooked via online form'
    ].filter(Boolean).join('\n');

    const opts = { description };
    if (CONFIG.INVITE_CLIENT) { opts.guests = f.email; opts.sendInvites = true; }

    cal.createEvent(svc.name + ' – ' + f.name, start, end, opts);
  } finally {
    lock.releaseLock();
  }

  const tz = Session.getScriptTimeZone();
  return { when: Utilities.formatDate(start, tz, "EEEE, MMMM d 'at' h:mm a") };
}
