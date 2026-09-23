import { calculateQuoteTotals } from './pricing.js';

const money = (value) => Math.max(0, Math.round(Number(value) || 0));
export const DEFAULT_QUOTE_MODEL_YEAR = 2027;

/** LINE 報價用：以「萬」為單位，最多保留兩位小數。 */
export function formatWan(value) {
  const amount = money(value) / 10000;
  return `${Number(amount.toFixed(2))}萬`;
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
    .filter((item) => String(item?.name || '').trim() && (item?.pending || money(item?.price) > 0));
  const pricedItems = selectedItems.filter((item) => !item.pending && money(item.price) > 0);
  const discounts = (Array.isArray(generalDiscounts) ? generalDiscounts : [])
    .filter((row) => String(row?.name || '').trim() && money(row?.amount) > 0);
  const totals = calculateQuoteTotals(pricedItems, discounts);
  const lines = [`${String(customerName || '').trim()}您好，目前方案整理如下：`, ''];

  const vehicle = selectedItems.find((item) => item.kind === 'vehicle' && !item.pending);
  if (vehicle) {
    const yearText = String(modelYear || '').trim();
    const modelText = String(model || '').trim() || '車輛';
    const prefixedModel = yearText && !modelText.includes('年式') ? `${yearText}年式 ${modelText}` : modelText;
    lines.push(`${prefixedModel}　${formatWan(vehicle.price)}`);
  }

  for (const item of selectedItems.filter((row) => row.kind !== 'vehicle')) {
    const name = compactQuoteItemName(item.name);
    lines.push(item.pending ? `${name}　+待廠商報價` : `${name}　+${formatWan(item.price)}`);
  }

  lines.push('----------', '', `原價總計：${formatWan(totals.originalTotal)}`);

  for (const item of pricedItems) {
    for (const row of Array.isArray(item.discounts) ? item.discounts : []) {
      const amount = money(row?.amount);
      if (!amount) continue;
      const discountName = String(row?.name || '優惠').trim() || '優惠';
      const label = discountName === '優惠' ? `${compactQuoteItemName(item.name)}優惠` : discountName;
      lines.push(`${label}-${formatWan(amount)}`);
    }
  }
  for (const row of discounts) lines.push(`${String(row.name).trim()}-${formatWan(row.amount)}`);

  lines.push('-------', '', `優惠合計：${formatWan(totals.discountTotal)}`, `專案成交價：${formatWan(totals.total)}`);
  return lines.join('\n');
}
