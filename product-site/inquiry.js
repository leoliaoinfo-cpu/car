// 詢價單：客人在產品圖下面勾選想問的配件、選車型，彙整成 LINE 文字或圖片傳給業務。
// 全部在客人手機瀏覽器內完成，不連任何伺服器、不收集資料。
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // ===== 車型與售價（來自「K2500 車型售價表」，單位：萬）=====
  var CABS = ['單廂', '大單廂', '雙廂'];
  var CAB_SUB = { '單廂': '3人座', '大單廂': '3人座', '雙廂': '6人座' };
  var DRIVES = ['2WD 手排', '2WD 自排', '4WD 手排'];
  // 給客人看的白話名稱（資料用的 key 不變）
  var DL = { '2WD 手排': '二輪驅動・手排', '2WD 自排': '二輪驅動・自排', '4WD 手排': '四輪驅動・手排' };
  function dl(d) { return DL[d] || d || ''; }
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
  add('paint-s', '車身烤漆改色（單廂）', 36000, { cab: '單廂', note: '顏色請洽業務，使用烤漆爐烘烤' });
  add('paint-l', '車身烤漆改色（大單廂）', 37000, { cab: '大單廂', note: '顏色請洽業務，使用烤漆爐烘烤' });
  add('paint-d', '車身烤漆改色（雙廂）', 39000, { cab: '雙廂', note: '顏色請洽業務，使用烤漆爐烘烤' });
  add('paint-matte', '消光漆／珍珠漆工法', 8000, { keep: 1, note: '加價項目；消光霧面(30度)為雙層消光漆' });
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
  add('skid4wd', '四輪驅動專用鋁合金下護板', 12500, { fit: '4WD' });
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
  add('puddle', 'LED 側邊照地燈', 2490, { note: '二輪驅動 43cm／四輪驅動 50cm' });
  add('phone-grip', '手把手機支架', 1280);
  add('cup-dbl', '雙廂置杯收納架', 389, { fit: '雙廂' });
  add('pedal', '鋁合金腳踏板（油門＋煞車）', 1880, { fit: '自排' });
  add('cup-pad', '置杯架防滑墊', 1190);
  add('opener', '安全帶造型開瓶器', 890);
  add('gps', '4G GPS 車輛定位器（A18）', 9900, { note: '4G 網卡贈送 2 年，GPS 車機永久保固' });

  // ===== 尾門／帆布／車廂體（規格與價格取自業務系統的報價選單；不含任何成本）=====
  add('tg-lift', '升降尾門', null, { keep: 1, optLabel: '尺寸', opts: ['2.5尺', '3尺', '3.5尺', '4尺', '4.5尺', '5尺', '5.5尺', '6尺特規'], optPrice: { '2.5尺': 37000, '3尺': 40000, '3.5尺': 40000, '4尺': 43000, '4.5尺': 43000, '5尺': 48000, '5.5尺': 48000, '6尺特規': null }, note: '選尺寸；再選下面的油壓缸與配件' });
  add('tg-fold', '雙折尾門', null, { keep: 1, optLabel: '尺寸', opts: ['3.5尺', '4尺', '4.5尺', '5尺', '5.5尺', '6尺特規'], optPrice: { '3.5尺': 40000, '4尺': 43000, '4.5尺': 43000, '5尺': 48000, '5.5尺': 48000, '6尺特規': null }, note: '單折／雙折同尺寸同價；實際承重與施工規格需確認' });
  add('tg-cyl2', '雙缸油壓缸（800～1,000kg）', 8000, { req: ['tg-lift'], note: '搭配升降尾門；實際承重依車型、平台與施工內容確認' });
  add('tg-cyl4', '四缸油壓缸（約1,200kg 特製規格）', null, { req: ['tg-lift'], note: '需確認載重、平台尺寸與車體後報價' });
  add('tg-step', '尾門腳踏', 1000, { req: ['tg-lift'], note: '升降尾門用輔助腳踏' });
  add('tg-remote', '尾門遙控', 2000, { req: ['tg-lift'], note: '升降尾門遙控操作' });
  add('bd-air', '貨車導流板', null, { keep: 1 });
  add('bd-h1', 'H架（一支）', null, { keep: 1 });
  add('bd-h2', 'H架（兩支一組）', null, { keep: 1 });
  add('fl-rub-full', '貨斗橡膠墊－全封', null, { keep: 1 });
  add('fl-rub-bottom', '貨斗橡膠墊－只鋪底面', null, { keep: 1 });
  add('fl-galv', '錏花板（鍍鋅鐵板）　台語：灰板（花紋的）', null, { keep: 1 });
  add('fl-galv-flat', '錏花平板（鍍鋅鋼板）　台語：灰板（沒花紋的）', null, { keep: 1 });
  add('fl-stainless', '貨斗白鐵底板', null, { keep: 1 });
  var CV = { '單廂': 0, '大單廂': 0, '雙廂': 0 };
  function cvp(a, b) { return { '單廂': a, '大單廂': a, '雙廂': b }; }
  add('cv-std', '三面帆布　標準高　斗上約 148cm', null, { keep: 1, grp: 'canvas', byCab: cvp(19500, 14500), note: '實際高度及二輪／四輪驅動適用性於施工前確認' });
  add('cv-low', '三面帆布　降低版　最低斗上約 130cm', null, { keep: 1, grp: 'canvas', byCab: cvp(20500, 15500), note: '平頂、不修改原有頭立；實際適用性於施工前確認' });
  add('cv-high', '三面帆布　加高 1 台尺　斗上約 178cm', null, { keep: 1, grp: 'canvas', byCab: cvp(23000, 18500), note: '標準高再增加約 30.3cm；實際完工高度於施工前確認' });
  add('cv-five', '五面帆布', null, { keep: 1, grp: 'canvas', fit: '單廂' });
  add('cv-custom', '特殊訂製帆布', null, { grp: 'canvas', note: '特殊高度、材質、開門方式或施工內容，另向廠商詢價' });
  add('cv-lift', '升降帆布', null, { optLabel: '高度', opts: ['降低（平車頭）高 195cm、升 80cm、斗內高 110–195cm', '更高版：降 235cm、升 90cm、斗內高 150–240cm'], optPrice: { '降低（平車頭）高 195cm、升 80cm、斗內高 110–195cm': null, '更高版：降 235cm、升 90cm、斗內高 150–240cm': null } });
  add('cv-lift-color', '升降帆布選配　帆布換色', null, { req: ['cv-lift'], reqLabel: '升降帆布', optLabel: '顏色', opts: ['黑', '灰'] });
  add('cv-lift-light', '升降帆布選配　室內燈（4盞含開關）', null, { req: ['cv-lift'], reqLabel: '升降帆布' });
  add('cv-lift-chain', '升降帆布選配　鍊目', null, { req: ['cv-lift'], reqLabel: '升降帆布' });
  add('cv-lift-reg', '升降帆布選配　代辦變更', null, { req: ['cv-lift'], reqLabel: '升降帆布' });
  add('bx-alu250', '鋁塑車廂　大單廂 9.7 尺　室內高 2.5 米', 81000, { keep: 1, cab: '大單廂', grp: 'alu-h', note: '含鋁塑牆板、室內 LED 燈、後門雙開、副駕側單開門；不含尾門、截樑、監理站變更及其他特殊配備' });
  add('bx-alu260', '鋁塑車廂　大單廂 9.7 尺　室內高 2.6 米', 84000, { keep: 1, cab: '大單廂', grp: 'alu-h', note: '含鋁塑牆板、室內 LED 燈、後門雙開、副駕側單開門；不含尾門、截樑、監理站變更及其他特殊配備' });
  add('bx-alu-roof', '鋁塑車廂加購　特殊屋凸＋前凸', 33000, { keep: 1, cab: '大單廂', req: ['bx-alu250', 'bx-alu260'], reqLabel: '鋁塑車廂', note: '車頭上方前凸造型空間；實際尺寸與重量依施工確認（約增加 700kg，不一定）' });
  add('bx-alu-door', '鋁塑車廂加購　主駕側單開門', 5000, { keep: 1, cab: '大單廂', req: ['bx-alu250', 'bx-alu260'], reqLabel: '鋁塑車廂', note: '副駕側單開門為標配' });
  add('bx-fridge', '冷凍冷藏箱', null, { note: '依箱體尺寸、使用溫層、冷凍機組、供電方式與施工規格報價' });
  add('bx-gull', '電動歐翼', null, { note: '依箱體尺寸、開啟方向、電動機構與施工規格報價' });
  add('bx-camper', '露營箱體', null, { note: '依箱體尺寸、內裝、水電配置與設備需求報價' });

  // 尾門／帆布／箱體：價格會跟著廠商成本調整，網頁一律不放價格，只選規格，由業務報價
  Object.keys(I).forEach(function (k) { if (k.indexOf('tg-') === 0 || k.indexOf('cv-') === 0 || k.indexOf('bx-') === 0 || k.indexOf('bd-') === 0 || k.indexOf('fl-') === 0) { var it = I[k]; it.ask = true; it.p = null; delete it.byCab; if (it.optPrice) Object.keys(it.optPrice).forEach(function (o) { it.optPrice[o] = null; }); } });
  function askCount() { return chosen().filter(function (it) { return it.ask; }).length; }
  function hasAsk() { return askCount() > 0; }
  function askNote() { return total() ? '＊另有 ' + askCount() + ' 項待報價項目，由業務依規格報價，不含在上方合計內' : '＊待報價項目共 ' + askCount() + ' 項，價格由業務依規格報價'; }
  function basementText() { return S.basement === 'yes' ? '有' : S.basement === 'no' ? '沒有' : ''; }
  // 要選尺寸的項目（尾門）多一個「不確定，跟業務討論」，價格改成討論後報價
  var DISCUSS = '不確定，跟業務討論';
  Object.keys(I).forEach(function (k) { var it = I[k]; if (it.optPrice) { it.opts = it.opts.concat([DISCUSS]); } });
  function discussing(it) { return !!it.optPrice && S.sel[it.id] === DISCUSS; }
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
    'cfg-canvas': ['cv-std', 'cv-low', 'cv-high', 'cv-five', 'cv-custom', 'cv-lift', 'cv-lift-color', 'cv-lift-light', 'cv-lift-chain', 'cv-lift-reg'],
    'cfg-body': ['bd-air', 'bd-h1', 'bd-h2'],
    'cfg-floor': ['fl-rub-full', 'fl-rub-bottom', 'fl-galv', 'fl-galv-flat', 'fl-stainless'],
    'cfg-box': ['bx-alu250', 'bx-alu260', 'bx-alu-roof', 'bx-alu-door', 'bx-fridge', 'bx-gull', 'bx-camper']
  };

  // ===== 狀態（只存在客人自己的手機）=====
  // LINE：業務的加好友連結。若業務是「LINE 官方帳號」，把 @ID 填到 LINE_OA_ID，詢價單就能直接帶進與業務的聊天室（客人只要按送出）；
  // 個人帳號沒有這種功能，只能打開 LINE「分享」畫面並帶入文字，客人再選業務按送出。
  var LINE_ADD_URL = 'https://line.me/ti/p/Mrn4VCwGTv';
  var LINE_OA_ID = '';
  function lineSendUrl(txt) {
    return LINE_OA_ID ? 'https://line.me/R/oaMessage/' + encodeURIComponent(LINE_OA_ID) + '/?' + encodeURIComponent(txt)
      : 'https://line.me/R/share?text=' + encodeURIComponent(txt);
  }
  var KEY = 'kp-inq-saved'; // 只有客人按「儲存」才寫入這支手機；平常重新整理就是全新的
  var S = { path: '', own: false, cab: '', drive: '', sel: {}, name: '', phone: '', note: '', basement: '' };
  try { localStorage.removeItem('kp-inq'); sessionStorage.removeItem('kp-inq'); } catch (e) {} // 舊版自動記住的勾選清掉
  var hadSaved = false;
  try { var old = JSON.parse(localStorage.getItem(KEY)); hadSaved = !!old; if (old && typeof old === 'object') { S.own = !!old.own; S.path = old.path === 'buy' || old.path === 'own' ? old.path : ''; S.pkgBackup = old.pkgBackup && typeof old.pkgBackup === 'object' ? old.pkgBackup : null; S.cab = CABS.indexOf(old.cab) >= 0 ? old.cab : ''; S.drive = DRIVES.indexOf(old.drive) >= 0 ? old.drive : ''; S.sel = old.sel && typeof old.sel === 'object' ? old.sel : {}; S.name = String(old.name || ''); S.basement = old.basement === 'yes' || old.basement === 'no' ? old.basement : ''; S.phone = String(old.phone || ''); S.note = String(old.note || ''); } } catch (e) {}
  if (!S.path && (S.own || S.cab || S.drive)) S.path = S.own ? 'own' : 'buy';
  function persist() {} // 改動不自動存（保留呼叫點，方便辨識）
  function saveState() { try { localStorage.setItem(KEY, JSON.stringify(S)); return true; } catch (e) { return false; } }
  function resetAll() {
    var any = S.cab || S.drive || S.basement || chosen().length || S.name || S.phone || S.note || hadSaved;
    if (any && !confirm('全部重置？選的車型、配件和已儲存的內容都會清掉。')) return;
    S = { own: false, path: '', cab: '', drive: '', sel: {}, name: '', phone: '', note: '', basement: '', pkgBackup: null }; hadSaved = false; promoDone = false;
    try { localStorage.removeItem(KEY); } catch (e) {}
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
    if (f === '2WD' || f === '4WD') { if (S.drive && S.drive.indexOf(f) !== 0) return '⚠ 這項只適用' + (f === '2WD' ? '二輪驅動' : '四輪驅動') + '，你選的是' + (S.drive.indexOf('4WD') === 0 ? '四輪驅動' : '二輪驅動'); return ''; }
    if (f === '自排') { if (S.drive && S.drive.indexOf('自排') < 0) return '⚠ 這項只適用自排車，你選的是手排車'; return ''; }
    if (f === '單廂') { if (S.cab === '雙廂') return '⚠ 適用單廂／大單廂，你選的是雙廂'; return ''; }
    if (f === '雙廂') { if (S.cab && S.cab !== '雙廂') return '⚠ 雙廂專用，你選的是' + S.cab; return ''; }
    return '';
  }
  function fitTag(it) {
    if (!it.fit) return '';
    return { '2WD': '二輪驅動適用', '4WD': '四輪驅動適用', '自排': '自排車專用', '單廂': '單廂／大單廂適用', '雙廂': '雙廂專用' }[it.fit] || '';
  }

  function chosen() { return Object.keys(S.sel).filter(function (id) { return I[id]; }).map(function (id) { return I[id]; }); }
  function vehPrice() { if (S.own) return 0; var v = S.cab && S.drive && VPRICE[S.cab] ? VPRICE[S.cab][S.drive] : null; return v ? Math.round(v * 10000) : 0; }
  function grand() { return vehPrice() + total(); }
  var TAGS = { '單廂': '最經典 實用首選', '大單廂': '超大貨斗 工作效率更高', '雙廂': '載人載貨 兩用更彈性' };
  function minPrice(c) { var m = 0; Object.keys(VPRICE[c]).forEach(function (d) { var v = VPRICE[c][d]; if (!m || v < m) m = v; }); return m; }
  // 全額貸款 84 期概算月付（業務對客戶報價單用同一個概算，不顯示利率）
  // 84 期月付概算：依貸款專案表 B（低利率）84 期的對照，每貸 1 萬約 141.34 元（50 萬＝7,067、100 萬＝14,134、140 萬＝19,788，成正比）；取到百位，當「大概金額」
  function monthly(amount) { if (!amount) return 0; return Math.round(amount / 10000 * 141.34 / 100) * 100; }
  function total() { var t = 0; chosen().forEach(function (it) { var p = priceOf(it); if (p) t += p; }); return t; }
  function vehicleText() {
    if (S.own) return '我已有車，只想改裝' + (S.cab || S.drive ? '（' + [S.cab, dl(S.drive)].filter(Boolean).join('／') + '）' : '');
    if (!S.cab && !S.drive) return '';
    var s = (S.cab ? S.cab + ' ' + CAB_SUB[S.cab] : '') + (S.cab && S.drive ? '／' : '') + dl(S.drive);
    var v = S.cab && S.drive && VPRICE[S.cab] ? VPRICE[S.cab][S.drive] : null;
    return s + (v ? '（標價 ' + v + ' 萬）' : '');
  }
  // 詢價單只放品名：去掉結尾的說明括號（車廂別的烤漆除外）
  function plain(it) { return it.cab || it.keep ? it.n : it.n.replace(/（[^）]*）$/, ''); }
  function optText(it) { var o = S.sel[it.id]; return o && o !== true ? (it.optPrice && o === '不確定，跟業務討論' ? '（' + it.optLabel + '：還不確定，想跟業務討論）' : '（' + o + '）') : (it.opts ? '（' + it.optLabel + '：還沒選）' : ''); }

  // ===== 車型選擇面板 =====
  function chip(label, on, off, fn) {
    var b = el('button', 'chip' + (on ? ' on' : '') + (off ? ' off' : ''), label); b.type = 'button';
    if (off) b.disabled = true; else b.onclick = fn; return b;
  }
  function cabOk(c) { return !S.drive || !!(VPRICE[c] && VPRICE[c][S.drive]); }
  function setPath(own) { S.own = own; S.path = own ? 'own' : 'buy'; }
  function vehChips(box, withHead) {
    box.innerHTML = '';
    var card = withHead ? el('div', 'veh-card') : box;
    var pickDrive = function (d) { if (!S.path) setPath(S.own); S.drive = S.drive === d ? '' : d; if (S.cab && S.drive && !cabOk(S.cab)) S.cab = ''; persist(); refresh(); };
    var pickCab = function (c) { if (!S.path) setPath(S.own); S.cab = S.cab === c ? '' : c; persist(); refresh(); };
    if (withHead && !S.path) { // 還沒選「買車／只改裝」：先只問這一題
      card.appendChild(el('div', 'veh-h', '你想做什麼？'));
      var pg = el('div', 'paths pgate');
      [[false, 'pg-buy', '我要買新車', '選車型、算車價'], [true, 'pg-own', '我已經有車', '只想改裝']].forEach(function (o) {
        var gb = el('button', o[1]); gb.type = 'button'; gb.appendChild(el('b', '', o[2])); gb.appendChild(el('span', '', o[3]));
        gb.onclick = function () { setPath(o[0]); refresh(); }; pg.appendChild(gb);
      });
      card.appendChild(pg); box.appendChild(card); return;
    }
    if (withHead) {
      card.appendChild(el('div', 'veh-h', S.own ? '① 你的車是哪一種？（不確定可以跳過）' : '① 你想買哪一種車？'));
      if (S.own || S.cab || S.drive || chosen().length) { var rb = el('button', 'rst', '↺ 重置'); rb.type = 'button'; rb.onclick = resetAll; card.appendChild(rb); }
      var ch = el('button', 'pchg', (S.own ? '只想改裝' : '買新車') + ' ✎'); ch.type = 'button'; ch.onclick = function () { S.path = ''; S.own = false; refresh(); }; card.appendChild(ch);
    }
    var showCab = S.own || S.drive || S.cab;
    var dq = el('div', 'veh-q', withHead ? '先選：車子怎麼開、幾個輪子有動力' : ''); if (withHead) card.appendChild(dq);
    var r2 = el('div', 'chips'); DRIVES.forEach(function (d) {
      r2.appendChild(chip(dl(d), S.drive === d, false, function () { pickDrive(d); }));
    }); card.appendChild(r2);
    if (withHead) {
      if (showCab) {
        card.appendChild(el('div', 'veh-q', '再選：車廂種類'));
        var cg = el('div', 'cabs'); CABS.forEach(function (c) {
          var ok = cabOk(c);
          var b = el('button', 'cabcard' + (S.cab === c ? ' on' : '') + (ok ? '' : ' off')); b.type = 'button'; if (ok) b.onclick = function () { pickCab(c); }; else b.disabled = true;
          b.appendChild(el('b', '', c)); b.appendChild(el('span', '', CAB_SUB[c]));
          if (!S.own) {
            var dv = S.drive && VPRICE[c][S.drive] ? VPRICE[c][S.drive] : 0;
            if (ok) { var st = el('strong', '', ''); st.appendChild(el('small', '', '空車價')); st.appendChild(el('span', 'nw', (dv || minPrice(c)) + ' 萬')); b.appendChild(st); b.appendChild(el('span', 'dv', dv ? dl(S.drive) : (Object.keys(VPRICE[c])[0] ? dl(Object.keys(VPRICE[c])[0]) : ''))); }
            else b.appendChild(el('span', 'dv', '這種驅動沒有'));
          }
          cg.appendChild(b);
        }); card.appendChild(cg);
      }
    } else {
      var r1 = el('div', 'chips'); CABS.forEach(function (c) { r1.appendChild(chip(c + ' ' + CAB_SUB[c], S.cab === c, !cabOk(c), function () { pickCab(c); })); }); card.appendChild(r1);
    }
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
      if (id === 'pkg-dbl') {
        var rr = el('div', 'irest'); var rb2 = el('button', '', '↩ 改回我原本選的配件'); rb2.type = 'button'; rb2.onclick = restorePkg; rr.appendChild(rb2); row.appendChild(rr);
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

  function basementBox() {
    var f = el('figure', 'card cfg'); var cc = el('figcaption'); cc.appendChild(el('span', '', '是否有下地下室的需求？')); f.appendChild(cc);
    var w = el('div', 'bsm'); w.style.cssText = 'display:flex;gap:10px;padding:12px 14px 16px';
    [['yes', '有'], ['no', '沒有']].forEach(function (o) {
      var b = el('button', 'chip s', o[1]); b.type = 'button'; b.style.cssText = 'font-size:16px;padding:12px 30px'; b.setAttribute('data-b', o[0]); 
      b.onclick = function () { S.basement = S.basement === o[0] ? '' : o[0]; persist(); refresh(); };
      w.appendChild(b);
    });
    f.appendChild(w); return f;
  }
  function syncBasement() { Array.prototype.forEach.call(document.querySelectorAll('.bsm button'), function (b) { b.classList.toggle('on', S.basement === b.getAttribute('data-b')); }); }
  function syncRows() {
    syncBasement();
    var rows = document.querySelectorAll('.irow');
    Array.prototype.forEach.call(rows, function (row) {
      var id = row.getAttribute('data-iid'), it = I[id], on = !!S.sel[id];
      var bad = !!fitWarn(it);
      row.classList.toggle('off', bad); row.querySelector('.itop').disabled = bad;
      row.classList.toggle('on', on);
      row.querySelector('.itop').setAttribute('aria-checked', on ? 'true' : 'false');
      var p = priceOf(it), pr = row.querySelector('.ipr');
      if (it.byCab && !S.cab) pr.textContent = money(minKnown(it.byCab)) + ' 起';
      else if (it.optPrice && !it.ask && typeof S.sel[id] !== 'string') pr.textContent = money(minKnown(it.optPrice)) + ' 起';
      else pr.textContent = p ? money(p) : '價格請洽業務';
      pr.classList.toggle('ask', !p);
      var w = row.querySelector('.iwarn'), msg = fitWarn(it); w.textContent = msg.replace('⚠ ', '⛔ 不適用：'); w.style.display = msg ? 'block' : 'none';
      var rs = row.querySelector('.irest'); if (rs) rs.style.display = on && S.pkgBackup ? 'block' : 'none';
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
      var has = S.own || S.cab || S.drive;
      v.t.textContent = S.own ? '🔧 ' + vehicleText() : has ? '🚚 你的車：' + (S.cab || '車廂未選') + '／' + (dl(S.drive) || '驅動未選') : '🚚 還沒選車型（可略過）';
      v.b.textContent = has ? '更改' : '去選車型 ›';
    });
  }
  function syncPath() { var b = $('pathBuy'), o = $('pathOwn'); if (b) b.classList.toggle('on', S.path === 'buy'); if (o) o.classList.toggle('on', S.path === 'own'); }
  function choosePath(own) { S.own = own; S.path = own ? 'own' : 'buy'; refresh(); if (window.KPGotoVeh) KPGotoVeh(); }
  function syncCounts() {
    syncVbars(); syncPath();
    Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (pn) {
      var cs = pn.querySelector('.catsum'); if (!cs) return;
      var n = 0, t = 0;
      Array.prototype.forEach.call(pn.querySelectorAll('.irow.on'), function (r) { var it = I[r.getAttribute('data-iid')]; if (!it) return; n++; var pr = priceOf(it); if (pr) t += pr; });
      cs.classList.toggle('on', n > 0);
      cs.innerHTML = ''; if (n > 0) { cs.appendChild(el('span', '', '這一類你選了 ' + n + ' 項')); cs.appendChild(el('b', '', t ? money(t) : '洽業務報價')); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) {
      var pane = document.getElementById(a.getAttribute('data-t')); if (!pane) return;
      var n = a.getAttribute('data-t') === 'sum' ? chosen().length : pane.querySelectorAll('.irow.on').length, b = a.querySelector('.tc');
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
    if (n) {
      var mo = vehPrice() ? monthly(grand()) : 0;
      $('inqv').textContent = (S.own ? vehicleText() : S.cab || S.drive ? (S.cab || '車廂未選') + '／' + (dl(S.drive) || '驅動未選') : '還沒選車型（可略過）') + (mo ? '・月付約 ' + money(mo) : (S.own ? '・一次付清' : ''));
      $('inqn').textContent = '已選 ' + n + ' 項';
      var g2 = grand(); $('inqtl').textContent = (vehPrice() ? '車＋' : '') + (hasAsk() && total() ? '配件共（不含待報價）' : '配件共'); $('inqt').textContent = g2 ? money(g2) : '洽業務報價';
    }
  }

  // 換車型後，不適用的配件自動取消勾選並提醒
  function prune() {
    var gone = [];
    Object.keys(S.sel).forEach(function (id) { var it = I[id]; if (it && fitWarn(it)) { delete S.sel[id]; gone.push(plain(it)); } });
    if (gone.length) toast('已取消不適用的配件：' + gone.join('、'));
  }
  // ===== 雙廂高階套裝推薦：選了雙廂＋二輪驅動，且已選的配件裡「套裝涵蓋的項目」合計 ≥ 20 萬才跳提醒；客人按了才換，換了可以一鍵改回 =====
  var PKG_COVERS = ['special', 'wheelsw', 'safe', 'mirror-led', 'gtr', 'fog', 'ts', 'audio', 'side-step', 'travel', 'urea', 'phone2', 'omega', 'tail', 'puddle', 'aero-chin'];
  var PKG_THRESHOLD = 200000, promoDone = false;
  function pkgEligible() { return S.cab === '雙廂' && S.drive.indexOf('2WD') === 0; }
  function coveredSelected() { return PKG_COVERS.filter(function (id) { return S.sel[id]; }); }
  function coveredTotal() { var t = 0; coveredSelected().forEach(function (id) { var p = priceOf(I[id]); if (p) t += p; }); return t; }
  function checkPromo() {
    if (promoDone || S.sel['pkg-dbl'] || !pkgEligible()) return;
    var t = coveredTotal(); if (t < PKG_THRESHOLD) return;
    promoDone = true;
    $('promoN').textContent = coveredSelected().length;
    $('promoT').textContent = money(t);
    $('promo').style.display = 'flex';
  }
  function takePkg() {
    var bk = {}; coveredSelected().forEach(function (id) { bk[id] = S.sel[id]; delete S.sel[id]; });
    S.pkgBackup = bk; S.sel['pkg-dbl'] = true; $('promo').style.display = 'none';
    refresh(); toast('已換成雙廂高階套裝。尾門、帆布等套裝沒包含的項目都還在');
  }
  function restorePkg() {
    delete S.sel['pkg-dbl'];
    if (S.pkgBackup) Object.keys(S.pkgBackup).forEach(function (id) { S.sel[id] = S.pkgBackup[id]; });
    S.pkgBackup = null; promoDone = true; refresh(); toast('已改回你原本選的配件');
  }
  function refresh() { prune(); checkPromo(); renderVeh(); syncRows(); syncCounts(); syncBar(); if ($('sum').classList.contains('on')) renderSheet(); }

  // ===== 詢價單視窗 =====
  function buildText() {
    var L = ['【詢價單】'];
    if (S.name.trim()) L.push('稱呼：' + S.name.trim());
    if (S.phone.trim()) L.push('電話：' + S.phone.trim());
    var vt = vehicleText(); L.push('車型：' + (vt || '還沒決定'));
    if (basementText()) L.push('下地下室的需求：' + basementText());
    L.push('', '想詢價的配件：');
    chosen().forEach(function (it, i) {
      var p = priceOf(it);
      L.push((i + 1) + '. ' + plain(it) + optText(it) + '　' + (p ? money(p) : (it.byCab ? '（價格依車廂，請報價）' : (discussing(it) ? '討論後報價' : '（請報價）'))));
      var w = fitWarn(it); if (w) L.push('　' + w);
    });
    var t = total(), vp = vehPrice();
    var ak = hasAsk();
    if (vp || t || ak) L.push('');
    if (vp) L.push('車價：' + money(vp));
    if (t) L.push((ak ? '配件合計（不含待報價項目）：' : '配件合計：') + money(t));
    if (vp && t) L.push((ak ? '車＋配件（不含待報價項目）：' : '車＋配件：') + money(vp + t));
    if (S.own) { if (t) L.push('付款方式：改裝需一次付清（不能貸款）'); }
    else if (vp) L.push('付款方式：全額貸款 84 期，月付約 ' + money(monthly(vp + t)) + '（概算，實際依銀行核貸為準）');
    if (hasAsk()) L.push('', askNote());
    if (S.note.trim()) L.push('', '備註：' + S.note.trim());
    L.push('', '＊實際價格以現場報價為準');
    return L.join('\n');
  }

  // 還沒選完（要選尺寸／顏色的配件勾了但沒選）
  function needsPick(it) { return !!it.opts && typeof S.sel[it.id] !== 'string'; }
  function pending() { return chosen().filter(needsPick); }
  function renderSheet() {
    var list = $('inqlist'); list.innerHTML = '';
    var its = chosen();
    if (S.pkgBackup && S.sel['pkg-dbl']) { var bn = el('div', 'pkgnote'); bn.appendChild(el('span', '', '已換成雙廂高階套裝')); var bb = el('button', '', '↩ 改回我原本選的'); bb.type = 'button'; bb.onclick = restorePkg; bn.appendChild(bb); list.appendChild(bn); }
    if (its.length) {
      var rc = el('div', 'rcpt');
      var hd = el('div', 'rh'); hd.appendChild(el('b', '', '詢價單'));
      var dt = new Date(); hd.appendChild(el('span', '', dt.getFullYear() + '/' + (dt.getMonth() + 1) + '/' + dt.getDate())); rc.appendChild(hd);
      rc.appendChild(el('div', 'rv', '車型：' + (vehicleText() || '還沒決定')));
      if (basementText()) rc.appendChild(el('div', 'rv', '下地下室的需求：' + basementText()));
      var rl = el('div', 'rlist');
      its.forEach(function (it, idx) {
        var np = needsPick(it);
        var r = el('div', 'rrow' + (np ? ' todo' : ''));
        var left = el('div', 'rl'); left.appendChild(el('span', 'rn', (idx + 1) + '. ')); left.appendChild(document.createTextNode(plain(it) + (np ? '' : optText(it))));
        var x = el('button', 'rx', '移除'); x.type = 'button'; x.setAttribute('aria-label', '移除這一項'); x.onclick = function () { delete S.sel[it.id]; persist(); refresh(); };
        left.appendChild(x);
        if (np) left.appendChild(el('small', 'need', '👉 請選' + it.optLabel + '，才算得出價錢'));
        var w = fitWarn(it); if (w) left.appendChild(el('small', 'warn', w));
        if (it.opts) {
          var oc = el('div', 'sopts');
          it.opts.forEach(function (o) { var bt = el('button', 'chip s' + (S.sel[it.id] === o ? ' on' : ''), o); bt.type = 'button'; bt.onclick = function () { S.sel[it.id] = o; persist(); refresh(); }; oc.appendChild(bt); });
          left.appendChild(oc);
        }
        r.appendChild(left);
        var pr = priceOf(it); r.appendChild(el('span', 'rp', pr ? money(pr) : (it.byCab ? '依車廂' : (discussing(it) ? '討論後報價' : (it.optPrice && !it.ask ? '待選' + it.optLabel : '請報價')))));
        rl.appendChild(r);
      });
      rc.appendChild(rl);
      var tt = total(), vv = vehPrice(), ft = el('div', 'rt');
      function tr(lb, v, big) { var d = el('div', big ? 'big' : ''); d.appendChild(el('span', '', lb)); d.appendChild(el('b', '', money(v))); ft.appendChild(d); }
      var ak2 = hasAsk(); if (vv) tr('車價', vv); if (tt) tr(ak2 ? '配件合計（不含待報價）' : '配件合計', tt, !vv); if (vv && tt) tr(ak2 ? '車＋配件（不含待報價）' : '車＋配件', vv + tt, true);
      rc.appendChild(ft);
      var mm = vv ? monthly(vv + tt) : 0;
      if (mm) rc.appendChild(el('div', 'rm', '買車含改裝，全額貸款 84 期，月付約 ' + money(mm) + '（概算，實際依銀行核貸為準）'));
      else if (S.own && tt) rc.appendChild(el('div', 'rm', '只做改裝不能貸款，需一次付清'));
      if (hasAsk()) rc.appendChild(el('div', 'rf', askNote()));
      rc.appendChild(el('div', 'rf', '＊實際價格以現場報價為準'));
      list.appendChild(rc);
    }
    $('inqveh').textContent = ''; vehChips($('inqvehbox'), false);
    var t = total(), vp = vehPrice(); var h = '';
    if (vp) h += '車價 ' + money(vp) + '\n';
    if (t) h += '配件合計 ' + money(t) + '\n';
    if (vp && t) h += '車＋配件 ' + money(vp + t);
    $('inqtot').textContent = h.replace(/\n$/, '');
    var mo = vp ? monthly(vp + t) : 0; $('inqmo').textContent = mo ? '全額貸款 84 期，月付約 ' + money(mo) + '（概算，實際依銀行核貸為準）' : '';
    $('inqprev').style.display = 'none';
    var pk = $('inqpkg'); pk.style.display = pkgEligible() && !S.sel['pkg-dbl'] ? 'block' : 'none';
    $('inqempty').style.display = its.length ? 'none' : 'block';
    var pd = pending(), ok = pd.length === 0 && its.length > 0;
    $('inqwarn').style.display = ok ? 'none' : 'block';
    $('inqwarn').textContent = ok ? '' : '還有 ' + pd.length + ' 項沒選完（橘色那幾項），選好才能傳給業務';
    ['inqline', 'inqimg', 'inqcopy'].forEach(function (id) { $(id).disabled = !ok; });
    $('inqline').textContent = ok ? '💬 複製詢價單，並加業務 LINE' : (its.length ? '請先把橘色項目選完' : '還沒選任何配件');
  }
  function openSheet() { if (window.KPGotoTab) KPGotoTab('sum'); }
  function closeSheet() {}
  function showSum() { renderSheet(); }

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
      return { lines: wrap(plain(it) + optText(it), '600 26px ' + FONT, W - pad * 2 - 190), price: p ? money(p) : (it.byCab ? '依車廂' : (discussing(it) ? '討論後報價' : '請報價')), warn: fitWarn(it) };
    });
    var noteLines = S.note.trim() ? wrap('備註：' + S.note.trim(), '24px ' + FONT, W - pad * 2) : [];
    var H = 210 + 56 + (S.phone.trim() ? 40 : 0) + (basementText() ? 40 : 0) + (hasAsk() ? 30 : 0);
    rows.forEach(function (r) { H += r.lines.length * 36 + 20 + (r.warn ? 28 : 0); });
    H += 40 + 70 + (vehPrice() ? 44 : 0) + (total() ? 44 : 0) + (vehPrice() && total() ? 44 : 0) + (noteLines.length ? noteLines.length * 34 + 30 : 0) + 90;
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
    if (basementText()) { g.fillText('下地下室的需求：' + basementText(), pad, y + 10); y += 40; }
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
    var akI = hasAsk();
    if (t) line(akI ? '配件合計（不含待報價）' : '配件合計', t, !vp);
    if (vp && t) line(akI ? '車＋配件（不含待報價）' : '車＋配件', vp + t, true);
    if (noteLines.length) { g.fillStyle = '#4b4137'; g.font = '24px ' + FONT; y += 6; noteLines.forEach(function (ln) { g.fillText(ln, pad, y); y += 34; }); y += 10; }
    g.fillStyle = '#7b6f63'; g.font = '21px ' + FONT; if (hasAsk()) { g.fillText(askNote(), pad, y + 20); y += 30; }
    g.fillText('＊實際價格以現場報價為準', pad, y + 20);
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
    function flash(btn, t) { var o = btn.getAttribute('data-o') || btn.textContent; btn.setAttribute('data-o', o); btn.textContent = t; clearTimeout(btn._h); btn._h = setTimeout(function () { btn.textContent = o; }, 2200); }
    $('pathBuy').onclick = function () { choosePath(false); };
    $('pathOwn').onclick = function () { choosePath(true); };
    $('promoNo').onclick = function () { $('promo').style.display = 'none'; };
    $('promoYes').onclick = takePkg;
    $('promoGo').onclick = function () { $('promo').style.display = 'none'; closeSheet(); if (window.KPGoto) KPGoto('package'); };
    $('inqpkg').onclick = function () { closeSheet(); if (window.KPGoto) KPGoto('package'); };
    $('inqcopy').onclick = function () { copyText(buildText(), function () { toast('已複製文字'); }); };
    // 多數客人還沒加好友：先複製 → 開加好友頁 → 到聊天室貼上
    $('inqline').onclick = function () {
      copyText(buildText(), function () {
        toast('已複製詢價單。加好友後，進聊天室長按 →「貼上」→ 送出');
        setTimeout(function () { window.open(LINE_ADD_URL, '_blank'); }, 700);
      });
    };
    $('inqimg').onclick = saveImage;
    $('inqreset').onclick = resetAll;
    $('inqsave').onclick = function () { var b = this; if (saveState()) { hadSaved = true; flash(b, '✓ 已儲存'); toast('已儲存在這支手機，下次打開還在'); } else toast('這個瀏覽器無法儲存'); };
  }

  window.KPInq = { basement: basementBox, showSum: showSum, attach: attach, vbar: vbar, sync: function () { renderVeh(); syncRows(); syncCounts(); syncBar(); }, init: init, has: function (k) { return !!BY_IMG[k]; } };
})();
