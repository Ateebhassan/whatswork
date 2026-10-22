/* ---------- WhatsWork bridge: gives the College Planner the same saving, upload and download calls,
   backed by the WhatsWork Supabase project and the same login as WhatsWork. ---------- */
(function () {
  var SUPABASE_URL = 'https://boajcspgqhuhchnvbkxl.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_QbVXMyGif27UZnxhjApFUw_ul7EuoC5';
  var BUCKET = 'planner';
  var parentSb = null;
  try { if (window.parent !== window && window.parent.wwSupabase) parentSb = window.parent.wwSupabase; } catch (e) { }
  /* inside WhatsWork: share its login; opened on its own: same login, read from this browser */
  var sb = parentSb || supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  window.PLANNER_GOOGLE = true;          /* reuse the planner's "files open in a new tab + thumbnails" path */
  window.PLANNER_WHATSWORK = true;

  var uidP = sb.auth.getSession().then(function (r) {
    var s = r && r.data && r.data.session;
    if (!s) throw { code: 'signed_out', message: 'Sign in to WhatsWork first.' };
    return s.user.id;
  });
  /* first visit: move the planner data copied from Google Drive into this account */
  var readyP = uidP.then(function (uid) {
    return sb.rpc('planner_claim_seed').then(function () { return uid; }, function () { return uid; });
  });

  function fail(e) { return { code: (e && e.code) || 'unavailable', message: String((e && e.message) || e || '') }; }
  function nameOf(path) { return path === 'planner/main' ? 'main' : 'track-' + path.split('/')[1]; }

  /* ---------- records ---------- */
  var docs = {}, channel = null;
  function snapOf(d, name) {
    return { id: name, exists: d.json !== null, data: function () { return d.json !== null ? { json: d.json } : undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function deliver(name) {
    var d = docs[name]; if (!d) return;
    d.subs.slice().forEach(function (s) { s.started = true; s.next(snapOf(d, name)); });
  }
  function listen(uid) {
    if (channel) return;
    channel = sb.channel('planner-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planner_docs', filter: 'user_id=eq.' + uid }, function (p) {
        var row = p.new && p.new.name ? p.new : null; if (!row) return;
        var d = docs[row.name]; if (!d || row.v === d.v) return;
        d.v = row.v; d.json = row.json; deliver(row.name);
      }).subscribe();
  }
  function load(name) {
    return readyP.then(function (uid) {
      listen(uid);
      return sb.from('planner_docs').select('json,v').eq('user_id', uid).eq('name', name).maybeSingle().then(function (r) {
        if (r.error) throw r.error;
        var d = docs[name]; d.loaded = true;
        if (r.data) { d.v = r.data.v; d.json = r.data.json; } else { d.v = 0; d.json = null; }
        deliver(name);
      });
    });
  }
  /* catch up when the app comes back to the front (phones pause live updates in the background) */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    Object.keys(docs).forEach(function (n) {
      var d = docs[n]; if (!d.subs.length) return;
      readyP.then(function (uid) {
        sb.from('planner_docs').select('json,v').eq('user_id', uid).eq('name', n).maybeSingle().then(function (r) {
          if (r.data && r.data.v !== d.v) { d.v = r.data.v; d.json = r.data.json; deliver(n); }
        });
      });
    });
  });

  var db = {
    doc: function (path) {
      var n = nameOf(path), d = docs[n] || (docs[n] = { v: -1, json: null, subs: [], loaded: false });
      return {
        id: n, path: path,
        set: function (data) {
          var json = data.json;
          return readyP.then(function () {
            return sb.rpc('planner_save', { p_name: n, p_json: json }).then(function (r) {
              if (r.error) throw fail(r.error);
              d.v = r.data; d.json = json;
            });
          });
        },
        onSnapshot: function (next, onErr) {
          var s = { next: next, started: false };
          d.subs.push(s);
          if (d.loaded) setTimeout(function () { if (!s.started) { s.started = true; next(snapOf(d, n)); } }, 0);
          else if (!d.loading) { d.loading = true; load(n).catch(function (e) { d.loading = false; if (onErr) onErr(fail(e)); showSignIn(e); }); }
          return function () { d.subs = d.subs.filter(function (x) { return x !== s; }); };
        }
      };
    },
    collection: function () {
      return {
        get: function () {
          return readyP.then(function (uid) {
            return sb.from('planner_docs').select('name,json').eq('user_id', uid).like('name', 'track-%').then(function (r) {
              if (r.error) throw fail(r.error);
              return { docs: (r.data || []).map(function (row) { var ym = row.name.slice(6); return { id: ym, data: function () { return { json: row.json }; } }; }) };
            });
          });
        }
      };
    }
  };

  /* ---------- uploaded posts ---------- */
  var thumbs = {};
  function isOurs(id) { return /^sb\//.test(String(id)); }
  var assets = {
    upload: function (file, o) {
      if (file.size > 45 * 1048576) return Promise.reject({ code: 'too_large', message: 'too_large' });
      return uidP.then(function (uid) {
        var safe = String(file.name || 'post').replace(/[^\w.\- ]/g, '_').slice(0, 120);
        var path = uid + '/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '-' + safe;
        var type = (o && o.type) || file.type || 'application/octet-stream';
        return sb.storage.from(BUCKET).upload(path, file, { contentType: type }).then(function (r) {
          if (r.error) throw { code: /size|large/i.test(r.error.message) ? 'too_large' : 'unavailable', message: r.error.message };
          return { id: 'sb/' + path, url: '', sizeBytes: file.size, contentType: type };
        });
      });
    },
    'delete': function (id) {
      delete thumbs[id];
      if (!isOurs(id)) return Promise.resolve({ deleted: false });   /* older posts stay in Google Drive */
      return sb.storage.from(BUCKET).remove([String(id).slice(3)]).then(function (r) { return { deleted: !r.error }; });
    },
    list: function () {
      return uidP.then(function (uid) {
        return sb.storage.from(BUCKET).list(uid, { limit: 1000 }).then(function (r) {
          var files = (r.data || []).filter(function (f) { return f.id; });
          var bytes = files.reduce(function (a, f) { return a + ((f.metadata && f.metadata.size) || 0); }, 0);
          return { assets: [], usage: { files: files.length, bytes: bytes, maxFiles: 0, maxBytes: 1024 * 1048576 }, folderUrl: '' };
        });
      });
    },
    thumb: function (id) {
      if (thumbs[id]) return thumbs[id];
      if (!isOurs(id)) return (thumbs[id] = Promise.resolve('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w400'));
      return (thumbs[id] = sb.storage.from(BUCKET).createSignedUrl(String(id).slice(3), 3600).then(function (r) {
        if (r.error || !r.data) { delete thumbs[id]; return ''; } return r.data.signedUrl;
      }, function () { delete thumbs[id]; return ''; }));
    }
  };
  /* "Open" on a file: our files get a short-lived private link, older ones open in Google Drive */
  window.plannerOpenFile = function (f) {
    if (!f) return;
    if (!isOurs(f.id)) { window.open('https://drive.google.com/file/d/' + encodeURIComponent(f.id) + '/view', '_blank'); return; }
    var w = window.open('', '_blank');
    sb.storage.from(BUCKET).createSignedUrl(String(f.id).slice(3), 600).then(function (r) {
      if (r.data && r.data.signedUrl) { if (w) w.location = r.data.signedUrl; else window.open(r.data.signedUrl, '_blank'); }
      else if (w) w.close();
    });
  };

  /* the next 8 days of posts, read by WhatsWork's background worker for the 9 am and 8 pm notifications */
  window.plannerPublishDigest = function (json) {
    uidP.then(function (uid) {
      var path = uid + '/_meta/upcoming.json', blob = new Blob([json], { type: 'application/json' });
      return sb.storage.from(BUCKET).remove([path]).then(function () {
        return sb.storage.from(BUCKET).upload(path, blob, { contentType: 'application/json' });
      });
    }).catch(function () { });
  };

  var downloads = {
    save: function (req) {
      try {
        var blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = req.filename; document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
        return Promise.resolve({ status: 'saved' });
      } catch (e) { return Promise.reject({ code: 'unavailable', message: String(e) }); }
    }
  };
  var user = { can: function () { return Promise.resolve(true); }, isOwner: function () { return Promise.resolve(true); } };
  var caps = { db: db, assets: assets, downloads: downloads, user: user };
  window.claude = { use: function (name) { return Promise.resolve(caps[name] || null); } };

  function showSignIn(e) {
    if (!e || e.code !== 'signed_out' || document.getElementById('wwSignIn')) return;
    var box = document.createElement('div');
    box.id = 'wwSignIn';
    box.style.cssText = 'position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:var(--bg,#f1f3f7);padding:24px;text-align:center;font-family:var(--ui,system-ui)';
    box.innerHTML = '<div><h2 style="margin:0 0 8px">Sign in to WhatsWork first</h2><p style="margin:0 0 16px;color:var(--muted,#646d7e)">The planner uses your WhatsWork account.</p><a href="./" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#3157e8;color:#fff;text-decoration:none;font-weight:700">Open WhatsWork</a></div>';
    document.body.appendChild(box);
  }
})();
