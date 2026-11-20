import { calculateQuoteTotals } from './pricing.js';
import { DEFAULT_QUOTE_PRESETS } from './crm.js';

const money = (value) => Math.max(0, Math.round(Number(value) || 0));
export const DEFAULT_QUOTE_MODEL_YEAR = 2027;

/** LINE 報價用：以「萬」為單位，最多保留兩位小數。 */
export function formatWan(value) {
  const amount = money(value) / 10000;
  return `${Number(amount.toFixed(2))}萬`;
}

/**
 * LINE 文字的金額：整百元用「萬」（例 105.06 萬）；
 * 不是整百元（例 1,050,569）就寫完整元數，避免四捨五入後和報價圖金額不一致。
 */
function formatLineWan(value) {
  const amount = money(value);
  if (amount % 100 !== 0) return `${formatTwd(amount)} 元`;
  return formatWan(amount).replace('萬', ' 萬');
}

function formatTwd(value) {
  return money(value).toLocaleString('zh-TW');
}

export function formatVehicleSpec(value) {
  return String(value || '').trim()
    .replace(/^(?:2WD\s*)/iu, '')
    .replace(/(?:2027\s*年式\s*)?(?:KIA\s*)?(?:卡旺\s*)?(?:K2500\s*)?/iu, '')
    .replace(/(大單廂|單廂|雙廂)\s*(\d+)\s*人座/gu, '$1 $2 人座')
    .replace(/(\d+)\s*速\s*(手自排|手排)/gu, '$1 速$2')
    .replace(/人座\s+(?=\d+\s*速)/u, '人座｜')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把型錄用的長名稱縮成 LINE 讀起來自然的版本。 */
export function compactQuoteItemName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return '';
  if (/^H架\s*[（(]兩支一組[）)]$/.test(name)) return 'H架兩隻';
  if (/^H架\s*[（(]一支[）)]$/.test(name)) return 'H架一隻';

  const liftgate = name.match(/^(?:滑特)?升降尾門\s*[（(]([^）)]+)[）)]$/);
  if (liftgate) return `${liftgate[1].replace(/尺/g, '呎')}升降尾門`;

  const packageName = name.match(/^(.+?)\s*[（(]([^）)]+)[）)]$/);
  if (packageName && (packageName[2].length >= 9 || /[\/／…+]/.test(packageName[2]))) {
    return packageName[1].trim();
  }
  return name.replace(/尺/g, '呎');
}

// LINE 報價分區：依配件在型錄裡的分類歸到 5 個區塊（順序即顯示順序）。
const SECTION_DEFS = [
  { key: 'body', title: '🚚 車輛本體' },
  { key: 'bed', title: '📦 車斗配備' },
  { key: 'chassis', title: '🔧 底盤懸吊・煞車' },
  { key: 'look', title: '✨ 外觀燈光' },
  { key: 'inside', title: '🪑 車內配備' },
  { key: 'other', title: '🧩 其他配件' },
  { key: 'fee', title: '📄 其他費用' },
];
const CATEGORY_SECTION = {
  '配備版本': 'body',
  '貨斗底板': 'bed', '客製車體': 'bed', '帆布': 'bed', '客製帆布': 'bed', '升降帆布': 'bed', '冷凍冷藏箱': 'bed', '電動歐翼': 'bed', '露營箱體': 'bed', '金屬製研': 'bed',
  '底盤強化': 'chassis',
  '燈組': 'look', '外觀空力': 'look', '車身改色': 'look', '防刮漆料': 'look', '烤漆周邊': 'look', '鋁圈': 'look',
  '駕駛科技': 'inside', '音響': 'inside', '配件': 'inside', '周邊配件': 'inside',
};
const CATALOG_BY_ID = new Map((DEFAULT_QUOTE_PRESETS.addons || []).map((addon) => [addon.id, addon]));

function sectionKeyOf(item) {
  if (item.kind === 'vehicle') return 'body';
  const cat = String(CATALOG_BY_ID.get(item.catalogId)?.cat || '');
  if (CATEGORY_SECTION[cat]) return CATEGORY_SECTION[cat];
  if (/尾門|隔熱紙/.test(cat)) return cat.includes('隔熱紙') ? 'look' : 'bed';
  return item.kind === 'other' ? 'fee' : 'other';
}

function warrantyText(item) {
  const months = Number(CATALOG_BY_ID.get(item.catalogId)?.warrantyMonths) || 0;
  if (!months) return '';
  return months % 12 === 0 ? `${months / 12} 年保固` : `${months} 個月保固`;
}

const BAR = '━━━━━━━━━━';
const INDENT = '　';

/** 由報價單即時生成可直接貼到 LINE 的純文字報價（分區版）。 */
export function buildQuoteMessage({
  customerName = '',
  planName = '',
  model = '',
  modelYear = '',
  items = [],
  generalDiscounts = [],
} = {}) {
  const selectedItems = (Array.isArray(items) ? items : [])
    .filter((item) => String(item?.name || '').trim() && (item?.pending || item?.gift || money(item?.price) > 0));
  const pricedItems = selectedItems.filter((item) => !item.pending && (item.gift || money(item.price) > 0));
  const discounts = (Array.isArray(generalDiscounts) ? generalDiscounts : [])
    .filter((row) => String(row?.name || '').trim() && money(row?.amount) > 0);
  const totals = calculateQuoteTotals(pricedItems, discounts);
  const lines = [`${String(customerName || '').trim()}您好，目前方案整理如下：`, ''];

  const plan = String(planName || '').trim();
  if (plan) lines.push(`【${plan}】`);
  const vehicle = selectedItems.find((item) => item.kind === 'vehicle' && !item.pending);
  if (vehicle) {
    const yearText = String(modelYear || DEFAULT_QUOTE_MODEL_YEAR).trim();
    const modelSpec = formatVehicleSpec(model);
    lines.push(`${yearText} 年式 KIA 卡旺 K2500`);
    if (modelSpec) lines.push(modelSpec);
    lines.push('');
  }

  const giftItems = pricedItems.filter((item) => item.gift);
  const bySection = new Map(SECTION_DEFS.map((def) => [def.key, []]));
  for (const item of selectedItems.filter((row) => !row.gift)) {
    if (item.kind === 'vehicle' && item.pending) continue;
    bySection.get(sectionKeyOf(item)).push(item);
  }

  const pushSection = (title, rows) => {
    lines.push(BAR, title, BAR, ...rows, '');
  };

  for (const def of SECTION_DEFS) {
    const sectionItems = bySection.get(def.key);
    if (!sectionItems.length) continue;
    const rows = [];
    for (const item of sectionItems) {
      if (item.kind === 'vehicle') {
        rows.push(`・車輛售價：${formatLineWan(item.price)}`);
        continue;
      }
      const option = String(item.optionValue || '').trim();
      const name = `${compactQuoteItemName(item.name)}${option ? `（${option}）` : ''}`;
      rows.push(item.pending ? `・${name}：待廠商報價` : `・${name}：+${formatLineWan(item.price)}`);
      const itemNote = String(item.note || '').trim();
      if (itemNote) rows.push(`${INDENT}備註：${itemNote}`);
      const cut = (Array.isArray(item.deductions) ? item.deductions : [])
        .filter((row) => String(row?.name || '').trim() && money(row?.amount) > 0);
      if (cut.length) {
        const cutTotal = cut.reduce((sum, row) => sum + money(row.amount), 0);
        rows.push(`${INDENT}不含：${cut.map((row) => String(row.name).trim()).join('＋')}（已扣 ${formatLineWan(cutTotal)}）`);
      }
    }
    pushSection(def.title, rows);
  }

  if (giftItems.length > 0) {
    pushSection('🎁 贈品', giftItems.map((item) => {
      const value = money(item.price);
      const extra = [value > 0 ? `價值 ${formatTwd(value)} 元` : '', warrantyText(item)].filter(Boolean).join('，');
      return `・${compactQuoteItemName(item.name)}${extra ? `（${extra}）` : ''}`;
    }));
  }

  // 原價總計含贈品價值；贈品價值再以「贈品優惠」扣回，最終成交價仍是不含贈品的應付金額。
  lines.push('----------', `原價總計：${formatLineWan(totals.originalTotal + totals.giftValueTotal)}`, '----------');

  const discountLines = [];
  for (const item of pricedItems) {
    if (item.gift) continue;
    for (const row of Array.isArray(item.discounts) ? item.discounts : []) {
      const amount = money(row?.amount);
      if (!amount) continue;
      const discountName = String(row?.name || '優惠').trim() || '優惠';
      const label = discountName === '優惠' ? `${compactQuoteItemName(item.name)}優惠` : discountName;
      discountLines.push(`${label}：-${formatLineWan(amount)}`);
    }
  }
  for (const row of discounts) discountLines.push(`${String(row.name).trim()}：-${formatLineWan(row.amount)}`);
  if (totals.giftValueTotal > 0) discountLines.push(`贈品優惠：-${formatLineWan(totals.giftValueTotal)}`);
  if (totals.giftValueTotal > 0 && totals.discountTotal > 0) {
    discountLines.push(`專案優惠加上贈品優惠，總優惠 ${formatTwd(totals.customerBenefitTotal)} 元`);
  }
  if (discountLines.length) lines.push(...discountLines, '----------');

  const finalText = formatLineWan(totals.total);
  lines.push(`✅ 最終優惠成交價：${finalText}${finalText.endsWith('萬') ? '元' : ''}`);
  return lines.join('\n');
}
