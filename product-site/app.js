(function () {
  var IMGS = {
    price: 'K2500 車型售價表', package: '雙廂高階套裝',
    equip: '配備升級', android: '12.3 吋安卓四錄旗艦機', audio: '音響升級',
    lights: '燈組升級', tail: 'LED 光環尾燈組', fog: '魚眼霧燈升級', gtr: 'GTR 大燈升級',
    'gtr-cut': '三階切線說明', 'gtr-plus': 'GTR plus 雙切驗車模組',
    aero: '外觀空力套件', paint: '車身改色', wheel: '鋁圈升級',
    chassis: '底盤載重強化', metal: '金屬製研'
  };
  var DEFAULT = [
    { t: '車型與套裝', i: ['price', 'package'] },
    { t: '配備與影音', i: ['equip', 'android', 'audio'] },
    { t: '燈光', i: ['lights', 'tail', 'fog', 'gtr', 'gtr-cut', 'gtr-plus'] },
    { t: '外觀與輪圈', i: ['aero', 'paint', 'wheel'] },
    { t: '底盤與金屬', i: ['chassis', 'metal'] }
  ];
  var KEY = 'kp-cfg';
  // 順序存在一個公開的 GitHub Gist（只放照片順序，不含任何系統資料）。
  // 第一次在後台按「儲存發佈」會自動建立，ID 填進下面這行後客戶端就會讀它。
  var GIST_OWNER = 'leoliaoinfo-cpu';
  var GIST_ID = '';
  var edit = /[?&]edit(=|&|$)/.test(location.search);
  var groups = DEFAULT;

  function $(id) { return document.getElementById(id); }
  function toast(m) { var t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(function () { t.style.display = 'none'; }, 4000); }
  function cfg() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }

  // 清理順序檔：去掉不存在的圖、補上漏掉的圖（放最後一區）
  function normalize(g) {
    var seen = {}, out = [];
    (Array.isArray(g) ? g : []).forEach(function (x) {
      if (!x || typeof x.t !== 'string' || !Array.isArray(x.i)) return;
      var items = x.i.filter(function (k) { if (IMGS[k] && !seen[k]) { seen[k] = 1; return true; } return false; });
      out.push({ t: x.t, i: items });
    });
    if (!out.length) out = JSON.parse(JSON.stringify(DEFAULT)), seen = {}, out.forEach(function (x) { x.i.forEach(function (k) { seen[k] = 1; }); });
    var missing = Object.keys(IMGS).filter(function (k) { return !seen[k]; });
    if (missing.length) out[out.length - 1].i = out[out.length - 1].i.concat(missing);
    return out;
  }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.textContent = html; return e; }

  function render() {
    var root = $('groups'), nav = $('nav');
    root.innerHTML = ''; nav.innerHTML = '';
    groups.forEach(function (g, gi) {
      if (!edit && !g.i.length) return;
      var a = el('a', '', g.t); a.href = '#g' + gi; nav.appendChild(a);
      var sec = el('section'); sec.id = 'g' + gi;
      sec.appendChild(el('h2', '', g.t));
      if (edit) {
        var grid = el('div', 'grid'); grid.setAttribute('data-g', gi);
        g.i.forEach(function (k) {
          var d = el('div', 'it'); d.setAttribute('data-k', k);
          var im = el('img'); im.src = 'img/' + k + '.jpg'; im.alt = IMGS[k];
          d.appendChild(im); d.appendChild(el('b', '', IMGS[k])); grid.appendChild(d);
        });
        sec.appendChild(grid);
        new Sortable(grid, { group: 'p', animation: 150, delay: 150, delayOnTouchOnly: true, ghostClass: 'sortable-ghost' });
      } else {
        g.i.forEach(function (k, n) {
          var f = el('figure'); var im = el('img');
          im.src = 'img/' + k + '.jpg'; im.alt = IMGS[k]; if (gi + n > 1) im.loading = 'lazy';
          im.onclick = function () { var lb = $('lb'); lb.querySelector('img').src = im.src; lb.style.display = 'flex'; };
          f.appendChild(im); sec.appendChild(f);
        });
      }
      root.appendChild(sec);
    });
    if (!edit) { var c = document.createElement('a'); c.href = '#contact'; c.textContent = '聯絡我'; nav.appendChild(c); }
  }

  function collect() {
    var out = [];
    document.querySelectorAll('.grid').forEach(function (grid) {
      var gi = +grid.getAttribute('data-g');
      out.push({ t: groups[gi].t, i: Array.prototype.map.call(grid.children, function (d) { return d.getAttribute('data-k'); }) });
    });
    return out;
  }

  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

  function save() {
    var c = cfg();
    if (!c.token) { openSettings(); return; }
    var btn = $('save'); btn.disabled = true; btn.textContent = '儲存中…';
    var data = collect();
    var content = JSON.stringify({ groups: data }, null, 1);
    var id = GIST_ID || c.gistId || '';
    var h = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    var req = id
      ? fetch('https://api.github.com/gists/' + id, { method: 'PATCH', headers: h, body: JSON.stringify({ files: { 'order.json': { content: content } } }) })
      : fetch('https://api.github.com/gists', { method: 'POST', headers: h, body: JSON.stringify({ description: 'KIA 產品介紹網頁順序', public: true, files: { 'order.json': { content: content } } }) });
    req.then(function (r) {
      if (!r.ok) throw new Error('儲存失敗（' + r.status + '），請確認權杖只勾 gist 且沒過期');
      return r.json();
    }).then(function (g) {
      groups = data;
      if (!id && g && g.id) {
        try { localStorage.setItem(KEY, JSON.stringify({ token: c.token, gistId: g.id })); } catch (e) {}
        window.prompt('第一次儲存完成。請把這串 ID 傳給 Claude，客戶端才會讀到新順序：', g.id);
        toast('已建立。把 ID 傳給 Claude 後即可生效');
      } else {
        toast('已儲存。約 5 分鐘內客戶會看到新順序');
      }
    }).catch(function (e) { toast(e.message || '儲存失敗'); })
      .then(function () { btn.disabled = false; btn.textContent = '儲存發佈'; });
  }

  function openSettings() { var c = cfg(); $('f-token').value = c.token || ''; $('f-gist').textContent = GIST_ID || c.gistId || '（尚未建立，第一次儲存時自動產生）'; $('set').style.display = 'flex'; }

  if (edit) {
    document.body.classList.add('edit');
    $('save').onclick = save;
    $('copy').onclick = function () {
      var txt = JSON.stringify({ groups: collect() });
      var done = function () { toast('已複製順序，貼給 Claude 就會更新'); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, function () { window.prompt('長按全選複製', txt); });
      else window.prompt('長按全選複製', txt);
    };
    $('cfg').onclick = openSettings;
    $('exit').onclick = function () { location.href = location.pathname; };
    $('f-no').onclick = function () { $('set').style.display = 'none'; };
    $('f-ok').onclick = function () {
      var old = cfg();
      try { localStorage.setItem(KEY, JSON.stringify({ token: $('f-token').value.trim(), gistId: old.gistId || '' })); } catch (e) {}
      $('set').style.display = 'none'; toast('設定已存，再按一次「儲存發佈」');
    };
  } else {
    var lb = $('lb');
    lb.onclick = function (e) { if (e.target.tagName !== 'IMG') lb.style.display = 'none'; };
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function loadOrder() {
    var id = GIST_ID || (cfg().gistId || '');
    var t = Date.now();
    var chain = Promise.resolve(null);
    if (id) {
      chain = getJson('https://gist.githubusercontent.com/' + GIST_OWNER + '/' + id + '/raw/order.json?t=' + t)
        .then(function (d) {
          if (d) return d;
          return fetch('https://api.github.com/gists/' + id, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (g) { try { return g && g.files && g.files['order.json'] ? JSON.parse(g.files['order.json'].content) : null; } catch (e) { return null; } })
            .catch(function () { return null; });
        });
    }
    return chain.then(function (d) { return d || getJson('order.json?t=' + t); });
  }

  render();
  loadOrder().then(function (d) { if (d && d.groups) { groups = normalize(d.groups); render(); } });
})();
