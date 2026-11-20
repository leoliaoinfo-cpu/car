import { useState, useMemo, useRef, useEffect, Children } from 'react';

/** 表單欄位：標題固定顯示在輸入框上方，打字後欄位名稱不會消失 */
export function Field({ label, required, className = '', children }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-[11px] font-medium text-ink-3 mb-1">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * 客戶挑選器：輸入即時篩選（姓名 / 電話 / LINE / 公司 / 車牌），取代下拉選單。
 * 客戶量大時也能快速找到人。value 為客戶 id（空字串＝未選）。
 */
export function ClientPicker({
  clients, value, onChange,
  placeholder = '輸入姓名或電話搜尋…', excludeId = null, allowClear = true,
}) {
  const selected = clients.find((c) => c.id === value) || null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const wrapRef = useRef(null);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients
      .filter((c) => c.id !== excludeId)
      .filter((c) => !q || [c.name, c.phone, c.lineId, c.company, c.plate, c.licensePlate]
        .some((value) => String(value || '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, 8);
  }, [clients, query, excludeId]);

  // 點元件外關閉下拉
  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(c) { onChange(c.id); setQuery(''); setOpen(false); setIdx(0); }

  // 已選：顯示為可移除的標籤
  if (selected) {
    return (
      <div className="flex items-center gap-2 w-full rounded-lg border border-bdr bg-s2 px-3 py-2">
        <span className="flex-1 min-w-0 truncate text-sm text-ink">{selected.name}</span>
        {selected.phone && <span className="text-xs text-ink-3 shrink-0">{selected.phone}</span>}
        {allowClear && (
          <button type="button" onClick={() => onChange('')}
            className="text-ink-3 hover:text-danger shrink-0 text-sm">✕</button>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setIdx(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || candidates.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % candidates.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i - 1 + candidates.length) % candidates.length); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(candidates[idx]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        placeholder={placeholder}
        className="w-full text-sm"
      />
      {open && candidates.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg border border-bdr bg-s1 shadow-panel max-h-52 overflow-y-auto anim-fade-in">
          {candidates.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setIdx(i)}
              className={`flex items-center gap-2 w-full text-left px-3 py-2 text-sm ${i === idx ? 'bg-accent/15' : 'hover:bg-s2'}`}
            >
              <span className="font-medium text-ink truncate">{c.name}</span>
              {c.phone && <span className="text-xs text-ink-3 shrink-0 ml-auto">{c.phone}</span>}
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && candidates.length === 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg border border-bdr bg-s1 shadow-panel px-3 py-2 text-xs text-ink-3">
          找不到符合的客戶
        </div>
      )}
    </div>
  );
}

/**
 * 兩段式刪除鈕：第一下變紅色「確定刪除?」，再按一下才真正刪除；幾秒沒按就自動恢復。
 */
export function ConfirmDeleteButton({ onConfirm, label = '✕', className = '', ariaLabel, timeout = 3500 }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), timeout);
    return () => clearTimeout(t);
  }, [armed, timeout]);
  return (
    <button
      type="button"
      aria-label={armed ? '確定刪除' : ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) { setArmed(false); onConfirm(); } else setArmed(true);
      }}
      className={armed ? 'text-[11px] font-semibold text-white bg-danger rounded px-1.5 py-0.5 shrink-0 whitespace-nowrap' : className}
    >
      {armed ? '確定刪除?' : label}
    </button>
  );
}

/** 把 <option> 子元素攤平成 [{value,label,disabled}]（支援 Fragment、陣列、map 產生的選項）。 */
function collectOptions(children, out = []) {
  Children.forEach(children, (child) => {
    if (!child || typeof child !== 'object') return;
    if (child.type === 'option') {
      const text = Children.toArray(child.props.children).join('');
      out.push({ value: child.props.value != null ? String(child.props.value) : text, label: text, disabled: !!child.props.disabled });
    } else if (child.props?.children) collectOptions(child.props.children, out);
  });
  return out;
}

const CHIP_SELECT_MAX = 14;

/**
 * 勾選式選擇（使用者規定：選項一律用勾選按鈕、不要下拉選單）。
 * 用法和 <select> 一樣：value／onChange(event.target.value)／<option> 子元素。
 * 選項超過 14 個（例如整份客戶名單）才退回原生下拉，不然一整面都是按鈕。
 */
export function ChipSelect({ value, onChange, children, disabled, className = '', 'aria-label': ariaLabel, id, ...rest }) {
  const options = collectOptions(children);
  if (options.length > CHIP_SELECT_MAX) {
    return <select value={value} onChange={onChange} disabled={disabled} className={className} aria-label={ariaLabel} id={id} {...rest}>{children}</select>;
  }
  const current = String(value ?? '');
  return (
    <div role="radiogroup" aria-label={ariaLabel} id={id} className="mt-1 flex min-w-0 flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = opt.value === current;
        return (
          <button key={opt.value} type="button" role="radio" aria-checked={on} disabled={disabled || opt.disabled}
            onClick={() => { if (!on) onChange?.({ target: { value: opt.value } }); }}
            className={`flex min-h-11 items-center gap-1.5 rounded-lg border-2 px-3 text-sm font-bold disabled:opacity-50 ${on ? 'border-accent bg-accent text-on-accent' : 'border-bdr bg-s1 text-ink-2'}`}>
            <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 text-[10px] ${on ? 'border-white bg-white/25 text-white' : 'border-ink-3/60 text-transparent'}`}>✓</span>
            {opt.label || '（未選）'}
          </button>
        );
      })}
    </div>
  );
}
