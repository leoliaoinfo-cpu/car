(function () {
  var IMGS = {
    price: 'K2500 車型售價表', package: '雙廂高階套裝',
    equip: '配備升級', android: '12.3 吋安卓四錄旗艦機', audio: '音響升級',
    lights: '燈組升級', tail: 'LED 光環尾燈組', fog: '魚眼霧燈升級', gtr: 'GTR 大燈升級',
    'gtr-cut': '三階切線說明', 'gtr-plus': 'GTR plus 雙切驗車模組',
    aero: '外觀空力套件', paint: '車身改色', wheel: '鋁圈升級',
    chassis: '底盤載重強化', metal: '金屬製研',
    boss: 'BOSS 白鐵擋泥板', dr: 'DR 漫反射後防撞桿',
    cabin1: '車室細節升級', guard: '防護收納配件', extlight: '外觀燈飾與警示', comfort: '車室舒適升級',
    peri1: '實用周邊升級', func: '車室機能配件', cabin2: '車室實用配件', peri2: '周邊機能配件',
    gps: '4G GPS 車輛定位器', 'gps-app': '智慧定位五大核心功能'
  };
  // 原圖尺寸（先佔好版面，載入時畫面不會跳動）
  var SIZE = {
    price: [1024, 1535], package: [1080, 1438], equip: [1080, 1440], android: [1024, 1536], audio: [1060, 1484],
    lights: [1060, 1484], tail: [1050, 1498], fog: [1080, 1440], gtr: [1071, 1469], 'gtr-cut': [1080, 1451],
    'gtr-plus': [1080, 1482], aero: [1080, 1350], paint: [1080, 1350], wheel: [1080, 1441], chassis: [1080, 1350], metal: [1080, 1440],
    boss: [1080, 1528], dr: [1080, 1528],
    cabin1: [1122, 1402], guard: [1122, 1402], extlight: [1122, 1402], comfort: [1122, 1402], peri1: [1122, 1402],
    func: [1122, 1402], cabin2: [1122, 1402], peri2: [1122, 1402], 'gps-app': [1414, 2000], gps: [1055, 1491]
  };
  var DEFAULT = [
    { t: '車型與套裝', i: ['price', 'equip', 'lights', 'package'] },
    { t: '外觀與輪圈', i: ['paint', 'aero', 'wheel'] },
    { t: '底盤與金屬', i: ['chassis', 'metal', 'boss', 'dr', 'guard'] },
    { t: '配備與影音', i: ['android', 'audio', 'gps', 'gps-app'] },
    { t: '燈光', i: ['tail', 'fog', 'gtr', 'gtr-cut', 'gtr-plus', 'extlight'] },
    { t: '車室與周邊', i: ['cabin1', 'comfort', 'peri1', 'func', 'cabin2', 'peri2'] }
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

  var NAV_ICON = {};
  var order = []; // 放大瀏覽用：目前畫面上圖片順序

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function render() {
    var root = $('groups'), nav = $('nav');
    var vb = $('veh'); if (vb && vb.parentNode !== root.parentNode) root.parentNode.insertBefore(vb, root); // 先放回原位，免得被清掉
    root.innerHTML = ''; nav.innerHTML = ''; order = [];
    var shown = 0;
    groups.forEach(function (g, gi) {
      if (!edit && !g.i.length) return;
      shown++;
      var sec = el('section'); sec.id = 'g' + gi;
      if (edit) {
        sec.appendChild(el('h2', '', g.t));
        var grid = el('div', 'grid'); grid.setAttribute('data-g', gi);
        g.i.forEach(function (k) {
          var d = el('div', 'it'); d.setAttribute('data-k', k);
          var im = el('img'); im.src = 'img/' + k + '.jpg'; im.alt = IMGS[k];
          d.appendChild(im); d.appendChild(el('b', '', IMGS[k])); grid.appendChild(d);
        });
        sec.appendChild(grid);
        new Sortable(grid, { group: 'p', animation: 150, delay: 150, delayOnTouchOnly: true, ghostClass: 'sortable-ghost' });
      } else {
        var a = el('a'); a.href = '#g' + gi; a.setAttribute('data-t', 'g' + gi);
        a.appendChild(el('i', '', pad(shown))); a.appendChild(document.createTextNode(g.t)); nav.appendChild(a);
        var sh = el('div', 'sh');
        sh.appendChild(el('span', 'no', pad(shown))); sh.appendChild(el('h2', '', g.t)); sh.appendChild(el('span', 'ct', g.i.length + ' 項'));
        sec.appendChild(sh);
        var list = el('div', 'list');
        g.i.forEach(function (k, n) {
          var idx = order.length; order.push(k);
          var f = el('figure', 'card');
          var ph = el('div', 'ph'); var im = el('img');
          im.src = 'img/' + k + '.jpg'; im.alt = IMGS[k];
          if (SIZE[k]) { im.width = SIZE[k][0]; im.height = SIZE[k][1]; ph.style.aspectRatio = SIZE[k][0] + ' / ' + SIZE[k][1]; }
          if (idx > 1) im.loading = 'lazy';
          ph.appendChild(im); f.appendChild(ph);
          var cap = el('figcaption'); cap.appendChild(el('span', '', IMGS[k])); f.appendChild(cap);
          if (window.KPInq) KPInq.attach(f, k);
          list.appendChild(f);
          if (k === 'price' && $('veh')) list.appendChild($('veh')); // 車價圖之後才出現選單
        });
        sec.appendChild(list);
      }
      root.appendChild(sec);
    });
    if (!edit) {
      var c = el('a', 'contact'); c.href = '#contact'; c.setAttribute('data-t', 'contact'); c.textContent = '💬 聯絡我'; nav.appendChild(c);
      observe();
      if (window.KPInq) KPInq.sync();
    }
  }

  // 捲到哪一區，上方快速鍵就亮哪一顆；圖片進入畫面時淡入
  var io1, io2;
  function observe() {
    if (!('IntersectionObserver' in window)) { document.querySelectorAll('figure.card').forEach(function (f) { f.classList.add('in'); }); return; }
    if (io1) io1.disconnect(); if (io2) io2.disconnect();
    io2 = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io2.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('figure.card').forEach(function (f) { io2.observe(f); });
    var secs = Array.prototype.slice.call(document.querySelectorAll('#groups section, #contact'));
    var setOn = function (id) {
      var navEl = $('nav');
      Array.prototype.forEach.call(navEl.children, function (a) {
        var on = a.getAttribute('data-t') === id;
        a.classList.toggle('on', on);
        if (on) { var l = a.offsetLeft - (navEl.clientWidth - a.offsetWidth) / 2; navEl.scrollTo({ left: l, behavior: 'smooth' }); }
      });
    };
    io1 = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) setOn(e.target.id); });
    }, { rootMargin: '-35% 0px -60% 0px' });
    secs.forEach(function (s) { io1.observe(s); });
    // 首屏已有大按鈕、或聯絡區已在畫面時，收起底部聯絡列（避免重複）
    if (secs[0]) setOn(secs[0].id);
    var seeCta = true, seeContact = false;
    var upd = function () { $('call').classList.toggle('hide', seeCta || seeContact); };
    new IntersectionObserver(function (es) { seeCta = es[0].isIntersecting; upd(); }, { threshold: 0.2 }).observe(document.querySelector('.cta'));
    new IntersectionObserver(function (es) { seeContact = es[0].isIntersecting && es[0].intersectionRatio > 0.25; upd(); }, { threshold: [0, 0.25, 0.5] }).observe($('contact'));
    upd();
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
    // 不提供放大瀏覽（使用者決定）
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
  if (!edit && window.KPInq) KPInq.init();
  loadOrder().then(function (d) { if (d && d.groups) { groups = normalize(d.groups); render(); } });
})();
