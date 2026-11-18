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
    if (!c.repo || !c.token) { openSettings(); return; }
    var btn = $('save'); btn.disabled = true; btn.textContent = '儲存中…';
    var url = 'https://api.github.com/repos/' + c.repo + '/contents/' + (/\/car$/.test(c.repo) ? 'product-site/order.json' : 'order.json');
    var h = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' };
    var data = collect();
    fetch(url, { headers: h }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('讀取失敗（' + r.status + '），請檢查 repo 名稱與權杖');
      return r.json();
    }).then(function (cur) {
      var body = { message: '調整照片排序', content: b64(JSON.stringify({ groups: data }, null, 1)) };
      if (cur && cur.sha) body.sha = cur.sha;
      return fetch(url, { method: 'PUT', headers: h, body: JSON.stringify(body) });
    }).then(function (r) {
      if (!r.ok) throw new Error('寫入失敗（' + r.status + '），權杖需要 Contents 讀寫權限');
      groups = data;
      toast('已儲存。約 1～2 分鐘後客戶看到新順序');
    }).catch(function (e) { toast(e.message || '儲存失敗'); })
      .then(function () { btn.disabled = false; btn.textContent = '儲存發佈'; });
  }

  function openSettings() { var c = cfg(); $('f-repo').value = c.repo || ''; $('f-token').value = c.token || ''; $('set').style.display = 'flex'; }

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
      var repo = $('f-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      try { localStorage.setItem(KEY, JSON.stringify({ repo: repo, token: $('f-token').value.trim() })); } catch (e) {}
      $('set').style.display = 'none'; toast('設定已存，再按一次「儲存發佈」');
    };
  } else {
    var lb = $('lb');
    lb.onclick = function (e) { if (e.target.tagName !== 'IMG') lb.style.display = 'none'; };
  }

  render();
  fetch('order.json?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    .then(function (d) { if (d && d.groups) { groups = normalize(d.groups); render(); } });
})();
