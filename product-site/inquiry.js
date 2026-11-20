// 詢價單：客人在產品圖下面勾選想問的配件、選車型，彙整成 LINE 文字或圖片傳給業務。
// 全部在客人手機瀏覽器內完成，不連任何伺服器、不收集資料。
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // ===== 車型與售價（來自「K2500 車型售價表」，單位：萬）=====
  var CABS = ['單廂', '大單廂', '雙廂'];
  var CAB_SUB = { '單廂': '3人座', '大單廂': '3人座', '雙廂': '6人座' };
  var DRIVES = ['2WD 手排', '2WD 自排', '4WD 手排'];
  var VPRICE = {
    '單廂': { '2WD 手排': 81.8, '2WD 自排': 85.8, '4WD 手排': 97.8 },
    '大單廂': { '2WD 手排': 84.8, '2WD 自排': 88.8 },
    '雙廂': { '2WD 手排': 98.8, '2WD 自排': 103.8, '4WD 手排': 107.8 }
  };

  // ===== 每張圖下面可勾選的項目（價格照圖片標示，沒標價的寫 null）=====
  // fit：只提醒適用車型，不擋；byCab：價格依車廂；opts：要選的顏色／款式
  var I = {};
  function add(id, n, p, x) { var o = { id: id, n: n, p: p }; if (x) for (var k in x) o[k] = x[k]; I[id] = o; return o; }
  add('safe', '安全科技版', 40000, { note: '標準版加購' });
  add('special', '特仕版', 30000, { note: '標準版加購' });
  add('wheelsw', '原裝多功能方向盤', 20000, { note: '標準版加購' });
  add('ledset', 'LED 燈組升級組合（全車LED＋LED霧燈＋室內牌照燈＋極光側邊照地燈）', 15000);
  add('mirror-led', 'LED 韓版後照鏡', 8500);
  add('mirror-view', '後照鏡組－全視線', 5000);
  add('horn-mod', '專用喇叭改裝', 2800);
  add('phone2', '雙手機架組合（兩隻）', 3000, { optLabel: '固定方式', opts: ['重力', '磁吸'] });
  add('pkg-dbl', '雙廂高階套裝', 250000, { fit: '雙廂', note: '套餐價 25 萬（原價 275,000）' });
  add('android123', '12.3 吋安卓四錄旗艦機', 43800);
  add('audio', '音響升級', 9500);
  add('tail', 'LED 光環尾燈組', 11800);
  add('fog', '魚眼霧燈', 5800, { optLabel: '色系', opts: ['黃金眼', '6000K 白光'] });
  add('gtr', 'GTR 大燈升級', 28900);
  add('gtrplus', 'GTR plus 雙切驗車模組', null);
  add('aero-all', '空力套裝', 12000);
  add('aero-chin', '前下巴套件', 9500);
  add('aero-mirror', '後照鏡飾蓋', 2800);
  add('aero-signal', '方向燈殼', 1200);
  add('paint-s', '車身烤漆改色（單廂）', 36000, { cab: '單廂', note: '標準色消光黑，使用烤漆爐烘烤' });
  add('paint-l', '車身烤漆改色（大單廂）', 37000, { cab: '大單廂', note: '標準色消光黑，使用烤漆爐烘烤' });
  add('paint-d', '車身烤漆改色（雙廂）', 39000, { cab: '雙廂', note: '標準色消光黑，使用烤漆爐烘烤' });
  add('paint-matte', '消光霧面（雙層消光漆）加價', 8000);
  add('rob2', 'roberlo 防刮漆料（2~2.5呎尾門）', 9000);
  add('rob3', 'roberlo 防刮漆料（3~3.5呎尾門）', 10000);
  add('rob4', 'roberlo 防刮漆料（4~4.5呎尾門）', 11000);
  add('omega', 'OMEGA 鋁圈升級', 33800, { optLabel: '配色', opts: ['全銀', '內黑'] });
  add('ts', '韓國 TS 氮氣液壓避震器（完裝升級價）', 29800);
  add('leaf-plate', '彈簧鋼板', 5500);
  add('bush', '抗震優力膠 4P', 7800);
  add('atc', 'ATC 防傾桿', 18500, { fit: '2WD' });
  add('spring', '強化支撐彈簧', 15500);
  add('urea', '尿素桶防撞桿', 5500, { optLabel: '顏色', opts: ['橘色', '黑色'] });
  add('side-step', '雙廂專用延長側踏組', 18900, { fit: '雙廂' });
  add('skid4wd', '4WD 專用鋁合金下護板', 12500, { fit: '4WD' });
  add('rear-bar', '車尾防撞鋼樑（合法變更）', 7500);
  add('roof-rack', '車頂行李籃（專利快拆式）', 15500, { fit: '單廂' });
  add('travel', 'Travel 鋁合金行李橫桿（雙廂專用）', 12000, { fit: '雙廂' });
  add('boss', '304 白鐵擋泥板', 3580);
  add('dr', 'DR 漫反射後防撞桿（RGB 幻彩）', 13800, { note: '需變更／尾門車無法安裝' });
  add('hana', 'Hanafilter 冷氣濾網', 990);
  add('shift', '自排排檔桿保護蓋', 1480, { fit: '自排' });
  add('charger2', '車用快充頭（雙孔 Type-C 45W＋USB 18W，12V–24V）', 1580);
  add('rail', '貨斗加長延伸護欄', 8500);
  add('toolbox', '貨斗側掛工具箱（大箱／灰色 625×365×320mm）', 8680);
  add('grille', '電鍍水箱護罩', 3680);
  add('cargo-led', '貨斗 LED 定位燈（一組4條）', 1990, { optLabel: '燈色', opts: ['藍紫', '白', '紅'] });
  add('horn', '高低音警示喇叭', 2280);
  add('wheel-cover', '卡旺方向盤套', 600, { optLabel: '款式', opts: ['石墨灰', '硫石紅', '岩石棕', '紅色縫線'] });
  add('sunpad', '反折射避光墊（2021年後卡旺）', 589);
  add('armrest', '中央扶手靠枕', 820);
  add('cushion', '涼感果凍坐墊', 649);
  add('sunshade', '雙層車窗遮陽簾', 1280);
  add('fuelcap', '免鑰匙油箱蓋（柴油）', 599);
  add('puddle', 'LED 側邊照地燈', 2490, { note: '2WD 43cm／4WD 50cm' });
  add('phone-grip', '手把手機支架', 1280);
  add('cup-dbl', '雙廂置杯收納架', 389, { fit: '雙廂' });
  add('pedal', '鋁合金腳踏板（油門＋煞車）', 1880, { fit: '自排' });
  add('cup-pad', '置杯架防滑墊', 1190);
  add('opener', '安全帶造型開瓶器', 890);
  add('gps', '4G GPS 車輛定位器（A18）', 9900, { note: '4G 網卡贈送 2 年，GPS 車機永久保固' });

  // 圖片 → 項目（同一項目出現在多張圖時，勾選會同步）
  var BY_IMG = {
    equip: ['safe', 'special', 'wheelsw'],
    lights: ['ledset', 'mirror-led', 'mirror-view', 'horn-mod', 'phone2'],
    package: ['pkg-dbl'], android: ['android123'], audio: ['audio'], tail: ['tail'], fog: ['fog'],
    gtr: ['gtr'], 'gtr-plus': ['gtrplus'],
    aero: ['aero-all', 'aero-chin', 'aero-mirror', 'aero-signal'],
    paint: ['paint-s', 'paint-l', 'paint-d', 'paint-matte', 'rob2', 'rob3', 'rob4'], wheel: ['omega'],
    chassis: ['ts', 'leaf-plate', 'bush', 'atc', 'spring'],
    metal: ['urea', 'side-step', 'skid4wd', 'rear-bar', 'roof-rack', 'travel'],
    boss: ['boss'], dr: ['dr'],
    cabin1: ['hana', 'shift', 'charger2'],
    guard: ['skid4wd', 'rail', 'toolbox'],
    extlight: ['grille', 'cargo-led', 'horn'],
    comfort: ['wheel-cover', 'sunpad', 'armrest', 'cushion'],
    peri1: ['sunshade', 'fuelcap', 'puddle'],
    func: ['phone-grip', 'cup-dbl', 'pedal'],
    cabin2: ['cup-pad', 'armrest', 'pedal', 'cushion'],
    peri2: ['charger2', 'opener', 'toolbox'],
    gps: ['gps']
  };

  // ===== 狀態（只存在客人自己的手機）=====
  var KEY = 'kp-inq';
  var S = { cab: '', drive: '', sel: {}, name: '', note: '' };
  try { var old = JSON.parse(localStorage.getItem(KEY)); if (old && typeof old === 'object') { S.cab = CABS.indexOf(old.cab) >= 0 ? old.cab : ''; S.drive = DRIVES.indexOf(old.drive) >= 0 ? old.drive : ''; S.sel = old.sel && typeof old.sel === 'object' ? old.sel : {}; S.name = String(old.name || ''); S.note = String(old.note || ''); } } catch (e) {}
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function priceOf(it) { return it.byCab ? (S.cab ? it.byCab[S.cab] : null) : it.p; }
  function driveOk(d) { return !S.cab || !!(VPRICE[S.cab] && VPRICE[S.cab][d]); }
  function fitWarn(it) {
    if (it.cab) return S.cab && S.cab !== it.cab ? '⚠ 這是' + it.cab + '的價格，你選的是' + S.cab : '';
    if (!it.fit) return '';
    var f = it.fit;
    if (f === '2WD' || f === '4WD') { if (S.drive && S.drive.indexOf(f) !== 0) return '⚠ 適用 ' + f + '，你選的是 ' + S.drive.split(' ')[0]; return ''; }
    if (f === '自排') { if (S.drive && S.drive.indexOf('自排') < 0) return '⚠ 自排專用，你選的是手排'; return ''; }
    if (f === '單廂') { if (S.cab === '雙廂') return '⚠ 適用單廂／大單廂，你選的是雙廂'; return ''; }
    if (f === '雙廂') { if (S.cab && S.cab !== '雙廂') return '⚠ 雙廂專用，你選的是' + S.cab; return ''; }
    return '';
  }
  function fitTag(it) {
    if (!it.fit) return '';
    return { '2WD': '2WD 適用', '4WD': '4WD 適用', '自排': '自排專用', '單廂': '單廂／大單廂適用', '雙廂': '雙廂專用' }[it.fit] || '';
  }

  function chosen() { return Object.keys(S.sel).filter(function (id) { return I[id]; }).map(function (id) { return I[id]; }); }
  function vehPrice() { var v = S.cab && S.drive && VPRICE[S.cab] ? VPRICE[S.cab][S.drive] : null; return v ? Math.round(v * 10000) : 0; }
  function grand() { return vehPrice() + total(); }
  function total() { var t = 0; chosen().forEach(function (it) { var p = priceOf(it); if (p) t += p; }); return t; }
  function vehicleText() {
    if (!S.cab && !S.drive) return '';
    var s = (S.cab ? S.cab + ' ' + CAB_SUB[S.cab] : '') + (S.cab && S.drive ? '／' : '') + (S.drive || '');
    var v = S.cab && S.drive && VPRICE[S.cab] ? VPRICE[S.cab][S.drive] : null;
    return s + (v ? '（標價 ' + v + ' 萬）' : '');
  }
  function optText(it) { var o = S.sel[it.id]; return o && o !== true ? '（' + o + '）' : (it.opts ? '（' + it.optLabel + '：還沒選）' : ''); }

  // ===== 車型選擇面板 =====
  function chip(label, on, off, fn) {
    var b = el('button', 'chip' + (on ? ' on' : '') + (off ? ' off' : ''), label); b.type = 'button';
    if (off) b.disabled = true; else b.onclick = fn; return b;
  }
  function renderVeh() {
    var box = $('veh'); if (!box) return; box.innerHTML = '';
    var card = el('div', 'veh-card');
    card.appendChild(el('div', 'veh-h', '① 先選你的車型（可略過）'));
    card.appendChild(el('div', 'veh-s', '選好後，配件的適用提醒與烤漆價格會跟著變'));
    var r1 = el('div', 'chips'); CABS.forEach(function (c) {
      r1.appendChild(chip(c + ' ' + CAB_SUB[c], S.cab === c, false, function () {
        S.cab = S.cab === c ? '' : c; if (S.cab && S.drive && !driveOk(S.drive)) S.drive = ''; persist(); refresh();
      }));
    }); card.appendChild(r1);
    var r2 = el('div', 'chips'); DRIVES.forEach(function (d) {
      r2.appendChild(chip(d, S.drive === d, !driveOk(d), function () { S.drive = S.drive === d ? '' : d; persist(); refresh(); }));
    }); card.appendChild(r2);
    var vt = vehicleText();
    if (vt) card.appendChild(el('div', 'veh-r', '你選的車：' + vt));
    box.appendChild(card);
  }

  // ===== 圖片下面的勾選列 =====
  function attach(fig, imgKey) {
    var ids = BY_IMG[imgKey]; if (!ids) return;
    var wrap = el('div', 'items');
    wrap.appendChild(el('div', 'items-h', '想詢價就勾起來 👇'));
    ids.forEach(function (id) {
      var it = I[id]; var row = el('div', 'irow'); row.setAttribute('data-iid', id);
      var top = el('button', 'itop'); top.type = 'button';
      top.appendChild(el('span', 'box', '✓'));
      var nm = el('span', 'inm'); nm.appendChild(document.createTextNode(it.n));
      var tag = fitTag(it); if (tag) nm.appendChild(el('em', '', tag));
      if (it.note) { nm.appendChild(el('br')); nm.appendChild(el('small', 'inote', it.note)); }
      top.appendChild(nm);
      top.appendChild(el('span', 'ipr', ''));
      top.onclick = function () { toggle(id); };
      row.appendChild(top);
      row.appendChild(el('div', 'iwarn', ''));
      if (it.opts) {
        var oc = el('div', 'iopts'); oc.appendChild(el('span', '', it.optLabel + '：'));
        it.opts.forEach(function (o) {
          var b = el('button', 'chip s', o); b.type = 'button'; b.setAttribute('data-o', o);
          b.onclick = function () { S.sel[id] = o; persist(); refresh(); }; oc.appendChild(b);
        });
        row.appendChild(oc);
      }
      wrap.appendChild(row);
    });
    fig.appendChild(wrap);
  }
  function toggle(id) {
    if (S.sel[id]) delete S.sel[id]; else S.sel[id] = true;
    persist(); refresh();
  }

  function syncRows() {
    var rows = document.querySelectorAll('.irow');
    Array.prototype.forEach.call(rows, function (row) {
      var id = row.getAttribute('data-iid'), it = I[id], on = !!S.sel[id];
      row.classList.toggle('on', on);
      var p = priceOf(it), pr = row.querySelector('.ipr');
      if (it.byCab && !S.cab) pr.textContent = '依車廂報價';
      else pr.textContent = p ? money(p) : '價格請洽業務';
      pr.classList.toggle('ask', !p);
      var w = row.querySelector('.iwarn'), msg = fitWarn(it); w.textContent = msg; w.style.display = msg ? 'block' : 'none';
      var oc = row.querySelector('.iopts');
      if (oc) { oc.style.display = on ? 'flex' : 'none'; Array.prototype.forEach.call(oc.querySelectorAll('button'), function (b) { b.classList.toggle('on', S.sel[id] === b.getAttribute('data-o')); }); }
    });
  }

  // ===== 底部「詢價單」按鈕 =====
  function syncBar() {
    var bar = $('inqbar'); if (!bar) return;
    var n = chosen().length;
    bar.style.display = n ? 'flex' : 'none';
    if (n) { $('inqn').textContent = n + ' 項'; var t = total(); var g = grand(); $('inqt').textContent = g ? (vehPrice() ? '車＋配件 ' : '配件 ') + money(g) : ''; }
  }

  function refresh() { renderVeh(); syncRows(); syncBar(); if ($('inqsheet').style.display === 'flex') renderSheet(); }

  // ===== 詢價單視窗 =====
  function buildText() {
    var L = ['【詢價單】'];
    if (S.name.trim()) L.push('稱呼：' + S.name.trim());
    var vt = vehicleText(); L.push('車型：' + (vt || '還沒決定'));
    L.push('', '想詢價的配件：');
    chosen().forEach(function (it) {
      var p = priceOf(it);
      L.push('・' + it.n + optText(it) + '　' + (p ? money(p) : (it.byCab ? '（價格依車廂，請報價）' : '（請報價）')));
      if (it.note) L.push('　' + it.note);
      var w = fitWarn(it); if (w) L.push('　' + w);
    });
    var t = total(), vp = vehPrice();
    if (vp || t) L.push('');
    if (vp) L.push('車價：' + money(vp));
    if (t) L.push('配件合計：' + money(t));
    if (vp && t) L.push('車＋配件：' + money(vp + t));
    if (S.note.trim()) L.push('', '備註：' + S.note.trim());
    L.push('', '＊價格依網頁標示，實際以現場報價為準');
    return L.join('\n');
  }

  function renderSheet() {
    var list = $('inqlist'); list.innerHTML = '';
    var its = chosen();
    its.forEach(function (it) {
      var r = el('div', 'srow');
      var left = el('div', 'sl'); left.appendChild(el('b', '', it.n + optText(it)));
      var w = fitWarn(it); if (w) left.appendChild(el('small', 'warn', w));
      r.appendChild(left);
      var p = priceOf(it); r.appendChild(el('span', 'sp', p ? money(p) : (it.byCab ? '依車廂' : '請報價')));
      var x = el('button', 'sx', '✕'); x.type = 'button'; x.setAttribute('aria-label', '移除'); x.onclick = function () { delete S.sel[it.id]; persist(); refresh(); if (!chosen().length) closeSheet(); };
      r.appendChild(x); list.appendChild(r);
    });
    var vt = vehicleText(); $('inqveh').textContent = '車型：' + (vt || '還沒選（可回上面選）');
    var t = total(), vp = vehPrice(); var h = '';
    if (vp) h += '車價 ' + money(vp) + '\n';
    if (t) h += '配件合計 ' + money(t) + '\n';
    if (vp && t) h += '車＋配件 ' + money(vp + t);
    $('inqtot').textContent = h.replace(/\n$/, '');
    $('inqprev').style.display = 'none';
  }
  function openSheet() { $('inqname').value = S.name; $('inqnote').value = S.note; $('inqsheet').style.display = 'flex'; document.body.style.overflow = 'hidden'; renderSheet(); }
  function closeSheet() { $('inqsheet').style.display = 'none'; document.body.style.overflow = ''; }

  function toast(m) { var t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(function () { t.style.display = 'none'; }, 4000); }
  function copyText(txt, ok) {
    var fallback = function () { window.prompt('長按全選複製', txt); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, fallback); else fallback();
  }

  // 用 Canvas 直接畫成圖片（各手機瀏覽器排版一致）
  function drawImage() {
    var W = 750, pad = 40, FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    var its = chosen(), c = document.createElement('canvas'), g = c.getContext('2d');
    function wrap(txt, font, maxW) {
      g.font = font; var out = [], cur = '';
      for (var i = 0; i < txt.length; i++) { var t = cur + txt[i]; if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = txt[i]; } else cur = t; }
      if (cur) out.push(cur); return out;
    }
    var rows = its.map(function (it) {
      var p = priceOf(it);
      return { lines: wrap(it.n + optText(it), '600 26px ' + FONT, W - pad * 2 - 190), price: p ? money(p) : (it.byCab ? '依車廂' : '請報價'), warn: fitWarn(it) };
    });
    var noteLines = S.note.trim() ? wrap('備註：' + S.note.trim(), '24px ' + FONT, W - pad * 2) : [];
    var H = 210 + 56;
    rows.forEach(function (r) { H += r.lines.length * 36 + 20 + (r.warn ? 28 : 0); });
    H += 40 + 70 + (vehPrice() ? 44 : 0) + (vehPrice() && total() ? 44 : 0) + (noteLines.length ? noteLines.length * 34 + 30 : 0) + 90;
    c.width = W * 2; c.height = H * 2; g.scale(2, 2);
    g.fillStyle = '#fbf7f1'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d9453b'; g.fillRect(0, 0, W, 10);
    var y = 70; g.fillStyle = '#2f2a25'; g.font = '800 40px ' + FONT; g.fillText('詢價單', pad, y);
    g.font = '24px ' + FONT; g.fillStyle = '#7b6f63'; g.textAlign = 'right';
    var d = new Date(); g.fillText(d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(), W - pad, y); g.textAlign = 'left';
    y += 46; g.fillStyle = '#2f2a25'; g.font = '600 26px ' + FONT;
    if (S.name.trim()) { g.fillText('稱呼：' + S.name.trim(), pad, y); y += 40; }
    var vt = vehicleText(); g.fillText('車型：' + (vt || '還沒決定'), pad, y); y += 30;
    g.strokeStyle = '#ebe0d0'; g.lineWidth = 2; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke(); y += 40;
    rows.forEach(function (r) {
      g.fillStyle = '#2f2a25'; g.font = '600 26px ' + FONT;
      r.lines.forEach(function (ln, i) { g.fillText((i ? '　' : '・') + ln, pad, y + i * 36); });
      g.fillStyle = '#d9453b'; g.font = '800 26px ' + FONT; g.textAlign = 'right'; g.fillText(r.price, W - pad, y); g.textAlign = 'left';
      y += r.lines.length * 36 - 6;
      if (r.warn) { g.fillStyle = '#c0771a'; g.font = '22px ' + FONT; g.fillText(r.warn, pad + 24, y + 22); y += 28; }
      y += 26;
    });
    g.strokeStyle = '#ebe0d0'; g.beginPath(); g.moveTo(pad, y - 6); g.lineTo(W - pad, y - 6); g.stroke(); y += 40;
    var t = total(), vp = vehPrice();
    function line(lb, v, big) { g.fillStyle = '#2f2a25'; g.font = (big ? '800 32px ' : '700 27px ') + FONT; g.fillText(lb, pad, y); g.fillStyle = '#d9453b'; g.textAlign = 'right'; g.fillText(money(v), W - pad, y); g.textAlign = 'left'; y += 44; }
    if (vp) line('車價', vp);
    if (t) line('配件合計', t, !vp);
    if (vp && t) line('車＋配件', vp + t, true);
    if (noteLines.length) { g.fillStyle = '#4b4137'; g.font = '24px ' + FONT; y += 6; noteLines.forEach(function (ln) { g.fillText(ln, pad, y); y += 34; }); y += 10; }
    g.fillStyle = '#7b6f63'; g.font = '21px ' + FONT; g.fillText('＊價格依網頁標示，實際以現場報價為準', pad, y + 20);
    return c;
  }
  function saveImage() {
    var c = drawImage();
    c.toBlob(function (blob) {
      if (!blob) { toast('產生圖片失敗，請改用複製文字'); return; }
      var url = c.toDataURL('image/png');
      var pv = $('inqprev'); pv.style.display = 'block'; pv.querySelector('img').src = url;
      var a = pv.querySelector('a'); a.href = url; a.download = '詢價單.png';
      try {
        var f = new File([blob], '詢價單.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).catch(function () {}); }
      } catch (e) {}
      pv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 'image/png');
  }

  function init() {
    renderVeh(); syncRows(); syncBar();
    $('inqbar').onclick = openSheet;
    $('inqclose').onclick = closeSheet;
    $('inqname').oninput = function () { S.name = this.value; persist(); };
    $('inqnote').oninput = function () { S.note = this.value; persist(); };
    $('inqcopy').onclick = function () { copyText(buildText(), function () { toast('已複製，貼到 LINE 傳給我就好'); }); };
    $('inqline').onclick = function () { copyText(buildText(), function () { toast('已複製，貼上後傳送'); setTimeout(function () { window.open('https://line.me/ti/p/Mrn4VCwGTv', '_blank'); }, 600); }); };
    $('inqimg').onclick = saveImage;
    $('inqclear').onclick = function () { if (confirm('清空已勾選的項目？')) { S.sel = {}; persist(); refresh(); closeSheet(); } };
  }

  window.KPInq = { attach: attach, sync: function () { renderVeh(); syncRows(); syncBar(); }, init: init, has: function (k) { return !!BY_IMG[k]; } };
})();
