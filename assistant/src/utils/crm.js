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
export const QUOTE_CATALOG_VERSION = 'kavan-2026-v1';

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
  // 選購配備（一鍵帶入報價項目）
  addons: [
    // 配備版本升級
    { id: 'qa-pkg1', name: '特仕版套件（行車紀錄器/GPS/踏墊/晴雨窗/隔熱紙…）', price: 30000 },
    { id: 'qa-pkg2', name: '安全科技版（安卓四錄+360環景+六輪胎壓）', price: 40000 },
    { id: 'qa-pkg3', name: '原裝多功能方向盤（定速巡航/音控鍵）', price: 20000 },
    // 燈組升級
    { id: 'qa-led', name: '全車LED燈組合（含霧燈/室內/牌照/側邊照地）', price: 15000 },
    { id: 'qa-mirror1', name: 'LED韓版後照鏡（方向燈+全視線）', price: 8500 },
    { id: 'qa-mirror2', name: '後照鏡組-全視線鏡片', price: 5000 },
    { id: 'qa-speaker', name: '專用喇叭改裝', price: 2800 },
    { id: 'qa-phone', name: '雙手機架組合（兩隻）', price: 3000 },
    // 底盤強化
    { id: 'qa-ts', name: 'TS氮氣液壓避震器（卡旺強化避震王）', price: 29800 },
    { id: 'qa-spring', name: '彈簧鋼板（防車尾下垂）', price: 5500 },
    { id: 'qa-block', name: '抗震模塊4顆', price: 7500 },
    { id: 'qa-atc', name: 'ATC防傾桿', price: 15000 },
    { id: 'qa-leaf', name: '彈簧鋼板避震彈簧（強化載重）', price: 12000 },
    // 金屬製研
    { id: 'qa-urea', name: '尿素桶防撞桿', price: 5000 },
    { id: 'qa-side', name: '雙廂專用滑行側踏組', price: 18900 },
    { id: 'qa-skid', name: '4WD專用鋁合金下護板', price: 12000 },
    { id: 'qa-rear', name: '車尾防撞鋼樑（2WD專用）', price: 7000 },
    { id: 'qa-roof', name: '車頂行李架/籃（單廂/大單廂專用）', price: 15000 },
    { id: 'qa-ext', name: '貨斗延伸護欄（+350mm）', price: 8500 },
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
