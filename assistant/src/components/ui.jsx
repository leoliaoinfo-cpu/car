import { useState, useMemo, useRef, useEffect } from 'react';

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
 * 客戶挑選器：輸入即時篩選（依姓名 / 電話），取代下拉選單。
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
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
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
