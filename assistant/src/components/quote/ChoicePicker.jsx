import { choiceGroupsOf, parseChoiceValue, setChoice } from '../../utils/choices';

/**
 * 規格／顏色選擇（勾選按鈕）。一個配件有幾組選項就顯示幾排，每一排都要選。
 * addon：有 choiceLabel／choices／choiceGroups 的配件（型錄品項或報價項目都可以）。
 * onChange(optionValue)：回傳新的 optionValue（多組時會帶組名）。
 */
export default function ChoicePicker({ addon, value, onChange, small = false, disabled = false }) {
  const groups = choiceGroupsOf(addon);
  if (!groups.length) return null;
  const picked = parseChoiceValue(addon, value);
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.label} role="radiogroup" aria-label={group.label}>
          <p className="mb-1 text-[11px] font-bold text-ink-2">
            {group.label}{!picked[group.label] && <span className="ml-1 text-danger">（必選）</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.choices.map((choice) => {
              const on = picked[group.label] === choice;
              return (
                <button key={choice} type="button" role="radio" aria-checked={on} disabled={disabled}
                  onClick={() => onChange(setChoice(addon, value, group.label, choice))}
                  className={`flex items-center gap-1.5 rounded-lg border-2 px-3 font-semibold ${small ? 'min-h-9 text-xs' : 'min-h-11 text-sm'} ${on ? 'border-accent bg-accent text-on-accent' : 'border-bdr bg-s1 text-ink-2'}`}>
                  <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 text-[10px] ${on ? 'border-white bg-white/25 text-white' : 'border-ink-3/60 text-transparent'}`}>✓</span>
                  {choice}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
