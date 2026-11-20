// 配件「規格／顏色」選擇（純邏輯）。
// 一般配件只有一組選項：addon.choiceLabel＋addon.choices，選的值直接存在 item.optionValue（例：黃金眼）。
// 套裝（例：雙廂高階套裝）內含好幾樣有顏色或規格的配件，所以可以有好幾組：addon.choiceGroups = [{ label, choices }]。
// 多組時 optionValue 存成「影像系統：四錄；後照鏡顏色：黑；…」，每一組都選了才算完成。

export function choiceGroupsOf(addon) {
  if (Array.isArray(addon?.choiceGroups) && addon.choiceGroups.length) {
    return addon.choiceGroups
      .filter((g) => Array.isArray(g?.choices) && g.choices.length)
      .map((g) => ({ label: String(g.label || '規格'), choices: g.choices.map(String) }));
  }
  if (Array.isArray(addon?.choices) && addon.choices.length) {
    return [{ label: String(addon.choiceLabel || '規格'), choices: addon.choices.map(String) }];
  }
  return [];
}

export const hasChoices = (addon) => choiceGroupsOf(addon).length > 0;
export const isMultiChoice = (addon) => choiceGroupsOf(addon).length > 1;

/** 報價項目上顯示的選項名稱：一組＝該組名稱；多組＝「選項」。 */
export function choiceLabelOf(addon) {
  const groups = choiceGroupsOf(addon);
  if (groups.length === 0) return '';
  return groups.length > 1 ? '選項' : groups[0].label;
}

/** 把已存的 optionValue 拆回「每一組選了什麼」：{ 組名: 選項 }。 */
export function parseChoiceValue(addon, value) {
  const groups = choiceGroupsOf(addon);
  const text = String(value || '').trim();
  const out = {};
  if (!text) return out;
  if (groups.length === 1) {
    if (groups[0].choices.includes(text)) out[groups[0].label] = text;
    return out;
  }
  for (const part of text.split('；')) {
    const index = part.indexOf('：');
    if (index < 0) continue;
    const label = part.slice(0, index).trim();
    const picked = part.slice(index + 1).trim();
    const group = groups.find((g) => g.label === label);
    if (group && group.choices.includes(picked)) out[label] = picked;
  }
  return out;
}

/** 某一組改選 → 回傳新的 optionValue。 */
export function setChoice(addon, value, groupLabel, choice) {
  const groups = choiceGroupsOf(addon);
  if (groups.length === 1) return choice;
  const picked = { ...parseChoiceValue(addon, value), [groupLabel]: choice };
  return groups.filter((g) => picked[g.label]).map((g) => `${g.label}：${picked[g.label]}`).join('；');
}

/** 每一組都選了才算完成（沒有選項的配件永遠完成）。 */
export function isChoiceComplete(addon, value) {
  const groups = choiceGroupsOf(addon);
  if (!groups.length) return true;
  const picked = parseChoiceValue(addon, value);
  return groups.every((g) => picked[g.label]);
}

/** 還沒選的組名（給提示用）。 */
export function missingChoiceLabels(addon, value) {
  const picked = parseChoiceValue(addon, value);
  return choiceGroupsOf(addon).filter((g) => !picked[g.label]).map((g) => g.label);
}
