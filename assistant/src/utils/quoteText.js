import { calculateQuoteTotals } from './pricing.js';

const money = (value) => Math.max(0, Math.round(Number(value) || 0));
export const DEFAULT_QUOTE_MODEL_YEAR = 2027;

/** LINE 報價用：以「萬」為單位，最多保留兩位小數。 */
export function formatWan(value) {
  const amount = money(value) / 10000;
  return `${Number(amount.toFixed(2))}萬`;
}

function formatLineWan(value) {
  return formatWan(value).replace('萬', ' 萬');
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

/** 由報價單即時生成可直接貼到 LINE 的純文字報價。 */
export function buildQuoteMessage({
  customerName = '',
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

  const vehicle = selectedItems.find((item) => item.kind === 'vehicle' && !item.pending);
  if (vehicle) {
    const yearText = String(modelYear || DEFAULT_QUOTE_MODEL_YEAR).trim();
    const modelSpec = formatVehicleSpec(model);
    lines.push(`${yearText} 年式 KIA 卡旺 K2500`);
    if (modelSpec) lines.push(modelSpec);
    lines.push('', `車輛售價：${formatLineWan(vehicle.price)}`);
  }

  for (const item of selectedItems.filter((row) => row.kind !== 'vehicle')) {
    const name = compactQuoteItemName(item.name);
    if (item.pending) lines.push(`${name}：待廠商報價`);
    else if (!item.gift) lines.push(`${name}：+${formatLineWan(item.price)}`);
  }

  lines.push('----------', `原價總計：${formatLineWan(totals.originalTotal)}`, '----------');

  for (const item of pricedItems) {
    if (item.gift) continue;
    for (const row of Array.isArray(item.discounts) ? item.discounts : []) {
      const amount = money(row?.amount);
      if (!amount) continue;
      const discountName = String(row?.name || '優惠').trim() || '優惠';
      const label = discountName === '優惠' ? `${compactQuoteItemName(item.name)}優惠` : discountName;
      lines.push(`${label}：-${formatLineWan(amount)}`);
    }
  }
  for (const row of discounts) lines.push(`${String(row.name).trim()}：-${formatLineWan(row.amount)}`);

  lines.push('', `✅ 最終優惠成交價：${formatLineWan(totals.total)}元`);

  const giftItems = pricedItems.filter((item) => item.gift);
  if (giftItems.length > 0) {
    lines.push('----------', '', '另外再為您爭取以下贈品：', '');
    giftItems.forEach((item) => {
      const value = money(item.price);
      lines.push(`🎁 ${compactQuoteItemName(item.name)}${value > 0 ? `（價值 ${formatTwd(value)} 元）` : ''}`);
      const description = String(item.description || '').trim();
      if (description) lines.push(description);
    });
    lines.push('', `車價折扣加上贈品，總優惠 ${formatTwd(totals.customerBenefitTotal)} 元`);
  }
  return lines.join('\n');
}
