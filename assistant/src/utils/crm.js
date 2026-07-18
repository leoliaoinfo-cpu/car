import dayjs from 'dayjs';

// 莫蘭迪色調（低彩度，深淺主題皆可讀）
export const STATUS_COLOR = {
  ok: '#7d9b76',
  warn: '#bf8a5e',
  hot: '#c0764f',
  cold: '#b26b6b',
};

export const STATUS_LABEL = {
  ok: '追蹤中',
  warn: '待聯繫',
  hot: '久未聯繫',
  cold: '冷掉了',
};

/** 追蹤規則預設值：超過 coldDays 天未聯繫 → 🟠久未聯繫；超過 deadDays 天 → 🔴冷掉了 */
export const DEFAULT_THRESHOLDS = { coldDays: 180, deadDays: 365 };

/** 清理使用者輸入的門檻：至少 1 天，且 deadDays 不小於 coldDays */
export function normalizeThresholds(t) {
  const coldDays = Math.max(1, Math.round(Number(t?.coldDays)) || DEFAULT_THRESHOLDS.coldDays);
  const deadDays = Math.max(coldDays, Math.round(Number(t?.deadDays)) || DEFAULT_THRESHOLDS.deadDays);
  return { coldDays, deadDays };
}

export function getClientStatus(client, thresholds) {
  const { coldDays, deadDays } = thresholds || DEFAULT_THRESHOLDS;
  const now = dayjs();
  const created = dayjs(client.createdAt);
  const lastContact = client.lastContact ? dayjs(client.lastContact) : null;
  const nextDate = client.nextDate ? dayjs(client.nextDate) : null;

  const daysSinceCreated = now.diff(created, 'day');
  const daysSinceContact = lastContact ? now.diff(lastContact, 'day') : null;

  if (!lastContact && daysSinceCreated >= coldDays) return 'cold';
  if (daysSinceContact !== null && daysSinceContact >= deadDays) return 'cold';
  if (daysSinceContact !== null && daysSinceContact >= coldDays) return 'hot';
  if (nextDate && !nextDate.isAfter(now, 'day')) return 'warn';
  return 'ok';
}

export function clientMatchesFilter(client, filter, thresholds) {
  const { coldDays } = thresholds || DEFAULT_THRESHOLDS;
  const now = dayjs();
  const lastContact = client.lastContact ? dayjs(client.lastContact) : null;
  const created = dayjs(client.createdAt);

  if (filter === 'all') return true;
  if (filter === 'pending') {
    const nextDate = client.nextDate ? dayjs(client.nextDate) : null;
    return nextDate != null && !nextDate.isAfter(now, 'day');
  }
  if (filter === 'cold') {
    const daysSinceCreated = now.diff(created, 'day');
    const daysSinceContact = lastContact ? now.diff(lastContact, 'day') : null;
    if (!lastContact && daysSinceCreated >= coldDays) return true;
    if (daysSinceContact !== null && daysSinceContact >= coldDays) return true;
    return false;
  }
  // catId filter
  if (filter.startsWith('cat:')) return client.catId === filter.slice(4);
  // stageId filter
  if (filter.startsWith('stage:')) return client.stageId === filter.slice(6);
  // industry filter
  if (filter.startsWith('ind:')) return client.industry === filter.slice(4);
  return true;
}

export function sortClients(clients, sortKey) {
  const pinned = clients.filter((c) => c.pinned);
  const rest = clients.filter((c) => !c.pinned);

  const sorted = rest.slice().sort((a, b) => {
    if (sortKey === 'nextDate') {
      const da = a.nextDate || '9999-99-99';
      const db_ = b.nextDate || '9999-99-99';
      return da.localeCompare(db_);
    }
    if (sortKey === 'lastContact') {
      const da = a.lastContact || '0000-00-00';
      const db_ = b.lastContact || '0000-00-00';
      return db_.localeCompare(da);
    }
    if (sortKey === 'name') return a.name.localeCompare(b.name, 'zh-TW');
    if (sortKey === 'intent') return (b.intentLevel || 0) - (a.intentLevel || 0);
    // default: createdAt desc
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  return [...pinned, ...sorted];
}

export const CAT_COLORS = [
  '#bf8a5e', '#7d9b76', '#7291a8', '#9382a5',
  '#b58a96', '#6f9a9c', '#9a9a6f',
];

export const FIELD_COLORS = [
  '#bf8a5e', '#7d9b76', '#7291a8', '#9382a5',
  '#b26b6b', '#6f9a9c', '#9a9a6f', '#b58a96',
  '#8f7a68', '#8a919b',
];

export const FIELD_COLOR_NAMES = [
  '橘', '綠', '藍', '紫', '紅', '青', '橄', '粉', '棕', '灰',
];

export function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 電話正規化：只留數字，方便比對（0912-345-678 與 0912345678 視為相同） */
export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * 找出可能重複的客戶：同電話（正規化後相同）優先，其次同姓名。
 * excludeId 用於編輯時排除自己。回傳第一個相符的客戶或 null。
 */
export function findDuplicateClient(clients, { name, phone }, excludeId = null) {
  const np = normalizePhone(phone);
  const nm = String(name || '').trim();
  if (np.length >= 6) {
    const byPhone = clients.find((c) => c.id !== excludeId && normalizePhone(c.phone) === np);
    if (byPhone) return { client: byPhone, reason: 'phone' };
  }
  if (nm) {
    const byName = clients.find((c) => c.id !== excludeId && (c.name || '').trim() === nm);
    if (byName) return { client: byName, reason: 'name' };
  }
  return null;
}

// ── 業務流程事件（客戶時間軸）────────────────────────────────────────────────
export const EVENT_TYPES = {
  contact:   { icon: '✅', label: '已聯繫',   color: '#7d9b76' },
  missed:    { icon: '📵', label: '未接',     color: '#b26b6b' },
  line:      { icon: '💬', label: 'LINE 摘要', color: '#6f9a9c' },
  quote:     { icon: '💲', label: '報價',     color: '#bf8a5e', hasAmount: true },
  visit:     { icon: '🚚', label: '看車試乘', color: '#7291a8' },
  loan:      { icon: '🏦', label: '貸款補件', color: '#9382a5' },
  order:     { icon: '📝', label: '下訂',     color: '#c0764f', hasAmount: true },
  delivery:  { icon: '🔑', label: '交車',     color: '#7d9b76' },
  aftercare: { icon: '🤝', label: '售後回訪', color: '#9a9a6f' },
  deal:      { icon: '🏆', label: '成交歸檔', color: '#a99760' },
  occasion:  { icon: '🎉', label: '紀念日',   color: '#b58a96' },
};

/** 客戶詳情頁快速記錄事件的按鈕順序（已聯繫/未接另有專屬按鈕） */
export const QUICK_EVENT_KEYS = ['line', 'quote', 'visit', 'loan', 'order', 'delivery', 'aftercare'];

/** 交車後自動建立的售後回訪天數 */
export const DELIVERY_FOLLOWUP_DAYS = [3, 7, 30];

/**
 * 自訂日期欄位的紀念日提醒。
 * 欄位（type='date'）可設 recur：'yearly' 每年重複｜'once' 一次性｜'count' 從該日期起連續 N 年。
 * 回傳指定日期當天到期的 [{ field, client, years }]，years = 距原日期的年數。
 */
export function getOccasionsOnDate(clients, customFields, dateStr) {
  const out = [];
  const dateFields = customFields.filter(
    (f) => f.type === 'date' && f.recur && f.recur !== 'none'
  );
  if (dateFields.length === 0) return out;
  const year = Number(dateStr.slice(0, 4));
  const monthDay = dateStr.slice(5);
  for (const f of dateFields) {
    for (const c of clients) {
      const v = c.customFieldValues?.[f.id];
      if (!v || v.length < 10) continue;
      if (f.recur === 'once') {
        if (v === dateStr) out.push({ field: f, client: c, years: 0 });
        continue;
      }
      if (v.slice(5) !== monthDay) continue;
      const years = year - Number(v.slice(0, 4));
      if (years < 0) continue;
      if (f.recur === 'count' && years >= Math.max(1, Number(f.recurCount) || 1)) continue;
      out.push({ field: f, client: c, years });
    }
  }
  return out;
}

// ── 商用車報價：Kia 彰化卡旺 2026 原廠車型 / 配備 / 補助折抵型錄（設定可編輯）────
// _catalog 版本標記：用於自動升級尚未客製的舊型錄（見 resolveQuotePresets）
export const QUOTE_CATALOG_VERSION = 'kavan-2026-v2';

// 報價配備分類顯示順序
export const QUOTE_ADDON_CATS = [
  '配備版本', '外觀空力', '燈組', '音響', '配件', '底盤強化', '金屬製研', '車身改色', '防刮漆料', '鋁圈',
];

export const DEFAULT_QUOTE_PRESETS = {
  _catalog: QUOTE_CATALOG_VERSION,
  // 車型與售價（報價單「選車型」下拉帶入車輛售價）
  models: [
    { id: 'qm-1', name: '單廂三人座 手排六速', price: 798000 },
    { id: 'qm-2', name: '單廂三人座 自排五速', price: 838000 },
    { id: 'qm-3', name: '大單廂三人座 手排六速', price: 828000 },
    { id: 'qm-4', name: '大單廂三人座 自排五速', price: 868000 },
    { id: 'qm-5', name: '雙廂六人座 手排六速', price: 968000 },
    { id: 'qm-6', name: '雙廂六人座 自排五速', price: 1018000 },
    { id: 'qm-7', name: '4WD四輪傳動 單廂', price: 958000 },
    { id: 'qm-8', name: '4WD四輪傳動 雙廂', price: 1058000 },
  ],
  // 選購配備（一鍵帶入報價項目；cat 分類、desc 產品介紹皆依原廠型錄圖片文字）
  addons: [
    // 配備版本升級
    { id: 'qa-pkg1', cat: '配備版本', name: '特仕版套件（行車紀錄器/GPS/踏墊/晴雨窗/隔熱紙…）', price: 30000,
      desc: '電子式前後行車紀錄器、GPS天眼測速、PVC格紋防水踏墊、Kia卡旺深黑晴雨窗(組)、專用倒車蜂鳴器、貨斗橡膠墊5mm加厚、SmithBella奈米隔熱紙' },
    { id: 'qa-pkg2', cat: '配備版本', name: '安全科技版（安卓四錄+360環景+六輪胎壓）', price: 40000,
      desc: '安卓四錄整合多媒體（台灣美邁、9吋安卓觸控螢幕、高清四錄影監控&360度環景、無線Carplay、卡旺專用底座）；六輪胎壓偵測器（6輪數據獨立顯示、太陽能與usb供電）' },
    { id: 'qa-pkg3', cat: '配備版本', name: '原裝多功能方向盤（定速巡航/音控鍵）', price: 20000,
      desc: '定速巡航套件；多媒體音控鍵（音量控制/切換/免持/Mode）' },
    // 外觀空力（NLD灣岸）
    { id: 'qa-aero', cat: '外觀空力', name: 'NLD空力套裝（前下巴+鏡蓋+側燈殼）', price: 12000,
      desc: '前下巴套件+後照鏡飾蓋+改裝側邊方向燈殼(白)。台灣研發設計鋁製模具、3D原車掃描、ABS強化熱塑材質(硬度佳彈性好)、原車直上不破壞保險桿、三段式本體、KDM風格設計' },
    { id: 'qa-lip', cat: '外觀空力', name: '前下巴套件', price: 9500, desc: 'NLD灣岸空力套件' },
    { id: 'qa-mcover', cat: '外觀空力', name: '後照鏡飾蓋', price: 2800, desc: 'NLD灣岸空力套件' },
    { id: 'qa-turn', cat: '外觀空力', name: '改裝側邊方向燈殼（白）', price: 1000, desc: 'NLD灣岸空力套件' },
    // 燈組
    { id: 'qa-led', cat: '燈組', name: '全車LED燈組合（含霧燈/室內/牌照/側邊照地）', price: 15000,
      desc: '卡旺全車LED燈組（日行燈/大燈/遠燈/前後方向燈/後霧燈+倒車燈）、LED霧燈、LED室內燈+牌照燈（CANBUS解碼王）、極光側邊照地燈' },
    { id: 'qa-gtr', cat: '燈組', name: 'GTR大燈升級（三階切線）', price: 27000,
      desc: '精準照明、三階切線、完美無損。高亮聚光（夜間視野更清晰）、精準切線（不眩光守護用路人）、穩定可靠。三階切線：右側照明距離最長（提前告知路口車輛/辨識路牌標語）、左側照明距離適中（減低對向駕駛眩光），安裝不破壞頭燈結構' },
    { id: 'qa-tail', cat: '燈組', name: 'LED光環尾燈組（卡旺專用原車直上）', price: 11800,
      desc: '原車尾燈模組3D開模、KIA K2500卡旺專用型。符合驗車規範：後尾燈-煞車燈-後方向燈-雙倒車燈-反光片' },
    { id: 'qa-fog', cat: '燈組', name: '卡旺專用魚眼霧燈（黃金眼/6000K白光）', price: 5800,
      desc: 'SD次世代魚眼霧燈、光型集中+照射度廣。黃金眼色系 / 6000K白光色系' },
    { id: 'qa-mirror1', cat: '燈組', group: 'g-mirror', name: 'LED韓版後照鏡（方向燈+全視線）', price: 8500, desc: 'LED方向燈+全視線鏡片' },
    { id: 'qa-mirror2', cat: '燈組', group: 'g-mirror', name: '後照鏡組-全視線鏡片', price: 5000, desc: '整片全視線鏡片(黑)' },
    // 音響
    { id: 'qa-tlsound', cat: '音響', name: 'TLSOUND音響升級（4顆碳纖維喇叭+高音+處理器）', price: 8800,
      desc: '6.5吋碳纖維中低音喇叭+音質處理器+專用線組、韓國原裝卡旺高音喇叭+高音電容+專用線組，組合含4顆喇叭。CARBON碳纖維高剛性音盆、純鋁子彈頭、承受功率100W+' },
    { id: 'qa-speaker', cat: '音響', name: '專用喇叭改裝', price: 2800, desc: '專用插座無損音質、高功率高低音混合' },
    // 配件
    { id: 'qa-phone', cat: '配件', name: '雙手機架組合（兩隻）', price: 3000, desc: '卡旺中控專用底座、A柱手把原車孔位底座；重力&磁吸二選一' },
    // 底盤強化
    { id: 'qa-ts', cat: '底盤強化', name: 'TS氮氣液壓避震器（卡旺強化避震王）', price: 29800,
      desc: '韓國原裝、11mm專用強化版。16段舒適阻尼調整、11mm支撐承重彈簧、超有效改善晃動不適感' },
    { id: 'qa-spring', cat: '底盤強化', name: '彈簧鋼板', price: 5500, desc: '增加支撐力、防止車尾下垂' },
    { id: 'qa-block', cat: '底盤強化', name: '抗震模塊4顆', price: 7500, desc: '吸收鋼板間的撞擊震動、防止左右側傾與下垂' },
    { id: 'qa-atc', cat: '底盤強化', name: 'ATC防傾桿', price: 15000, desc: '防止過彎左右側傾、減少左右晃動感' },
    { id: 'qa-leaf', cat: '底盤強化', name: '彈簧鋼板避震彈簧', price: 12000, desc: '支撐力及載重能力提高、強化載重行駛穩定性' },
    // 金屬製研
    { id: 'qa-urea', cat: '金屬製研', name: '尿素桶防撞桿', price: 5000, desc: '原車鎖點結構穩固、保護尿素桶防止破損' },
    { id: 'qa-side', cat: '金屬製研', name: '雙廂專用滑行側踏組', price: 18900, desc: '原車鎖點結構穩固、雙廂專用側邊登車踏板' },
    { id: 'qa-skid', cat: '金屬製研', name: '4WD專用鋁合金下護板', price: 12000, desc: '原車鎖點結構穩固、防止跳石汙漬擊中中冷器' },
    { id: 'qa-rear', cat: '金屬製研', name: '車尾防撞鋼樑（2WD專用）', price: 7000, desc: '2WD專用' },
    { id: 'qa-roof', cat: '金屬製研', name: '車頂行李架/籃（單廂/大單廂專用）', price: 15000, desc: '單廂、大單廂專用' },
    { id: 'qa-ext', cat: '金屬製研', name: '貨斗延伸護欄（+350mm）', price: 8500, desc: '貨斗延長+350mm' },
    // 車身改色（烤漆爐烘烤；消光霧面另計）
    { id: 'qa-paint1', cat: '車身改色', group: 'g-paint', name: '車身烤漆改色（單廂）', price: 36000, desc: '烤漆爐烘烤。消光霧面(30度)效果為雙層消光漆、另加$8000' },
    { id: 'qa-paint2', cat: '車身改色', group: 'g-paint', name: '車身烤漆改色（大單廂）', price: 37000, desc: '烤漆爐烘烤。消光霧面(30度)效果為雙層消光漆、另加$8000' },
    { id: 'qa-paint3', cat: '車身改色', group: 'g-paint', name: '車身烤漆改色（雙廂）', price: 39000, desc: '烤漆爐烘烤。消光霧面(30度)效果為雙層消光漆、另加$8000' },
    { id: 'qa-paintm', cat: '車身改色', name: '消光霧面升級（雙層消光漆）', price: 8000, desc: '消光霧面(30度)效果、雙層消光漆' },
    // 防刮漆料（roberlo）
    { id: 'qa-rob1', cat: '防刮漆料', group: 'g-roberlo', name: 'roberlo防刮漆料（2~2.5呎尾門）', price: 9000, desc: '標準色為消光黑、使用年限長達5年以上' },
    { id: 'qa-rob2', cat: '防刮漆料', group: 'g-roberlo', name: 'roberlo防刮漆料（3~3.5呎尾門）', price: 10000, desc: '標準色為消光黑、使用年限長達5年以上' },
    { id: 'qa-rob3', cat: '防刮漆料', group: 'g-roberlo', name: 'roberlo防刮漆料（4~4.5呎尾門）', price: 11000, desc: '標準色為消光黑、使用年限長達5年以上' },
    // 鋁圈
    { id: 'qa-omega', cat: '鋁圈', name: 'OMEGA鋁圈升級', price: 33800, desc: 'OMEGA WHEELS。減重22公斤 & 載重值+300公斤' },
  ],
  subsidies: [
    { id: 'qs-1', name: '汰舊換新補助', amount: 50000 },
    { id: 'qs-2', name: '貨物稅減免', amount: 50000 },
  ],
};

// 舊版通用預設配備名稱（用於判斷使用者是否從未客製過報價選單）
const LEGACY_ADDON_NAMES = ['框式車斗', '篷式車斗', '冷凍廂', '升降尾門', '貨斗加高'];

/**
 * 解析儲存的報價選單：
 * - 沒有存過 → 用原廠型錄
 * - 舊版且未客製（配備仍為通用預設）→ 自動升級為卡旺原廠型錄
 * - 已客製 → 保留使用者資料，僅補上新的 models 欄位（新增欄位、不覆蓋）
 */
export function resolveQuotePresets(row) {
  if (!row || !Array.isArray(row.addons)) return DEFAULT_QUOTE_PRESETS;
  if (row._catalog === QUOTE_CATALOG_VERSION) return row;
  const names = row.addons.map((a) => a.name);
  const untouched = !row.models
    && names.length === LEGACY_ADDON_NAMES.length
    && names.every((n) => LEGACY_ADDON_NAMES.includes(n));
  if (untouched) return DEFAULT_QUOTE_PRESETS;
  return { ...row, models: row.models || DEFAULT_QUOTE_PRESETS.models };
}

/** 產業標籤建議（決定推什麼車斗） */
export const INDUSTRY_SUGGESTIONS = [
  '水電', '市場攤商', '物流貨運', '營造工程', '資源回收', '餐飲', '農牧', '園藝造景',
];

/** 本息平均攤還月付金；annualRate 為年利率 %（0 = 無息分期） */
export function calcMonthlyPayment(principal, annualRate, months) {
  const p = Number(principal) || 0;
  const n = Math.round(Number(months)) || 0;
  if (p <= 0 || n <= 0) return 0;
  const r = (Number(annualRate) || 0) / 100 / 12;
  if (r <= 0) return Math.round(p / n);
  const f = Math.pow(1 + r, n);
  return Math.round((p * r * f) / (f - 1));
}

/** 業績表金額加總 */
export function sumDeals(deals, dealFields) {
  const totals = { count: deals.length, amount: 0, fields: {} };
  for (const f of dealFields) totals.fields[f.id] = 0;
  for (const d of deals) {
    totals.amount += Number(d.amount) || 0;
    for (const f of dealFields) totals.fields[f.id] += Number(d.fields?.[f.id]) || 0;
  }
  return totals;
}

export function formatMoney(n) {
  return (Number(n) || 0).toLocaleString('zh-TW');
}

/** 簽約～交車常見待辦範本預設值（可在設定編輯，存於 settings.todoTemplate） */
export const DEFAULT_TODO_TEMPLATE = [
  '保險規劃確認',
  '貸款對保 / 補件',
  '監理站驗車領牌',
  '配件安裝確認',
  '交車前整備清潔',
];
