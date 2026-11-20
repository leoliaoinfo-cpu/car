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
    gps: '4G GPS 車輛定位器', 'gps-app': '智慧定位五大核心功能',
    'cfg-tailgate': '尾門', 'cfg-canvas': '帆布', 'cfg-box': '車廂體（冷凍冷藏箱・電動歐翼・露營箱體）'
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
    { t: '尾門・帆布・箱體', i: ['cfg-tailgate', 'cfg-canvas', 'cfg-box'] },
    { t: '外觀與輪圈', i: ['paint', 'aero', 'wheel'] },
    { t: '底盤與金屬', i: ['chassis', 'metal', 'boss', 'dr', 'guard'] },
    { t: '配備與影音', i: ['android', 'audio', 'gps', 'gps-app'] },
    { t: '燈光', i: ['tail', 'fog', 'gtr', 'gtr-cut', 'gtr-plus', 'extlight'] },
    { t: '車室與周邊', i: ['cabin1', 'comfort', 'peri1', 'func', 'cabin2', 'peri2'] }
  ];
  // 併圖：副圖 → 主圖（副圖不另外開卡，放在主圖卡的下面一起介紹、一起勾選）
  var PAIR = { 'gps-app': 'gps' };
  var CFG_SUB = { 'cfg-tailgate': '選尺寸，價格依尺寸計算；油壓缸與配件要先選升降尾門', 'cfg-canvas': '價格依你上面選的車廂顯示（還沒選就顯示最低價起）；高度寫在每個名稱裡', 'cfg-box': '依尺寸與規格另外報價，勾起來我幫你算' };
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

  var active = ''; // 目前顯示的分頁（g0、g1…或 contact）
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tabIds() { return Array.prototype.map.call($('nav').children, function (a) { return a.getAttribute('data-t'); }); }

  function render() {
    var root = $('groups'), nav = $('nav');
    var vb = $('veh'); if (vb && vb.parentNode !== root.parentNode) root.parentNode.insertBefore(vb, root); // 先放回原位，免得被清掉
    root.innerHTML = ''; nav.innerHTML = '';
    var shown = [];
    groups.forEach(function (g, gi) { if (edit || g.i.length) shown.push(gi); });
    shown.forEach(function (gi, si) {
      var g = groups[gi];
      var sec = el('section', 'pane'); sec.id = 'g' + gi;
      if (edit) {
        sec.appendChild(el('h2', '', g.t));
        var grid = el('div', 'grid'); grid.setAttribute('data-g', gi);
        g.i.forEach(function (k) {
          var d = el('div', 'it'); d.setAttribute('data-k', k);
          if (k.indexOf('cfg-') === 0) { d.appendChild(el('b', '', '🧩 ' + IMGS[k] + '（選擇卡，非圖片）')); grid.appendChild(d); return; }
          var im = el('img'); im.src = 'img/' + k + '.webp'; im.alt = IMGS[k];
          d.appendChild(im); d.appendChild(el('b', '', IMGS[k])); grid.appendChild(d);
        });
        sec.appendChild(grid);
        new Sortable(grid, { group: 'p', animation: 150, delay: 150, delayOnTouchOnly: true, ghostClass: 'sortable-ghost' });
      } else {
        var a = el('a'); a.href = '#g' + gi; a.setAttribute('data-t', 'g' + gi); a.setAttribute('role', 'tab');
        a.appendChild(el('i', '', pad(si + 1))); a.appendChild(document.createTextNode(g.t));
        a.onclick = function (e) { e.preventDefault(); setTab('g' + gi); };
        nav.appendChild(a);
        var sh = el('div', 'sh');
        sh.appendChild(el('span', 'no', pad(si + 1))); sh.appendChild(el('h2', '', g.t)); sh.appendChild(el('span', 'ct', g.i.length + ' 張'));
        sec.appendChild(sh);
        if (si > 0 && window.KPInq) KPInq.vbar(sec, function () { setTab('g' + shown[0]); var v = $('veh'); if (v) setTimeout(function () { v.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60); });
        var list = el('div', 'list');
        g.i.forEach(function (k, n) {
          // 兩張圖算同一個產品時放進同一張卡（例：GPS 定位器＋智慧定位功能）
          var mate = PAIR[k];
          if (mate && g.i.indexOf(mate) >= 0) return; // 這張已併到主圖的卡裡
          if (k.indexOf('cfg-') === 0) { // 選擇卡（沒有海報圖）：尾門／帆布／箱體
            var cf = el('figure', 'card cfg'); var cc = el('figcaption'); cc.appendChild(el('span', '', IMGS[k])); cf.appendChild(cc);
            if (CFG_SUB[k]) cf.appendChild(el('p', 'sub', CFG_SUB[k]));
            if (window.KPInq) KPInq.attach(cf, k);
            list.appendChild(cf); return;
          }
          var f = el('figure', 'card');
          var ks = [k]; Object.keys(PAIR).forEach(function (m) { if (PAIR[m] === k && g.i.indexOf(m) >= 0) ks.push(m); });
          ks.forEach(function (kk) {
            var ph = el('div', 'ph'); var im = el('img');
            im.src = 'img/' + kk + '.webp'; im.alt = IMGS[kk]; im.loading = 'lazy'; im.decoding = 'async';
            if (SIZE[kk]) { im.width = SIZE[kk][0]; im.height = SIZE[kk][1]; ph.style.aspectRatio = SIZE[kk][0] + ' / ' + SIZE[kk][1]; }
            ph.appendChild(im); f.appendChild(ph);
            ph.onclick = function () { var pk = g.i.filter(function (x) { return x.indexOf('cfg-') !== 0; }); openLb(pk, pk.indexOf(kk)); };
          });
          var cap = el('figcaption'); cap.appendChild(el('span', '', IMGS[k])); f.appendChild(cap);
          if (window.KPInq) KPInq.attach(f, k);
          list.appendChild(f);
          if (k === 'price' && $('veh')) list.appendChild($('veh')); // 車價圖之後才出現選單
        });
        sec.appendChild(list);
        // 下一類：一路看下去，不用自己找
        var nextG = shown[si + 1];
        var nb = el('button', 'nextbtn', nextG != null ? '下一類：' + groups[nextG].t + '　›' : '都看完了 → 聯絡我、預約看車　›');
        nb.type = 'button'; nb.onclick = function () { setTab(nextG != null ? 'g' + nextG : 'contact'); };
        sec.appendChild(nb);
      }
      root.appendChild(sec);
    });
    if (!edit) {
      var c = el('a', '', '💬 聯絡看車'); c.className = 'contact'; c.href = '#contact'; c.setAttribute('data-t', 'contact'); c.setAttribute('role', 'tab');
      c.onclick = function (e) { e.preventDefault(); setTab('contact'); };
      nav.appendChild(c);
      var ids = tabIds(); if (ids.indexOf(active) < 0) active = ids[0] || '';
      setTab(active, true);
      observe();
      if (window.KPInq) KPInq.sync();
    }
  }

  function setTab(id, keepScroll) {
    active = id;
    var navEl = $('nav');
    Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (p) { p.classList.toggle('on', p.id === id); });
    Array.prototype.forEach.call(navEl.children, function (a) {
      var on = a.getAttribute('data-t') === id; a.classList.toggle('on', on); a.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) navEl.scrollTo({ left: a.offsetLeft - (navEl.clientWidth - a.offsetWidth) / 2, behavior: keepScroll ? 'auto' : 'smooth' });
    });
    if (!keepScroll) {
      var top = document.querySelector('main').getBoundingClientRect().top + window.pageYOffset - $('nav').offsetHeight - 6;
      if (window.pageYOffset > top) window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    }
    updCall();
  }
  // 左右滑動切換分類（手機）
  (function () {
    var x0 = null, y0 = 0;
    document.addEventListener('touchstart', function (e) { var t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (x0 == null || edit || $('lb').style.display === 'flex' || $('inqsheet').style.display === 'flex') { x0 = null; return; }
      var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
      if (Math.abs(dx) < 90 || Math.abs(dy) > 50 || Math.abs(dx) < Math.abs(dy) * 2.2) return;
      if (e.target.closest && e.target.closest('#nav, .iopts, input, textarea')) return;
      var ids = tabIds(), i = ids.indexOf(active), n = i + (dx < 0 ? 1 : -1);
      if (n >= 0 && n < ids.length) setTab(ids[n]);
    }, { passive: true });
  })();
  // ===== 圖片放大（點海報開啟；可縮放、拖動、左右切換）=====
  var LB = { keys: [], i: 0, z: 1, fw: 200 };
  function lbApply() { $('lbi').style.width = Math.round(LB.fw * LB.z) + 'px'; $('lbz').textContent = Math.round(LB.z * 100) + '%'; }
  function lbFit() {
    var st = $('lbs'), im = $('lbi'), r = (im.naturalHeight / im.naturalWidth) || 1.4;
    LB.fw = Math.max(140, Math.min(st.clientWidth - 24, (st.clientHeight - 24) / r)); lbApply();
  }
  function lbShow(i) {
    var n = LB.keys.length; LB.i = (i + n) % n; LB.z = 1;
    var k = LB.keys[LB.i], im = $('lbi');
    im.onload = lbFit; im.src = 'img/' + k + '.webp'; im.alt = IMGS[k] || '';
    $('lbt').textContent = (IMGS[k] || '') + '　' + (LB.i + 1) + ' / ' + n;
    $('lbs').scrollTo(0, 0); $('lbp').style.display = $('lbn').style.display = n > 1 ? '' : 'none'; lbApply();
  }
  function openLb(keys, idx) { LB.keys = keys.slice(); $('lb').style.display = 'flex'; document.body.style.overflow = 'hidden'; lbShow(idx); }
  function closeLb() { $('lb').style.display = 'none'; document.body.style.overflow = ''; }
  function zoomTo(z) { LB.z = Math.max(1, Math.min(4, z)); lbApply(); }
  (function () {
    $('lbx').onclick = closeLb;
    $('lbp').onclick = function () { lbShow(LB.i - 1); };
    $('lbn').onclick = function () { lbShow(LB.i + 1); };
    $('lbm').onclick = function () { zoomTo(LB.z - 0.5); };
    $('lbpl').onclick = function () { zoomTo(LB.z + 0.5); };
    $('lbr').onclick = function () { zoomTo(1); };
    $('lbi').ondblclick = function () { zoomTo(LB.z > 1 ? 1 : 2.5); };
    window.addEventListener('resize', function () { if ($('lb').style.display === 'flex') lbFit(); });
    document.addEventListener('keydown', function (e) {
      if ($('lb').style.display !== 'flex') return;
      if (e.key === 'Escape') closeLb(); else if (e.key === 'ArrowLeft') lbShow(LB.i - 1); else if (e.key === 'ArrowRight') lbShow(LB.i + 1);
      else if (e.key === '+' || e.key === '=') zoomTo(LB.z + 0.5); else if (e.key === '-') zoomTo(LB.z - 0.5);
    });
    // 手機：雙指縮放、沒放大時左右滑換張
    var st = $('lbs'), d0 = 0, z0 = 1, sx = null, sy = 0;
    function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    st.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) { d0 = dist(e.touches); z0 = LB.z; sx = null; } else { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
    }, { passive: true });
    st.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && d0) { e.preventDefault(); zoomTo(z0 * dist(e.touches) / d0); }
    }, { passive: false });
    st.addEventListener('touchend', function (e) {
      if (d0 && e.touches.length < 2) { d0 = 0; return; }
      if (sx == null || LB.z > 1.05) { sx = null; return; }
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) lbShow(LB.i + (dx < 0 ? 1 : -1));
    }, { passive: true });
  })();

  var seeCta = true;
  function updCall() { var c = $('call'); if (c) c.classList.toggle('hide', seeCta || active === 'contact'); }

  // 圖片進入畫面時淡入；首屏已有大按鈕時收起底部聯絡列（避免重複）
  var io2;
  function observe() {
    if (!('IntersectionObserver' in window)) { document.querySelectorAll('figure.card').forEach(function (f) { f.classList.add('in'); }); return; }
    if (io2) io2.disconnect();
    io2 = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io2.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('figure.card').forEach(function (f) { io2.observe(f); });
    if (!observe.cta) { observe.cta = new IntersectionObserver(function (es) { seeCta = es[0].isIntersecting; updCall(); }, { threshold: 0.2 }); observe.cta.observe(document.querySelector('.cta')); }
    updCall();
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
    // 點圖放大：見 openLb（使用者 2026-11-20 改變決定，要有放大）
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
