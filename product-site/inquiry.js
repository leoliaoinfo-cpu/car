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
  add('safe', '安全科技版', 40000, { note: '選配' });
  add('special', '特仕版', 30000, { note: '選配' });
  add('wheelsw', '原裝多功能方向盤', 20000, { note: '選配' });
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
  add('aero-all', '空力套裝', 12000);
  add('aero-chin', '前下巴套件', 9500);
  add('aero-mirror', '後照鏡飾蓋', 2800);
  add('aero-signal', '方向燈殼', 1200);
  add('paint-s', '車身烤漆改色（單廂）', 36000, { cab: '單廂', note: '標準色消光黑，使用烤漆爐烘烤' });
  add('paint-l', '車身烤漆改色（大單廂）', 37000, { cab: '大單廂', note: '標準色消光黑，使用烤漆爐烘烤' });
  add('paint-d', '車身烤漆改色（雙廂）', 39000, { cab: '雙廂', note: '標準色消光黑，使用烤漆爐烘烤' });
  add('paint-matte', '消光漆／珍珠漆工法　加價', 8000, { keep: 1, note: '消光霧面(30度)效果為雙層消光漆' });
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

  // ===== 尾門／帆布／車廂體（規格與價格取自業務系統的報價選單；不含任何成本）=====
  add('tg-lift', '升降尾門', null, { keep: 1, optLabel: '尺寸', opts: ['2.5尺', '3尺', '3.5尺', '4尺', '4.5尺', '5尺', '5.5尺', '6尺特規'], optPrice: { '2.5尺': 37000, '3尺': 40000, '3.5尺': 40000, '4尺': 43000, '4.5尺': 43000, '5尺': 48000, '5.5尺': 48000, '6尺特規': null }, note: '選尺寸後算價；再選下面的油壓缸與配件' });
  add('tg-fold', '雙折尾門', null, { keep: 1, optLabel: '尺寸', opts: ['3.5尺', '4尺', '4.5尺', '5尺', '5.5尺', '6尺特規'], optPrice: { '3.5尺': 40000, '4尺': 43000, '4.5尺': 43000, '5尺': 48000, '5.5尺': 48000, '6尺特規': null }, note: '單折／雙折同尺寸同價；實際承重與施工規格需確認' });
  add('tg-cyl2', '雙缸油壓缸（800～1,000kg）', 8000, { req: ['tg-lift'], note: '搭配升降尾門；實際承重依車型、平台與施工內容確認' });
  add('tg-cyl4', '四缸油壓缸（約1,200kg 特製規格）', null, { req: ['tg-lift'], note: '需確認載重、平台尺寸與車體後報價' });
  add('tg-step', '尾門腳踏', 1000, { req: ['tg-lift'], note: '升降尾門用輔助腳踏' });
  add('tg-remote', '尾門遙控', 2000, { req: ['tg-lift'], note: '升降尾門遙控操作' });
  var CV = { '單廂': 0, '大單廂': 0, '雙廂': 0 };
  function cvp(a, b) { return { '單廂': a, '大單廂': a, '雙廂': b }; }
  add('cv-std', '三面帆布　標準高　斗上約 148cm', null, { keep: 1, byCab: cvp(19500, 14500), note: '實際高度及 2WD／4WD 適用性於施工前確認' });
  add('cv-low', '三面帆布　降低版　最低斗上約 130cm', null, { keep: 1, byCab: cvp(20500, 15500), note: '平頂、不修改原有頭立；實際適用性於施工前確認' });
  add('cv-high', '三面帆布　加高 1 台尺　斗上約 178cm', null, { keep: 1, byCab: cvp(23000, 18500), note: '標準高再增加約 30.3cm；實際完工高度於施工前確認' });
  add('cv-custom', '特殊訂製帆布', null, { note: '特殊高度、材質、開門方式或施工內容，另向廠商詢價' });
  add('cv-lift', '升降帆布（卡旺單廂・特殊電動升降）', 130000, { fit: '單廂', note: '降低（平車頭）高 195cm、升 80cm，斗內高 110–195cm；更高可再做（降 235cm、升 90cm，斗內高 150–240cm）' });
  add('bx-alu250', '鋁塑車廂　大單廂 9.7 尺　室內高 2.5 米', 81000, { keep: 1, cab: '大單廂', grp: 'alu-h', note: '含鋁塑牆板、室內 LED 燈、後門雙開、副駕側單開門；不含尾門、截樑、監理站變更及其他特殊配備' });
  add('bx-alu260', '鋁塑車廂　大單廂 9.7 尺　室內高 2.6 米', 84000, { keep: 1, cab: '大單廂', grp: 'alu-h', note: '含鋁塑牆板、室內 LED 燈、後門雙開、副駕側單開門；不含尾門、截樑、監理站變更及其他特殊配備' });
  add('bx-alu-roof', '鋁塑車廂加購　特殊屋凸＋前凸', 33000, { keep: 1, cab: '大單廂', req: ['bx-alu250', 'bx-alu260'], reqLabel: '鋁塑車廂', note: '車頭上方前凸造型空間；實際尺寸與重量依施工確認（約增加 700kg，不一定）' });
  add('bx-alu-door', '鋁塑車廂加購　主駕側單開門', 5000, { keep: 1, cab: '大單廂', req: ['bx-alu250', 'bx-alu260'], reqLabel: '鋁塑車廂', note: '副駕側單開門為標配' });
  add('bx-fridge', '冷凍冷藏箱', null, { note: '依箱體尺寸、使用溫層、冷凍機組、供電方式與施工規格報價' });
  add('bx-gull', '電動歐翼', null, { note: '依箱體尺寸、開啟方向、電動機構與施工規格報價' });
  add('bx-camper', '露營箱體', null, { note: '依箱體尺寸、內裝、水電配置與設備需求報價' });

  // 圖片 → 項目（同一項目出現在多張圖時，勾選會同步）
  var BY_IMG = {
    equip: ['safe', 'special', 'wheelsw'],
    lights: ['ledset', 'mirror-led', 'mirror-view', 'horn-mod', 'phone2'],
    package: ['pkg-dbl'], android: ['android123'], audio: ['audio'], tail: ['tail'], fog: ['fog'],
    gtr: ['gtr'],
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
    gps: ['gps'],
    'cfg-tailgate': ['tg-lift', 'tg-fold', 'tg-cyl2', 'tg-cyl4', 'tg-step', 'tg-remote'],
    'cfg-canvas': ['cv-std', 'cv-low', 'cv-high', 'cv-custom', 'cv-lift'],
    'cfg-box': ['bx-alu250', 'bx-alu260', 'bx-alu-roof', 'bx-alu-door', 'bx-fridge', 'bx-gull', 'bx-camper']
  };

  // ===== 狀態（只存在客人自己的手機）=====
  var KEY = 'kp-inq-saved'; // 只有客人按「儲存」才寫入這支手機；平常重新整理就是全新的
  var S = { cab: '', drive: '', sel: {}, name: '', phone: '', note: '' };
  try { localStorage.removeItem('kp-inq'); sessionStorage.removeItem('kp-inq'); } catch (e) {} // 舊版自動記住的勾選清掉
  var hadSaved = false;
  try { var old = JSON.parse(localStorage.getItem(KEY)); hadSaved = !!old; if (old && typeof old === 'object') { S.cab = CABS.indexOf(old.cab) >= 0 ? old.cab : ''; S.drive = DRIVES.indexOf(old.drive) >= 0 ? old.drive : ''; S.sel = old.sel && typeof old.sel === 'object' ? old.sel : {}; S.name = String(old.name || ''); S.phone = String(old.phone || ''); S.note = String(old.note || ''); } } catch (e) {}
  function persist() {} // 改動不自動存（保留呼叫點，方便辨識）
  function saveState() { try { localStorage.setItem(KEY, JSON.stringify(S)); return true; } catch (e) { return false; } }
  function resetAll() {
    var any = S.cab || S.drive || chosen().length || S.name || S.phone || S.note || hadSaved;
    if (any && !confirm('全部重置？選的車型、配件和已儲存的內容都會清掉。')) return;
    S = { cab: '', drive: '', sel: {}, name: '', phone: '', note: '' }; hadSaved = false;
    try { localStorage.removeItem(KEY); } catch (e) {}
    $('inqname').value = ''; $('inqphone').value = ''; $('inqnote').value = '';
    refresh(); closeSheet(); toast('已重置，重新開始');
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function priceOf(it) {
    if (it.optPrice) { var o = S.sel[it.id]; return typeof o === 'string' && it.optPrice[o] ? it.optPrice[o] : null; }
    return it.byCab ? (S.cab ? it.byCab[S.cab] : null) : it.p;
  }
  function minKnown(map) { var m = 0; Object.keys(map).forEach(function (k) { var v = map[k]; if (v && (!m || v < m)) m = v; }); return m; }
  function driveOk(d) { return !S.cab || !!(VPRICE[S.cab] && VPRICE[S.cab][d]); }
  function fitWarn(it) {
    if (it.req && !it.req.some(function (id) { return S.sel[id]; })) return '🔒 要先選上面的「' + (it.reqLabel || I[it.req[0]].n) + '」';
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
  var TAGS = { '單廂': '最經典 實用首選', '大單廂': '超大貨斗 工作效率更高', '雙廂': '載人載貨 兩用更彈性' };
  function minPrice(c) { var m = 0; Object.keys(VPRICE[c]).forEach(function (d) { var v = VPRICE[c][d]; if (!m || v < m) m = v; }); return m; }
  // 全額貸款 84 期概算月付（業務對客戶報價單用同一個概算，不顯示利率）
  function monthly(amount) { if (!amount) return 0; var r = 0.045 / 12, n = 84; return Math.round(amount * r / (1 - Math.pow(1 + r, -n))); }
  function total() { var t = 0; chosen().forEach(function (it) { var p = priceOf(it); if (p) t += p; }); return t; }
  function vehicleText() {
    if (!S.cab && !S.drive) return '';
    var s = (S.cab ? S.cab + ' ' + CAB_SUB[S.cab] : '') + (S.cab && S.drive ? '／' : '') + (S.drive || '');
    var v = S.cab && S.drive && VPRICE[S.cab] ? VPRICE[S.cab][S.drive] : null;
    return s + (v ? '（標價 ' + v + ' 萬）' : '');
  }
  // 詢價單只放品名：去掉結尾的說明括號（車廂別的烤漆除外）
  function plain(it) { return it.cab || it.keep ? it.n : it.n.replace(/（[^）]*）$/, ''); }
  function optText(it) { var o = S.sel[it.id]; return o && o !== true ? '（' + o + '）' : (it.opts ? '（' + it.optLabel + '：還沒選）' : ''); }

  // ===== 車型選擇面板 =====
  function chip(label, on, off, fn) {
    var b = el('button', 'chip' + (on ? ' on' : '') + (off ? ' off' : ''), label); b.type = 'button';
    if (off) b.disabled = true; else b.onclick = fn; return b;
  }
  function vehChips(box, withHead) {
    box.innerHTML = '';
    var card = withHead ? el('div', 'veh-card') : box;
    if (withHead) {
      card.appendChild(el('div', 'veh-h', '① 選你的車型（可略過）'));
      if (S.cab || S.drive || chosen().length) { var rb = el('button', 'rst', '↺ 重置'); rb.type = 'button'; rb.onclick = resetAll; card.appendChild(rb); }
      card.appendChild(el('div', 'veh-s', '選好車廂和驅動，馬上看到車價和月付；之後勾的配件也會一起算進去'));
    }
    var pick = function (c) { S.cab = S.cab === c ? '' : c; if (S.cab && S.drive && !driveOk(S.drive)) S.drive = ''; persist(); refresh(); };
    if (withHead) {
      var cg = el('div', 'cabs'); CABS.forEach(function (c) {
        var b = el('button', 'cabcard' + (S.cab === c ? ' on' : '')); b.type = 'button'; b.onclick = function () { pick(c); };
        b.appendChild(el('b', '', c)); b.appendChild(el('span', '', CAB_SUB[c])); b.appendChild(el('em', '', TAGS[c])); var dv = S.drive && VPRICE[c][S.drive] ? VPRICE[c][S.drive] : 0; var st = el('strong', '', ''); st.appendChild(el('small', '', '空車價')); var nu = el('span', 'nw', (dv || minPrice(c)) + ' 萬'); st.appendChild(nu); b.appendChild(st); b.appendChild(el('span', 'dv', dv ? S.drive : (Object.keys(VPRICE[c])[0] || '')));
        cg.appendChild(b);
      }); card.appendChild(cg);
    } else {
      var r1 = el('div', 'chips'); CABS.forEach(function (c) { r1.appendChild(chip(c + ' ' + CAB_SUB[c], S.cab === c, false, function () { pick(c); })); }); card.appendChild(r1);
    }
    var r2 = el('div', 'chips'); DRIVES.forEach(function (d) {
      r2.appendChild(chip(d, S.drive === d, !driveOk(d), function () { S.drive = S.drive === d ? '' : d; persist(); refresh(); }));
    }); card.appendChild(r2);
    var vt = vehicleText();
    if (withHead && vt) card.appendChild(el('div', 'veh-r', '你選的車：' + vt));
    if (withHead && vehPrice()) card.appendChild(el('div', 'veh-m', '全額貸款 84 期，月付約 ' + money(monthly(vehPrice())) + '（概算，實際依銀行核貸）'));
    if (withHead) box.appendChild(card);
  }
  function renderVeh() { var box = $('veh'); if (box) vehChips(box, true); }

  // ===== 圖片下面的勾選列 =====
  function attach(fig, imgKey) {
    var ids = BY_IMG[imgKey]; if (!ids) return;
    var wrap = el('div', 'items');
    wrap.appendChild(el('div', 'items-h', '想詢價就勾起來 👇'));
    ids.forEach(function (id) {
      var it = I[id]; var row = el('div', 'irow'); row.setAttribute('data-iid', id);
      var top = el('button', 'itop'); top.type = 'button';
      top.appendChild(el('span', 'box', '✓'));
      var mm = (!it.cab && !it.keep) ? it.n.match(/^(.*?)（([^）]{6,})）$/) : null;
      var nm = el('span', 'inm'); nm.appendChild(document.createTextNode(mm ? mm[1] : it.n));
      var tag = fitTag(it); if (tag) nm.appendChild(el('em', '', tag));
      if (mm) { nm.appendChild(el('br')); nm.appendChild(el('small', 'inote', mm[2])); }
      if (it.note) { nm.appendChild(el('br')); nm.appendChild(el('small', 'inote', it.note)); }
      top.appendChild(nm);
      top.appendChild(el('span', 'ipr', ''));
      top.setAttribute('role', 'checkbox'); top.setAttribute('aria-checked', 'false');
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
    var cap = fig.querySelector('figcaption'); if (cap) cap.appendChild(el('i', 'selc', ''));
  }
  function toggle(id) {
    if (S.sel[id]) delete S.sel[id]; else {
      S.sel[id] = true;
      if (I[id].grp) Object.keys(I).forEach(function (k) { if (k !== id && I[k].grp === I[id].grp) delete S.sel[k]; }); // 同組只能選一個（例：車廂室內高）
    }
    persist(); refresh();
  }

  function syncRows() {
    var rows = document.querySelectorAll('.irow');
    Array.prototype.forEach.call(rows, function (row) {
      var id = row.getAttribute('data-iid'), it = I[id], on = !!S.sel[id];
      var bad = !!fitWarn(it);
      row.classList.toggle('off', bad); row.querySelector('.itop').disabled = bad;
      row.classList.toggle('on', on);
      row.querySelector('.itop').setAttribute('aria-checked', on ? 'true' : 'false');
      var p = priceOf(it), pr = row.querySelector('.ipr');
      if (it.byCab && !S.cab) pr.textContent = money(minKnown(it.byCab)) + ' 起';
      else if (it.optPrice && typeof S.sel[id] !== 'string') pr.textContent = money(minKnown(it.optPrice)) + ' 起';
      else pr.textContent = p ? money(p) : '價格請洽業務';
      pr.classList.toggle('ask', !p);
      var w = row.querySelector('.iwarn'), msg = fitWarn(it); w.textContent = msg.replace('⚠ ', '⛔ 不適用：'); w.style.display = msg ? 'block' : 'none';
      var oc = row.querySelector('.iopts');
      if (oc) { oc.style.display = on ? 'flex' : 'none'; Array.prototype.forEach.call(oc.querySelectorAll('button'), function (b) { b.classList.toggle('on', S.sel[id] === b.getAttribute('data-o')); }); }
    });
  }

  var vbars = [];
  function vbar(sec, go) {
    var d = el('div', 'vbar'); var t = el('span', ''); var b = el('button', '', '更改'); b.type = 'button'; b.onclick = go;
    d.appendChild(t); d.appendChild(b); sec.appendChild(d); vbars.push({ t: t, b: b });
  }
  function syncVbars() {
    vbars.forEach(function (v) {
      var has = S.cab || S.drive;
      v.t.textContent = has ? '🚚 你的車：' + (S.cab || '車廂未選') + '／' + (S.drive || '驅動未選') : '🚚 還沒選車型（可略過）';
      v.b.textContent = has ? '更改' : '去選車型 ›';
    });
  }
  function syncCounts() {
    syncVbars();
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) {
      var pane = document.getElementById(a.getAttribute('data-t')); if (!pane) return;
      var n = pane.querySelectorAll('.irow.on').length, b = a.querySelector('.tc');
      if (!b) { b = el('b', 'tc', ''); a.appendChild(b); }
      b.textContent = n; b.classList.toggle('on', n > 0);
    });
    Array.prototype.forEach.call(document.querySelectorAll('figure.card'), function (f) {
      var c = f.querySelector('.selc'); if (!c) return;
      var n = f.querySelectorAll('.irow.on').length;
      c.textContent = '已選 ' + n; c.classList.toggle('on', n > 0);
    });
  }
  // ===== 底部「詢價單」按鈕 =====
  function syncBar() {
    var bar = $('inqbar'); if (!bar) return;
    var n = chosen().length;
    bar.style.display = n ? 'flex' : 'none';
    document.body.classList.toggle('has-inq', n > 0);
    if (n) { var mo = vehPrice() ? monthly(grand()) : 0; $('inqv').textContent = (S.cab || S.drive ? (S.cab || '車廂未選') + '／' + (S.drive || '驅動未選') : '還沒選車型（可略過）') + (mo ? '・月付約 ' + money(mo) : ''); $('inqn').textContent = n + ' 項'; var t = total(); var g = grand(); $('inqt').textContent = g ? (vehPrice() ? '車＋配件 ' : '配件 ') + money(g) : ''; }
  }

  // 換車型後，不適用的配件自動取消勾選並提醒
  function prune() {
    var gone = [];
    Object.keys(S.sel).forEach(function (id) { var it = I[id]; if (it && fitWarn(it)) { delete S.sel[id]; gone.push(plain(it)); } });
    if (gone.length) toast('已取消不適用的配件：' + gone.join('、'));
  }
  function refresh() { prune(); renderVeh(); syncRows(); syncCounts(); syncBar(); if ($('inqsheet').style.display === 'flex') renderSheet(); }

  // ===== 詢價單視窗 =====
  function buildText() {
    var L = ['【詢價單】'];
    if (S.name.trim()) L.push('稱呼：' + S.name.trim());
    if (S.phone.trim()) L.push('電話：' + S.phone.trim());
    var vt = vehicleText(); L.push('車型：' + (vt || '還沒決定'));
    L.push('', '想詢價的配件：');
    chosen().forEach(function (it, i) {
      var p = priceOf(it);
      L.push((i + 1) + '. ' + plain(it) + optText(it) + '　' + (p ? money(p) : (it.byCab ? '（價格依車廂，請報價）' : '（請報價）')));
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
      var left = el('div', 'sl'); left.appendChild(el('b', '', plain(it) + optText(it)));
      var w = fitWarn(it); if (w) left.appendChild(el('small', 'warn', w));
      if (it.opts) {
        var oc = el('div', 'sopts');
        it.opts.forEach(function (o) { var b = el('button', 'chip s' + (S.sel[it.id] === o ? ' on' : ''), o); b.type = 'button'; b.onclick = function () { S.sel[it.id] = o; persist(); refresh(); }; oc.appendChild(b); });
        left.appendChild(oc);
      }
      r.appendChild(left);
      var p = priceOf(it); r.appendChild(el('span', 'sp', p ? money(p) : (it.byCab ? '依車廂' : (it.optPrice ? '先選尺寸' : '請報價'))));
      var x = el('button', 'sx', '✕'); x.type = 'button'; x.setAttribute('aria-label', '移除'); x.onclick = function () { delete S.sel[it.id]; persist(); refresh(); if (!chosen().length) closeSheet(); };
      r.appendChild(x); list.appendChild(r);
    });
    $('inqveh').textContent = ''; vehChips($('inqvehbox'), false);
    var t = total(), vp = vehPrice(); var h = '';
    if (vp) h += '車價 ' + money(vp) + '\n';
    if (t) h += '配件合計 ' + money(t) + '\n';
    if (vp && t) h += '車＋配件 ' + money(vp + t);
    $('inqtot').textContent = h.replace(/\n$/, '');
    var mo = vp ? monthly(vp + t) : 0; $('inqmo').textContent = mo ? '全額貸款 84 期，月付約 ' + money(mo) + '（概算，實際依銀行核貸為準）' : '';
    $('inqprev').style.display = 'none';
  }
  function openSheet() { $('inqname').value = S.name; $('inqphone').value = S.phone; $('inqnote').value = S.note; $('inqsheet').style.display = 'flex'; document.body.style.overflow = 'hidden'; renderSheet(); }
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
      return { lines: wrap(plain(it) + optText(it), '600 26px ' + FONT, W - pad * 2 - 190), price: p ? money(p) : (it.byCab ? '依車廂' : '請報價'), warn: fitWarn(it) };
    });
    var noteLines = S.note.trim() ? wrap('備註：' + S.note.trim(), '24px ' + FONT, W - pad * 2) : [];
    var H = 210 + 56 + (S.phone.trim() ? 40 : 0);
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
    if (S.phone.trim()) { g.fillText('電話：' + S.phone.trim(), pad, y); y += 40; }
    var vt = vehicleText(); g.fillText('車型：' + (vt || '還沒決定'), pad, y); y += 30;
    g.strokeStyle = '#ebe0d0'; g.lineWidth = 2; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke(); y += 40;
    rows.forEach(function (r, ri) {
      g.fillStyle = '#2f2a25'; g.font = '600 26px ' + FONT;
      r.lines.forEach(function (ln, i) { g.fillText((i ? '　　' : (ri + 1) + '. ') + ln, pad, y + i * 36); });
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
    prune(); renderVeh(); syncRows(); syncCounts(); syncBar();
    $('inqbar').onclick = openSheet;
    $('inqclose').onclick = closeSheet;
    $('inqsheet').onclick = function (e) { if (e.target === this) closeSheet(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('inqsheet').style.display === 'flex') closeSheet(); });
    function flash(btn, t) { var o = btn.getAttribute('data-o') || btn.textContent; btn.setAttribute('data-o', o); btn.textContent = t; clearTimeout(btn._h); btn._h = setTimeout(function () { btn.textContent = o; }, 2200); }
    $('inqname').oninput = function () { S.name = this.value; persist(); };
    $('inqphone').oninput = function () { S.phone = this.value; persist(); };
    $('inqnote').oninput = function () { S.note = this.value; persist(); };
    $('inqcopy').onclick = function () { var b = this; copyText(buildText(), function () { flash(b, '✓ 已複製'); toast('已複製，貼到 LINE 傳給我就好'); }); };
    $('inqline').onclick = function () { var b = this; copyText(buildText(), function () { flash(b, '✓ 已複製，正在開 LINE…'); toast('已複製，貼上後傳送'); setTimeout(function () { window.open('https://line.me/ti/p/Mrn4VCwGTv', '_blank'); }, 600); }); };
    $('inqimg').onclick = saveImage;
    $('inqreset').onclick = resetAll;
    $('inqsave').onclick = function () { var b = this; if (saveState()) { hadSaved = true; flash(b, '✓ 已儲存'); toast('已儲存在這支手機，下次打開還在'); } else toast('這個瀏覽器無法儲存'); };
  }

  window.KPInq = { attach: attach, vbar: vbar, sync: function () { renderVeh(); syncRows(); syncCounts(); syncBar(); }, init: init, has: function (k) { return !!BY_IMG[k]; } };
})();
