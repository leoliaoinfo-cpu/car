import { useEffect, useMemo, useRef, useState } from 'react';
import { renderSheetCanvas } from '../../utils/optionSheetImage';
import {
  DEFAULT_LAYOUT, sheetBoxes, normalizeLayout, newItemId, normalizeSheet, emptySheet, prefillFromQuote, sheetHasContent,
  layoutItems, matchSheetIds,
} from '../../utils/optionSheet';
import { calculateQuoteTotals } from '../../utils/pricing';
import { loadOptionSheetLayout, saveOptionSheetLayout, resetOptionSheetLayout } from '../../optionSheetLayout';

const AGENT_KEY = 'car-sales.optionSheet.agent';
const readAgent = () => { try { return localStorage.getItem(AGENT_KEY) || ''; } catch { return ''; } };
const rememberAgent = (v) => { try { if (v) localStorage.setItem(AGENT_KEY, v); } catch { /* 無痕模式 */ } };

// 紙本樣式：粗黑邊框、圓角、手寫底線
const INK = '#1b1b1b';
const box = { border: `2.5px solid ${INK}`, borderRadius: 16, padding: '8px 10px', minWidth: 0 };

function Tick({ size }) {
  return (
    <svg viewBox="0 0 20 20" width={size - 4} height={size - 4} style={{ display: 'block', position: 'absolute', left: 0, top: 0 }} aria-hidden="true">
      <path d="M3.5 10.5 8 15 16.5 4.5" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check({ on, onChange, readOnly, size = 20 }) {
  const style = {
    width: size, height: size, flex: 'none', borderRadius: 4, border: `2px solid ${INK}`, background: '#fff',
    position: 'relative', display: 'block', padding: 0, boxSizing: 'border-box',
  };
  const mark = on ? <Tick size={size} /> : null;
  if (readOnly) return <span style={style}>{mark}</span>;
  return <button type="button" role="checkbox" aria-checked={on} onClick={() => onChange(!on)} style={style}>{mark}</button>;
}

// 客戶需求：內容多幾行就自動長高，帶入的 ①②③… 全部看得到
function AutoGrowText({ value, onChange, placeholder, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [value]);
  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} style={style} />;
}

function Line({ value, onChange, readOnly, placeholder = '', style = {}, multiline = false, autoFocus = false }) {
  const base = { borderBottom: `1.5px solid ${INK}`, minWidth: 0, flex: 1, fontSize: 13, color: '#1d3fa8', fontWeight: 600, background: 'transparent', lineHeight: '20px', ...style };
  if (readOnly) {
    return <span style={{ ...base, display: 'block', minHeight: 24, paddingBottom: 2, whiteSpace: multiline ? 'pre-wrap' : 'nowrap', overflow: 'visible', width: multiline ? '100%' : undefined }}>{value}</span>;
  }
  if (multiline) return <AutoGrowText value={value} onChange={onChange} placeholder={placeholder} style={{ border: 'none', ...base, width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }} />;
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus}
    style={{ border: 'none', ...base, borderRadius: 0, padding: '2px 2px', minHeight: 0, height: 24 }} />;
}

/** 紙本卡旺選配表（可編輯／唯讀兩用；唯讀版固定寬度，用來輸出圖片）。 */
export function SheetPaper({ sheet, onChange, readOnly = false, narrow = false, layout = DEFAULT_LAYOUT }) {
  const set = (patch) => onChange?.({ ...sheet, ...patch });
  const setItem = (id, patch) => set({ items: { ...sheet.items, [id]: { on: false, note: '', ...(sheet.items[id] || {}), ...patch } } });
  const [openNotes, setOpenNotes] = useState([]);
  const boxes = sheetBoxes(layout, sheet);
  const boxPairs = [];
  for (let i = 0; i < boxes.length; i += 2) boxPairs.push(boxes.slice(i, i + 2));

  const field = (label, key, width) => (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, flex: width ? `0 0 ${width}` : '1 1 0', minWidth: 0 }}>
      <b style={{ fontSize: 17, whiteSpace: 'nowrap' }}>{label}</b>
      <Line value={sheet[key]} onChange={(v) => { set({ [key]: v }); if (key === 'agent') rememberAgent(v); }} readOnly={readOnly} style={{ fontSize: 15 }} />
    </div>
  );
  const flagField = (label, key) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <Check on={sheet[key].on} onChange={(on) => set({ [key]: { ...sheet[key], on } })} readOnly={readOnly} />
      <b style={{ fontSize: 16, whiteSpace: 'nowrap' }}>{label}</b>
      <Line value={sheet[key].text} onChange={(text) => set({ [key]: { ...sheet[key], text, on: sheet[key].on || !!text } })} readOnly={readOnly} />
    </div>
  );

  const renderItem = ([id, label, hasLine]) => {
    const it = sheet.items[id] || { on: false, note: '' };
    // 沒有填寫線的項目：填表時點旁邊的「✎」就能直接加一條線寫備註（不用進編輯表單）
    const note = hasLine || openNotes.includes(id);
    return (
      <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: note ? (narrow ? '1 1 100%' : 1) : '0 1 auto' }}>
        <Check on={it.on} onChange={(on) => setItem(id, { on })} readOnly={readOnly} />
        <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
        {note && <Line value={it.note} onChange={(v) => setItem(id, { note: v, on: it.on || !!v })} readOnly={readOnly} autoFocus={!hasLine} />}
        {!note && !readOnly && (
          <button type="button" onClick={() => setOpenNotes((list) => [...list, id])} aria-label={`${label}加備註線`}
            style={{ border: '1px dashed #b8c2cc', borderRadius: 6, background: 'transparent', color: '#7a8794', fontSize: 12, lineHeight: '18px', padding: '0 5px', minHeight: 0, flex: 'none' }}>✎</button>
        )}
      </span>
    );
  };
  const renderBox = (b) => (
    <div key={b.id} style={{ ...box, display: 'flex', flexDirection: 'column', gap: 7, justifyContent: 'center' }}>
      {b.rows.map((row, i) => <div key={i} style={{ display: 'flex', gap: narrow ? '8px 16px' : 8, alignItems: 'center', minWidth: 0, flexWrap: narrow ? 'wrap' : 'nowrap' }}>{row.map(renderItem)}</div>)}
    </div>
  );

  return (
    <div style={{ background: '#fff', color: INK, padding: 12, fontFamily: '-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif', width: readOnly ? 760 : '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.1, letterSpacing: -0.5 }}>KIA<div style={{ fontSize: 8, fontWeight: 500 }}>Movement that inspires</div></div>
        <div style={{ ...box, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px' }}>
          <b style={{ fontSize: narrow ? 20 : 24, letterSpacing: 2, whiteSpace: 'nowrap' }}>卡旺選配表</b>
          <span style={{ display: 'flex', alignItems: 'flex-end', gap: 4, fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap' }}>日期
            <Line value={sheet.date} onChange={(v) => set({ date: v })} readOnly={readOnly} style={{ width: 92, flex: 'none', textAlign: 'center' }} />
          </span>
        </div>
      </div>

      <div style={{ ...box, display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(0,1.15fr) minmax(0,1fr)', gap: '8px 14px', marginBottom: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {field('車主', 'owner')}{field('車型', 'model')}{field('車身號碼', 'vin')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>{field('車色', 'color')}{field('業代', 'agent')}</div>
          {flagField('貸款銀行', 'loan')}{flagField('現金購車', 'cash')}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {boxPairs.map((pair) => (
          <div key={pair[0].id} style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>{pair.map(renderBox)}</div>
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={26} on={sheet.trade} onChange={(trade) => set({ trade })} readOnly={readOnly} /><b style={{ fontSize: 22 }}>舊換新</b>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <Check size={26} on={sheet.plate.on} onChange={(on) => set({ plate: { ...sheet.plate, on } })} readOnly={readOnly} /><b style={{ fontSize: 22 }}>選牌</b>
            <Line value={sheet.plate.text} onChange={(text) => set({ plate: { text, on: sheet.plate.on || !!text } })} readOnly={readOnly} style={{ fontSize: 18 }} />
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Check size={26} on={sheet.needs.on} onChange={(on) => set({ needs: { ...sheet.needs, on } })} readOnly={readOnly} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 22 }}>客戶需求</b>
            <Line multiline value={sheet.needs.text} onChange={(text) => set({ needs: { text, on: sheet.needs.on || !!text } })} readOnly={readOnly} placeholder="例如：①魚眼大燈 ②車底除鏽 ③行李橫桿（黑化）" />
          </div>
        </div>
      </div>
    </div>
  );
}


function move(list, i, d) {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** 編輯表單格式：自己新增／刪除／改名勾選項、決定哪些有填寫線、調整順序與區塊。 */
function LayoutEditor({ layout, onChange, onDone, onReset }) {
  const boxes = layout.boxes;
  const [confirm, setConfirm] = useState(null); // 'reset' | `box:${id}` | `item:${id}`
  const setBoxes = (next) => onChange({ boxes: next });
  const setBox = (bi, patch) => setBoxes(boxes.map((b, i) => (i === bi ? { ...b, ...patch } : b)));
  const setItem = (bi, ii, patch) => setBox(bi, { items: boxes[bi].items.map((it, k) => (k === ii ? { ...it, ...patch } : it)) });
  const arrow = 'btn-outline min-h-10 min-w-10 px-0 text-sm disabled:opacity-30';

  return (
    <div className="flex-1 overflow-y-auto px-2 pb-24 pt-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <p className="rounded-xl border border-bdr bg-s2 p-3 text-xs leading-relaxed text-ink-2">
          在這裡設定選配表上有哪些勾選項。<b>改名、新增、刪除、調整順序</b>都可以；「有填寫線」打開，該項目後面就多一條可以打字的線（例如寫顏色）。
          已經填過的舊案件資料不會因為你刪掉項目而消失。
        </p>
        {boxes.map((b, bi) => (
          <section key={b.id} className="card space-y-2 p-3">
            <div className="flex items-center gap-2">
              <b className="flex-1 text-sm text-ink">區塊 {bi + 1}<span className="ml-2 text-[11px] font-normal text-ink-3">{bi % 2 === 0 ? '左邊' : '右邊'}</span></b>
              <button type="button" className={arrow} disabled={bi === 0} onClick={() => setBoxes(move(boxes, bi, -1))} aria-label="區塊往前">↑</button>
              <button type="button" className={arrow} disabled={bi === boxes.length - 1} onClick={() => setBoxes(move(boxes, bi, 1))} aria-label="區塊往後">↓</button>
              {confirm === `box:${b.id}`
                ? <><button type="button" className="btn-danger min-h-10 px-3 text-xs" onClick={() => { setBoxes(boxes.filter((_, i) => i !== bi)); setConfirm(null); }}>確定刪除</button>
                  <button type="button" className="btn-outline min-h-10 px-3 text-xs" onClick={() => setConfirm(null)}>取消</button></>
                : <button type="button" className="btn-outline min-h-10 px-3 text-xs text-danger" onClick={() => setConfirm(`box:${b.id}`)}>刪除區塊</button>}
            </div>
            {b.items.length === 0 && <p className="text-xs text-ink-3">這個區塊還沒有項目。</p>}
            {b.items.map((it, ii) => (
              <div key={it.id} className="rounded-xl border border-bdr bg-s1 p-2">
                <div className="flex items-center gap-2">
                  <input value={it.label} onChange={(e) => setItem(bi, ii, { label: e.target.value })} aria-label="項目名稱" placeholder="項目名稱" className="min-h-11 min-w-0 flex-1 text-sm" />
                  <button type="button" className={arrow} disabled={ii === 0} onClick={() => setBox(bi, { items: move(b.items, ii, -1) })} aria-label="項目往上">↑</button>
                  <button type="button" className={arrow} disabled={ii === b.items.length - 1} onClick={() => setBox(bi, { items: move(b.items, ii, 1) })} aria-label="項目往下">↓</button>
                  {confirm === `item:${it.id}`
                    ? <button type="button" className="btn-danger min-h-10 px-2 text-xs" onClick={() => { setBox(bi, { items: b.items.filter((_, k) => k !== ii) }); setConfirm(null); }}>確定刪除</button>
                    : <button type="button" className="btn-outline min-h-10 min-w-10 px-0 text-sm text-danger" onClick={() => setConfirm(`item:${it.id}`)} aria-label="刪除項目">✕</button>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                  <label className="flex min-h-10 items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={it.note} onChange={(e) => setItem(bi, ii, { note: e.target.checked })} className="h-5 w-5" />後面有填寫線</label>
                  {ii > 0 && <label className="flex min-h-10 items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={it.sameRow} onChange={(e) => setItem(bi, ii, { sameRow: e.target.checked })} className="h-5 w-5" />和上一項同一行</label>}
                </div>
              </div>
            ))}
            <button type="button" className="btn-outline min-h-11 w-full text-sm font-bold" onClick={() => setBox(bi, { items: [...b.items, { id: newItemId(), label: '', note: false, sameRow: false }] })}>＋ 新增項目</button>
          </section>
        ))}
        <button type="button" className="btn-outline min-h-12 w-full font-bold" onClick={() => setBoxes([...boxes, { id: `box-${newItemId()}`, items: [] }])}>＋ 新增區塊</button>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {confirm === 'reset'
            ? <span className="flex items-center gap-2 text-xs"><b className="text-danger">表單格式會變回原本紙本那樣，確定嗎？</b>
              <button type="button" className="btn-danger min-h-11 px-3" onClick={() => { onReset(); setConfirm(null); }}>還原</button>
              <button type="button" className="btn-outline min-h-11 px-3" onClick={() => setConfirm(null)}>取消</button></span>
            : <button type="button" className="btn-ghost min-h-11 px-3 text-xs text-danger" onClick={() => setConfirm('reset')}>還原成原本的紙本格式</button>}
          <button type="button" className="btn-primary min-h-12 px-6 font-bold" onClick={onDone}>完成</button>
        </div>
      </div>
    </div>
  );
}

const twd = (n) => Math.round(Number(n) || 0).toLocaleString('zh-TW');

/** 選配表旁邊的報價對照：逐項列出品名、價格、規格、備註，並標出選配表有沒有勾到。 */
function QuoteCompare({ quote, isWon, sheet, layout }) {
  if (!quote) return null;
  const visible = new Set(layoutItems(layout).map((x) => x.id));
  const items = (quote.items || []).filter((it) => String(it?.name || '').trim() && !it.pending);
  const totals = calculateQuoteTotals(quote.items || [], quote.generalDiscounts || []);
  const statusOf = (it) => {
    if (it.kind === 'vehicle') return null;
    const ids = matchSheetIds(it).filter((id) => visible.has(id));
    if (!ids.length) return it.kind === 'other' ? null : { text: '紙本沒有這格', cls: 'border-bdr text-ink-3' };
    const on = ids.filter((id) => sheet.items[id]?.on).length;
    if (on === ids.length) return { text: '✓ 已勾', cls: 'border-ok/40 bg-ok/10 text-ok' };
    return { text: on ? `⚠ 只勾 ${on}/${ids.length}` : '⚠ 還沒勾', cls: 'border-warn/50 bg-warn/15 text-black' };
  };
  return (
    <section className="card space-y-2 p-3" aria-label="對照報價">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">📄 對照報價{isWon ? '（成交版）' : ''}</p>
          <p className="truncate text-[11px] text-ink-3">{[quote.planName, quote.model].filter(Boolean).join('・')}</p>
        </div>
        <p className="shrink-0 text-right text-xs font-bold text-ink">NT$ {twd(totals.total)}</p>
      </div>
      <ul className="divide-y divide-bdr">
        {items.map((it) => {
          const st = statusOf(it);
          const cut = (it.deductions || []).filter((d) => String(d?.name || '').trim());
          return (
            <li key={it.id} className="py-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-xs font-semibold text-ink">{it.name}{it.optionValue ? <span className="text-accent">（{it.optionValue}）</span> : null}</p>
                <p className="shrink-0 text-xs text-ink-2">{it.gift ? '🎁 贈送' : twd(it.price)}</p>
              </div>
              {cut.length > 0 && <p className="text-[11px] text-ink-3">不含：{cut.map((d) => d.name).join('＋')}</p>}
              {String(it.note || '').trim() && <p className="whitespace-pre-wrap rounded bg-accent/5 px-1.5 py-0.5 text-[11px] text-ink-2">📝 {String(it.note).trim()}</p>}
              {st && <span className={`mt-0.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.text}</span>}
            </li>
          );
        })}
      </ul>
      {(quote.generalDiscounts || []).filter((d) => Number(d?.amount) > 0).map((d) => (
        <p key={d.id || d.name} className="flex justify-between text-[11px] text-ok"><span>{d.name}</span><span>−{twd(d.amount)}</span></p>
      ))}
      {String(quote.note || '').trim() && <p className="whitespace-pre-wrap rounded-lg border border-bdr bg-s2 p-2 text-[11px] text-ink-2">中央備註：{String(quote.note).trim()}</p>}
    </section>
  );
}

/** 全螢幕選配表：自己勾選、自動存檔、可依報價帶入、可存成圖片。 */
export default function OptionSheet({ item, deal, quotes, onSave, onClose }) {
  const baseHeader = useMemo(() => ({
    owner: item.clientName || '', agent: readAgent(),
    model: (deal?.model || quotes[0]?.model || '').replace(/^2027\s*年式\s*/, '').trim(),
  }), [item.clientName, deal?.model, quotes]);
  const [sheet, setSheet] = useState(() => normalizeSheet(item.optionSheet || emptySheet(baseHeader), baseHeader));
  const [quoteId, setQuoteId] = useState(() => (deal?.quoteId && quotes.some((q) => q.id === deal.quoteId) ? deal.quoteId : quotes[0]?.id || ''));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [editingLayout, setEditingLayout] = useState(false);
  const layoutFirst = useRef(true);
  const layoutDirty = useRef(false);
  useEffect(() => { loadOptionSheetLayout().then(setLayout).catch(() => {}); }, []);
  // 改格式也是停手 0.6 秒自動存；只有真的改過才寫進資料庫
  useEffect(() => {
    if (layoutFirst.current) { layoutFirst.current = false; return undefined; }
    if (!layoutDirty.current) return undefined;
    const timer = setTimeout(() => { saveOptionSheetLayout(layout).catch(() => {}); }, 600);
    return () => clearTimeout(timer);
  }, [layout]);
  const changeLayout = (next) => { layoutDirty.current = true; setLayout(next); };
  const [narrow, setNarrow] = useState(() => window.innerWidth < 700);
  const [wide, setWide] = useState(() => window.innerWidth >= 1100); // 夠寬就左右分屏：左選配表、右報價
  const [showCompare, setShowCompare] = useState(false);
  useEffect(() => {
    const on = () => { setNarrow(window.innerWidth < 700); setWide(window.innerWidth >= 1100); };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const first = useRef(true);

  // 自動存檔：停手 0.8 秒就存，不用按儲存
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    const timer = setTimeout(() => { saveRef.current(sheet); }, 800);
    return () => clearTimeout(timer);
  }, [sheet]);
  useEffect(() => () => { if (image?.url) URL.revokeObjectURL(image.url); }, [image]);

  function fillFromQuote() {
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) { setMsg('這個案件還沒有報價可以帶入。'); return; }
    const { sheet: next, unmatched } = prefillFromQuote(sheet, quote, layout);
    setSheet(next);
    setMsg(unmatched.length
      ? `已依報價勾好。「${unmatched.join('、')}」紙本上沒有對應的格子，已寫進客戶需求。`
      : '已依報價勾好，你可以再自己改。');
  }

  async function exportImage() {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      // 等字型載入完再畫，避免第一次畫出來字型不對
      try { await document.fonts?.ready; } catch { /* 不支援就直接畫 */ }
      const canvas = renderSheetCanvas({ sheet, layout, scale: 2 });
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('empty');
      const name = `卡旺選配表-${(sheet.owner || item.clientName || '客戶').replace(/[\\/:*?"<>|]/g, '')}-${sheet.date}.png`;
      setImage((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return { blob, name, url: URL.createObjectURL(blob), file: new File([blob], name, { type: 'image/png' }) }; });
    } catch {
      setMsg('圖片產生失敗，請再試一次。');
    } finally { setBusy(false); }
  }
  async function shareImage() {
    if (!image) return;
    try {
      if (navigator.canShare?.({ files: [image.file] })) { await navigator.share({ files: [image.file], title: image.name }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = image.url; a.download = image.name; a.click();
  }

  return (
    <div className="safe-screen fixed inset-0 z-50 flex flex-col bg-bg anim-fade-in">
      <div className="flex items-center gap-2 border-b border-bdr bg-s1 px-3 py-2">
        <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-3" aria-label="返回">←</button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">📋 卡旺選配表</p>
          <p className="truncate text-[11px] text-ink-3">{item.clientName}・點方框勾選，自動存檔</p>
        </div>
        {!editingLayout && !wide && quotes.length > 0 && <button type="button" onClick={() => setShowCompare((v) => !v)} aria-pressed={showCompare}
          className={`btn-outline min-h-11 px-3 text-xs font-bold ${showCompare ? 'border-accent text-accent bg-accent/10' : ''}`}>📄 報價</button>}
        {!editingLayout && <button type="button" onClick={() => setEditingLayout(true)} className="btn-outline min-h-11 px-3 text-xs font-bold">⚙ 編輯表單</button>}
        {!editingLayout && <button type="button" disabled={busy} onClick={exportImage} className="btn-primary min-h-11 px-4 text-sm disabled:opacity-40">{busy ? '產生中…' : '存成圖片'}</button>}
      </div>

      {editingLayout && <LayoutEditor layout={layout} onChange={changeLayout} onDone={() => setEditingLayout(false)}
        onReset={async () => { layoutDirty.current = false; setLayout(await resetOptionSheetLayout()); }} />}

      {!editingLayout && <div className="flex-1 overflow-y-auto px-2 pb-24 pt-3">
        <div className={wide && quotes.length > 0 ? 'mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)_400px] items-start gap-4' : ''}>
        <div className="mx-auto max-w-3xl space-y-3 w-full">
          {quotes.length > 0 && (
            <div className="card flex flex-wrap items-center gap-2 p-3">
              {quotes.length > 1 && (
                <select value={quoteId} onChange={(e) => setQuoteId(e.target.value)} aria-label="選擇報價" className="min-h-11 min-w-0 flex-1 text-sm">
                  {quotes.map((q, i) => <option key={q.id} value={q.id}>{`報價 ${i + 1}・${q.model || ''}`}{q.id === deal?.quoteId ? '（成交）' : ''}</option>)}
                </select>
              )}
              <button type="button" onClick={fillFromQuote} className="btn-outline min-h-11 flex-1 text-sm font-bold">✨ 依報價帶入勾選</button>
            </div>
          )}
          {!wide && showCompare && <QuoteCompare quote={quotes.find((q) => q.id === quoteId)} isWon={quoteId === deal?.quoteId} sheet={sheet} layout={layout} />}
          {msg && <p role="status" className="rounded-xl border border-bdr bg-s2 p-3 text-xs leading-relaxed text-ink-2">{msg}</p>}

          <div className="overflow-hidden rounded-2xl border border-bdr bg-white shadow-card">
            <SheetPaper sheet={sheet} onChange={setSheet} narrow={narrow} layout={layout} />
          </div>

          <div className="flex justify-end">
            {!confirmClear
              ? <button type="button" onClick={() => setConfirmClear(true)} disabled={!sheetHasContent(sheet)} className="btn-ghost min-h-11 px-3 text-xs text-danger disabled:opacity-30">清空這張表</button>
              : <span className="flex items-center gap-2 text-xs"><b className="text-danger">全部勾選與文字都會清掉，確定嗎？</b>
                <button type="button" onClick={() => { setSheet(emptySheet(baseHeader)); setConfirmClear(false); setMsg(''); }} className="btn-danger min-h-11 px-3">清空</button>
                <button type="button" onClick={() => setConfirmClear(false)} className="btn-outline min-h-11 px-3">取消</button></span>}
          </div>
        </div>
        {wide && quotes.length > 0 && (
          <div className="sticky top-0 max-h-[calc(100vh-7rem)] overflow-y-auto">
            <QuoteCompare quote={quotes.find((q) => q.id === quoteId)} isWon={quoteId === deal?.quoteId} sheet={sheet} layout={layout} />
          </div>
        )}
        </div>
      </div>}

      {image && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/70 p-3" onClick={() => setImage(null)}>
          <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-white"><img src={image.url} alt="選配表圖片" className="block w-full" /></div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={shareImage} className="btn-primary min-h-12 font-bold">分享／下載</button>
              <button type="button" onClick={() => setImage(null)} className="btn-outline min-h-12 bg-s1">關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
