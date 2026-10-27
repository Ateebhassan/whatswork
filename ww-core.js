/* WhatsWork core: calendars, events, clashes, the 24-hour split, posts and briefings.
   Shared by the app and the background worker. Needs planner-core.js loaded first.
   All times are wall-clock minutes on the local clock (day number * 1440 + minutes),
   so there is no time-zone maths here: the app and the worker both work in the owner's local time. */
var WWCore = (function () {
  var DAY = 1440;

  var KINDS = {
    sleep: { label: 'Sleep', color: '#6c7bd0' },
    shift: { label: 'Shift', color: '#3157e8' },
    university: { label: 'University', color: '#0e9f6e' },
    work: { label: 'Work', color: '#e0812a' },
    meeting: { label: 'Meeting', color: '#d6336c' },
    call: { label: 'Call', color: '#c2410c' },
    personal: { label: 'Personal', color: '#7c5cff' },
    post: { label: 'Post (all day)', color: '#64748b' }
  };
  /* what wins a minute when two things overlap, for the 24-hour split */
  var PRIORITY = { meeting: 7, call: 7, shift: 6, university: 5, work: 4, personal: 3, other: 2, sleep: 1 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dnum(s) { var p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  function dstr(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function weekday(n) { return new Date(n * 864e5).getUTCDay(); }
  function tmin(t) { if (t == null || t === '') return null; var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function addDays(s, k) { return dstr(dnum(s) + k); }
  function fmtTime(m) {
    m = ((m % DAY) + DAY) % DAY;
    var h = Math.floor(m / 60), mi = m % 60, ap = h < 12 ? 'am' : 'pm', h12 = h % 12 || 12;
    return h12 + (mi ? ':' + pad(mi) : '') + ' ' + ap;
  }
  function fmtDur(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return h && m ? h + 'h ' + m + 'm' : h ? h + 'h' : m + 'm';
  }

  /* ---------- occurrences ---------- */
  /* Every occurrence touching the days from..to (inclusive). An overnight block that starts the
     evening before `from` is included, so a night shift shows on the morning it ends. */
  function occurrences(events, calendars, from, to) {
    var cal = {}; calendars.forEach(function (c) { cal[c.id] = c; });
    var a = dnum(from) - 1, b = dnum(to), out = [];
    events.forEach(function (ev) {
      var c = cal[ev.calendar_id]; if (!c) return;
      var first = dnum(ev.date), until = ev.repeat_until ? dnum(ev.repeat_until) : Infinity;
      var skips = {}; (ev.skip_dates || []).forEach(function (s) { skips[s] = 1; });
      var days = ev.repeat_days && ev.repeat_days.length ? ev.repeat_days : [weekday(first)];
      function push(n) {
        var s = tmin(ev.start_time), e = tmin(ev.end_time), allDay = s == null;
        var st = allDay ? n * DAY : n * DAY + s;
        var en = allDay ? (n + 1) * DAY : n * DAY + (e == null ? s + 60 : (e > s ? e : e + DAY));
        out.push({ key: ev.id + '@' + dstr(n), ev: ev, cal: c, kind: ev.kind || 'other', date: dstr(n), start: st, end: en, allDay: allDay });
      }
      if (!ev.repeat || ev.repeat === 'none') { if (first >= a && first <= b) push(first); return; }
      for (var n = Math.max(a, first); n <= Math.min(b, until); n++) {
        if (skips[dstr(n)]) continue;
        if (ev.repeat === 'weekly' && days.indexOf(weekday(n)) < 0) continue;
        push(n);
      }
    });
    out.sort(function (x, y) { return x.start - y.start || y.end - x.end; });
    return out;
  }
  function timed(occs) { return occs.filter(function (o) { return !o.allDay && o.kind !== 'post'; }); }

  /* ---------- clashes and short sleep ---------- */
  function overlap(a, b) { return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)); }
  /* a meeting inside your own shift on the same calendar is part of the shift, not a clash */
  function partOfShift(a, b) { return a.cal.id === b.cal.id && (a.kind === 'shift' || b.kind === 'shift'); }

  function analyse(occs) {
    var t = timed(occs), clashes = [], shortSleep = [], flagged = {};
    var busy = t.filter(function (o) { return o.kind !== 'sleep'; });
    for (var i = 0; i < busy.length; i++) for (var j = i + 1; j < busy.length; j++) {
      var a = busy[i], b = busy[j];
      if (b.start >= a.end) continue;
      if (overlap(a, b) <= 0 || partOfShift(a, b)) continue;
      clashes.push({ a: a, b: b, start: Math.max(a.start, b.start), end: Math.min(a.end, b.end), date: dstr(Math.floor(Math.max(a.start, b.start) / DAY)) });
      flagged[a.key] = flagged[b.key] = 1;
    }
    t.filter(function (o) { return o.kind === 'sleep'; }).forEach(function (s) {
      var cut = [], lost = minutesCovered(busy.map(function (o) {
        var lo = Math.max(o.start, s.start), hi = Math.min(o.end, s.end);
        if (hi > lo) cut.push(o);
        return [lo, hi];
      }).filter(function (r) { return r[1] > r[0]; }));
      var left = (s.end - s.start) - lost;
      if (lost > 0 && left < 360) { shortSleep.push({ sleep: s, left: left, by: cut, date: s.date }); flagged[s.key] = 1; }
    });
    return { clashes: clashes, shortSleep: shortSleep, flagged: flagged };
  }
  function minutesCovered(ranges) {
    ranges.sort(function (x, y) { return x[0] - y[0]; });
    var total = 0, cs = -1, ce = -1;
    ranges.forEach(function (r) {
      if (r[0] > ce) { if (ce > cs) total += ce - cs; cs = r[0]; ce = r[1]; } else if (r[1] > ce) ce = r[1];
    });
    if (ce > cs) total += ce - cs;
    return total;
  }

  /* ---------- the 24-hour split for one day ---------- */
  function groupOf(o) {
    if (o.kind === 'sleep') return { id: 'sleep', label: 'Sleep', color: KINDS.sleep.color };
    if (o.kind === 'shift') return { id: 'shift', label: 'Shift', color: o.cal.color };
    if (o.kind === 'university') return { id: 'university', label: 'University', color: KINDS.university.color };
    if (o.kind === 'meeting' || o.kind === 'call') return { id: 'meetings', label: 'Meetings and calls', color: KINDS.meeting.color };
    return { id: 'cal:' + o.cal.id, label: o.cal.name, color: o.cal.color };
  }
  /* Minute by minute: each minute goes to the most important thing happening then; the rest is free. */
  function daySplit(date, occs) {
    var d0 = dnum(date) * DAY, slots = new Array(DAY), pr = new Array(DAY);
    timed(occs).forEach(function (o) {
      var lo = Math.max(o.start, d0) - d0, hi = Math.min(o.end, d0 + DAY) - d0, p = PRIORITY[o.kind] || 2;
      for (var m = lo; m < hi; m++) if (!slots[m] || p > pr[m]) { slots[m] = o; pr[m] = p; }
    });
    var groups = {}, byCal = {}, order = [];
    for (var m = 0; m < DAY; m++) {
      var o = slots[m], g = o ? groupOf(o) : { id: 'free', label: 'Free', color: '' };
      if (!groups[g.id]) { groups[g.id] = { id: g.id, label: g.label, color: g.color, minutes: 0 }; order.push(g.id); }
      groups[g.id].minutes++;
      if (o && o.kind !== 'sleep') byCal[o.cal.id] = (byCal[o.cal.id] || 0) + 1;
    }
    var list = order.map(function (k) { return groups[k]; }).sort(function (x, y) {
      if (x.id === 'free') return 1; if (y.id === 'free') return -1; return y.minutes - x.minutes;
    });
    /* the bar in time order: consecutive runs of the same group */
    var runs = [], cur = null;
    for (m = 0; m < DAY; m++) {
      var gid = slots[m] ? groupOf(slots[m]).id : 'free';
      if (cur && cur.id === gid) cur.len++; else { cur = { id: gid, start: m, len: 1, color: groups[gid].color, label: groups[gid].label }; runs.push(cur); }
    }
    return { groups: list, byCal: byCal, runs: runs };
  }

  /* ---------- posts ---------- */
  var _worldCache = {}, _plannerCacheKey = '';
  /* Built-in days only (no college edits, birthdays or own events), for calendars that follow world days. */
  function builtinItemsOn(date) {
    var saved = _yearCache; _yearCache = _worldCache;
    var list = buildYear(+date.slice(0, 4), defaultState())[date] || [];
    _worldCache = _yearCache; _yearCache = saved;
    return list;
  }
  function trackOf(tracks, key, date) { var m = tracks && tracks[date.slice(0, 7)]; return (m && m[key]) || {}; }
  function statusFrom(tr) { return { sent: !!tr.q || !!tr.sent, made: !!tr.m || !!tr.made, scheduled: !!tr.s || !!tr.scheduled, skip: !!tr.skip }; }

  /* ctx = { planner: normalised planner state or null, tracks: {'YYYY-MM': map}, calendars, postStatus: {calId: {key: row}}, occs } */
  function postsOn(date, ctx) {
    var out = [];
    ctx.calendars.forEach(function (c) {
      if (c.archived) return;
      if (c.kind === 'planner' && ctx.planner && c.planner_college) {
        itemsOn(date, ctx.planner, c.planner_college, null).forEach(function (it) {
          var key = it.id + '@' + date;
          out.push({ cal: c, key: key, source: 'planner', title: it.title, cat: it.cat, status: statusFrom(trackOf(ctx.tracks, key, date)), shared: it.college === 'both' });
        });
      }
      if (c.follows_world_days) {
        var cats = c.world_cats && c.world_cats.length ? c.world_cats : ['world'];
        builtinItemsOn(date).forEach(function (it) {
          if (it.weekly || cats.indexOf(it.cat) < 0) return;
          var key = 'w:' + it.id + '@' + date, st = statusFrom(((ctx.postStatus || {})[c.id] || {})[key] || {});
          if (st.skip) return;
          out.push({ cal: c, key: key, source: 'world', title: it.title, cat: it.cat, status: st });
        });
      }
    });
    (ctx.occs || []).forEach(function (o) {
      if (o.kind !== 'post' || o.date !== date) return;
      var key = 'e:' + o.ev.id + '@' + date;
      out.push({ cal: o.cal, key: key, source: 'event', title: o.ev.title, cat: 'post', status: statusFrom(((ctx.postStatus || {})[o.cal.id] || {})[key] || {}), occ: o });
    });
    return out;
  }
  function statusText(st) { return st.scheduled ? 'scheduled' : st.made ? 'made, not scheduled' : st.sent ? 'with designer' : 'not started'; }
  /* The same post on two calendars with the same status reads as one line. */
  function mergePosts(posts) {
    var lines = [], by = {};
    posts.forEach(function (p) {
      var k = p.title + '|' + statusText(p.status);
      if (by[k]) { by[k].cals.push(p.cal); return; }
      by[k] = { title: p.title, status: p.status, cals: [p.cal] }; lines.push(by[k]);
    });
    return lines;
  }

  /* ---------- briefings ---------- */
  function shortName(c) { return c.short_name || c.name; }
  /* slot 'am' = the morning check for today, 'pm' = the evening heads-up for tomorrow */
  function briefing(date, slot, ctx) {
    var posts = postsOn(date, ctx), lines = mergePosts(posts), body = [];
    var notReady = posts.filter(function (p) { return !p.status.scheduled; }).length;
    lines.forEach(function (l) {
      body.push((l.status.scheduled ? '✅ ' : '📌 ') + l.title + ' (' + l.cals.map(shortName).join(', ') + '): ' + statusText(l.status));
    });
    var dayOccs = timed(ctx.occs || []).filter(function (o) { return o.date === date; });
    var events = dayOccs.filter(function (o) { return o.kind === 'meeting' || o.kind === 'call' || (!o.ev.repeat || o.ev.repeat === 'none') && o.kind !== 'sleep'; });
    events.forEach(function (o) { body.push('🕑 ' + fmtTime(o.start) + ' ' + o.ev.title + ' (' + shortName(o.cal) + ')'); });
    var an = analyse(ctx.occs || []);
    an.clashes.filter(function (c) { return c.date === date; }).forEach(function (c) {
      body.push('⚠️ Clash at ' + fmtTime(c.start) + ': ' + c.a.ev.title + ' and ' + c.b.ev.title);
    });
    an.shortSleep.filter(function (s) { return s.date === date; }).forEach(function (s) {
      body.push('😴 Sleep cut to ' + fmtDur(Math.max(0, s.left)) + ' by ' + s.by.map(function (o) { return o.ev.title; }).join(', '));
    });
    if (!body.length) return null;
    var when = slot === 'am' ? 'Today' : 'Tomorrow';
    var title = posts.length
      ? (slot === 'am' ? '📅 ' : '🌙 ') + when + ': ' + posts.length + ' post' + (posts.length > 1 ? 's' : '') + (notReady ? ', ' + notReady + ' not scheduled' : ', all scheduled')
      : (slot === 'am' ? '📅 ' : '🌙 ') + when + ': ' + (events.length ? events.length + ' thing' + (events.length > 1 ? 's' : '') + ' planned' : 'check your day');
    var shown = body.slice(0, 8);
    if (body.length > 8) shown.push('+' + (body.length - 8) + ' more in the app');
    return { title: title, body: shown.join('\n'), posts: posts.length, notReady: notReady };
  }

  /* ---------- hours per calendar for a week (Monday to Sunday) ---------- */
  function weekHours(monday, occs) {
    var byCal = {}, total = 0;
    for (var i = 0; i < 7; i++) {
      var sp = daySplit(addDays(monday, i), occs);
      for (var k in sp.byCal) { byCal[k] = (byCal[k] || 0) + sp.byCal[k]; total += sp.byCal[k]; }
    }
    return { byCal: byCal, total: total };
  }
  function billingTotals(hours, calendars) {
    var out = { paid: 0, unpaid: 0, personal: 0 };
    calendars.forEach(function (c) { var m = hours.byCal[c.id] || 0; out[c.billing || 'paid'] = (out[c.billing || 'paid'] || 0) + m; });
    return out;
  }

  /* ---------- quick add without AI: "meeting with Sam Thursday 11pm" ---------- */
  var WD = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
  var MO = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  var KIND_WORDS = [
    ['call', /\b(call|calls|phone|zoom|whatsapp call|video call)\b/],
    ['meeting', /\b(meeting|meet|meetup|interview|discussion|sync)\b/],
    ['university', /\b(class|classes|lecture|uni|university|exam|presentation|viva|quiz)\b/],
    ['post', /\b(post|upload|publish)\b/],
    ['shift', /\bshift\b/],
    ['sleep', /\b(sleep|nap)\b/],
    ['work', /\b(shoot|edit|editing|design|ad|ads|reel|reels|video|work|deadline|draft|script)\b/]
  ];
  function parseQuick(text, calendars, today, nowMinutes) {
    var raw = String(text || '').trim(), t = ' ' + raw.toLowerCase().replace(/[,.!?]/g, ' ') + ' ';
    var cut = [];   /* bits of the text that were dates or times, removed from the title */
    function take(re) { var m = t.match(re); if (m) { cut.push(m[0]); t = t.replace(m[0], ' '); } return m; }
    var out = { title: raw, date: today, start_time: null, end_time: null, kind: null, calendar_id: null, repeat: 'none', repeat_days: [], guessed: [] };
    var tn = dnum(today), m;
    /* repeats */
    if ((m = take(/\b(every ?day|daily)\b/))) out.repeat = 'daily';
    else if ((m = take(/\bevery ((?:(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*(?:\s*(?:and|&|\s)\s*)?)+)/))) {
      out.repeat = 'weekly';
      m[1].split(/\s*(?:and|&|\s)\s*/).forEach(function (w) { if (WD[w] !== undefined && out.repeat_days.indexOf(WD[w]) < 0) out.repeat_days.push(WD[w]); });
    }
    /* dates */
    if (take(/\bday after tomorrow\b/)) out.date = dstr(tn + 2);
    else if (take(/\b(tomorrow|tmrw|tmr)\b/)) out.date = dstr(tn + 1);
    else if (take(/\b(today|tonight)\b/)) out.date = today;
    else if ((m = take(/\b(next )?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/))) {
      /* "Thursday" and "next Thursday" both mean the coming one; said on a Thursday, "next" means a week later */
      var want = WD[m[2]], diff = (want - weekday(tn) + 7) % 7;
      if (m[1] && diff === 0) diff = 7;
      out.date = dstr(tn + diff);
      if (out.repeat === 'weekly' && !out.repeat_days.length) out.repeat_days = [want];
    } else if ((m = take(/\b(\d{1,2})(?:st|nd|rd|th)? (jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/)) ||
               (m = take(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december) (\d{1,2})(?:st|nd|rd|th)?\b/))) {
      var dd = /\d/.test(m[1]) ? +m[1] : +m[2], mm = MO[/\d/.test(m[1]) ? m[2] : m[1]], yy = +today.slice(0, 4);
      var cand = dnum(yy + '-' + pad(mm) + '-' + pad(dd)); if (cand < tn) cand = dnum((yy + 1) + '-' + pad(mm) + '-' + pad(dd));
      out.date = dstr(cand);
    } else if ((m = take(/\b(\d{1,2})\/(\d{1,2})\b/))) {
      var y2 = +today.slice(0, 4), c2 = dnum(y2 + '-' + pad(+m[2]) + '-' + pad(+m[1])); if (c2 < tn) c2 = dnum((y2 + 1) + '-' + pad(+m[2]) + '-' + pad(+m[1]));
      out.date = dstr(c2);
    }
    /* times */
    var night = /\b(night|tonight|evening)\b/.test(t), morning = /\b(morning|am)\b/.test(t);
    function hhmm(h, mi, mer, other) {
      h = +h; mi = +(mi || 0);
      if (mer === 'pm' && h < 12) h += 12;
      else if (mer === 'am' && h === 12) h = 0;
      else if (!mer) {
        if (other === 'pm' && h < 12) h += 12;
        else if (other !== 'am' && !morning && (night || (h >= 1 && h <= 7))) { if (h < 12) h += 12; out.guessed.push('pm'); }
      }
      return h * 60 + mi;
    }
    var range = take(/\b(?:from )?(\d{1,2})(?::(\d{2}))? ?(am|pm)? ?(?:-|–|to|till|until) ?(\d{1,2})(?::(\d{2}))? ?(am|pm)?\b/);
    if (range) {
      var s = hhmm(range[1], range[2], range[3], range[6]), e = hhmm(range[4], range[5], range[6], range[3]);
      out.start_time = hm(s); out.end_time = hm(e);
    } else {
      var one = take(/\b(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)\b/) || take(/\bat (\d{1,2})(?::(\d{2}))?\b/) || take(/\b(\d{1,2}):(\d{2})\b/);
      if (take(/\bnoon\b/)) out.start_time = '12:00';
      else if (take(/\bmidnight\b/)) out.start_time = '00:00';
      else if (one) out.start_time = hm(hhmm(one[1], one[2], one[3]));
    }
    /* kind and calendar */
    for (var k = 0; k < KIND_WORDS.length; k++) if (KIND_WORDS[k][1].test(' ' + raw.toLowerCase() + ' ')) { out.kind = KIND_WORDS[k][0]; break; }
    var defaultKind = !out.kind;
    if (!out.kind) out.kind = /\bwith\b/.test(raw.toLowerCase()) ? 'meeting' : 'work';
    var low = ' ' + raw.toLowerCase() + ' ';
    var best = null;
    (calendars || []).forEach(function (c) {
      var names = [c.name, c.short_name].concat(c.kind === 'planner' && c.planner_college === 'law' ? ['ailc', 'law college', 'allama iqbal'] : [])
        .concat(/chamber/i.test(c.name) ? ['chamber', 'lawyer'] : []).concat(/tariq/i.test(c.name) ? ['tariq', 'studio'] : []);
      names.forEach(function (n) {
        if (!n) return; n = String(n).toLowerCase().replace(/'s\b/, '');
        var w = n.split(/\s+/)[0];
        if (low.indexOf(' ' + n) >= 0 || (w.length > 3 && low.indexOf(' ' + w) >= 0)) if (!best || n.length > best.len) best = { id: c.id, len: n.length };
      });
    });
    if (best) out.calendar_id = best.id;
    else if (defaultKind && out.kind === 'work') out.kind = 'personal';
    if (!out.calendar_id && (out.kind === 'university' || out.kind === 'sleep' || out.kind === 'personal')) { var per = (calendars || []).filter(function (c) { return c.billing === 'personal'; })[0]; if (per) out.calendar_id = per.id; }
    /* end time and all-day */
    if (out.kind === 'post') { out.start_time = null; out.end_time = null; }
    else if (out.start_time && !out.end_time) {
      var dur = take(/\bfor (\d+(?:\.\d+)?) ?(hours?|hrs?|h|minutes?|mins?|m)\b/), mins = out.kind === 'call' ? 30 : 60;
      if (dur) mins = /^m/.test(dur[2]) ? Math.round(+dur[1]) : Math.round(+dur[1] * 60);
      out.end_time = hm((tmin(out.start_time) + mins) % DAY);
    } else if (!out.start_time) {
      var st = nowMinutes != null ? (Math.floor(nowMinutes / 30) + 1) * 30 : 9 * 60;
      out.start_time = hm(st % DAY); out.end_time = hm((st + 60) % DAY); out.guessed.push('time');
    }
    /* title: what's left once dates and times are taken out */
    var title = raw;
    cut.forEach(function (c) { var re = new RegExp(c.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); title = title.replace(re, ' '); });
    title = title.replace(/\b(on|at|from|for|by)\s*$/i, '').replace(/\s+(on|at|by)\s+(?=\s|$)/gi, ' ').replace(/\s{2,}/g, ' ').trim().replace(/[,\-–]+$/, '').trim();
    out.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : raw;
    return out;
  }
  function hm(m) { m = ((m % DAY) + DAY) % DAY; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  /* calendars to use when none are set up yet: the two college calendars from the planner */
  function fallbackCalendars() {
    return [
      { id: 'planner-superior', name: 'Superior College', short_name: 'Superior', color: '#0b8a84', kind: 'planner', planner_college: 'superior' },
      { id: 'planner-law', name: 'Allama Iqbal Law College', short_name: 'AILC', color: '#8c1d2f', kind: 'planner', planner_college: 'law' }
    ];
  }

  return {
    DAY: DAY, KINDS: KINDS, dnum: dnum, dstr: dstr, weekday: weekday, tmin: tmin, addDays: addDays, fmtTime: fmtTime, fmtDur: fmtDur,
    occurrences: occurrences, timed: timed, analyse: analyse, daySplit: daySplit, overlap: overlap,
    postsOn: postsOn, statusText: statusText, mergePosts: mergePosts, briefing: briefing, fallbackCalendars: fallbackCalendars,
    weekHours: weekHours, billingTotals: billingTotals, parseQuick: parseQuick, hm: hm,
    resetPlannerCache: function () { clearCache(); }
  };
})();
