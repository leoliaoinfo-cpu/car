// 配件適用車型（2027 卡旺配件清單的「車型」欄）。報價選了車型後，不適用的配件旁邊顯示提醒（只提醒、不擋，實際以實車確認為準）。
// drive：'2WD'／'4WD'；cabs：適用車廂（單廂＝單廂與大單廂都算）。
export const ADDON_FIT = {
  'qa-atc': { drive: '2WD' },
  'qa-omega': { drive: '2WD' },
  'qa-skid': { drive: '4WD' },
  'qa-side': { cabs: ['雙廂'] },
  'qa-roof': { cabs: ['單廂', '大單廂'] },
  'qa-interior-led-single': { cabs: ['單廂', '大單廂'] },
  'qa-interior-led-double': { cabs: ['雙廂'] },
};

/** 回傳提醒文字；適用或還沒選車型就回空字串。variant 要有 drive（'2WD'／'4WD'）與 cab（'單廂'／'大單廂'／'雙廂'）。 */
export function addonFitWarning(addonId, variant) {
  const rule = ADDON_FIT[addonId];
  if (!rule || !variant) return '';
  if (rule.drive && variant.drive && variant.drive !== rule.drive) return `適用 ${rule.drive}，這台是 ${variant.drive}`;
  if (rule.cabs && variant.cab && !rule.cabs.includes(variant.cab)) return `適用${rule.cabs.join('、')}，這台是${variant.cab}`;
  return '';
}
