import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import {
  SHEET_BOXES, SHEET_BOX_PAIRS, normalizeSheet, emptySheet, prefillFromQuote, sheetHasContent,
} from '../../utils/optionSheet';

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

function Line({ value, onChange, readOnly, placeholder = '', style = {}, multiline = false }) {
  const base = { borderBottom: `1.5px solid ${INK}`, minWidth: 0, flex: 1, fontSize: 13, color: '#1d3fa8', fontWeight: 600, background: 'transparent', lineHeight: '20px', ...style };
  if (readOnly) {
    return <span style={{ ...base, display: 'block', minHeight: 24, paddingBottom: 2, whiteSpace: multiline ? 'pre-wrap' : 'nowrap', overflow: 'visible', width: multiline ? '100%' : undefined }}>{value}</span>;
  }
  if (multiline) {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3}
      style={{ ...base, border: 'none', borderBottom: `1.5px solid ${INK}`, width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.7 }} />;
  }
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off"
    style={{ ...base, border: 'none', borderBottom: `1.5px solid ${INK}`, borderRadius: 0, padding: '2px 2px', minHeight: 0, height: 24 }} />;
}

/** 紙本卡旺選配表（可編輯／唯讀兩用；唯讀版固定寬度，用來輸出圖片）。 */
export function SheetPaper({ sheet, onChange, readOnly = false, narrow = false }) {
  const set = (patch) => onChange?.({ ...sheet, ...patch });
  const setItem = (id, patch) => set({ items: { ...sheet.items, [id]: { on: false, note: '', ...(sheet.items[id] || {}), ...patch } } });
  const boxById = Object.fromEntries(SHEET_BOXES.map((b) => [b.id, b]));

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

  const renderItem = ([id, label, note]) => {
    const it = sheet.items[id] || { on: false, note: '' };
    return (
      <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: note ? (narrow ? '1 1 100%' : 1) : '0 1 auto' }}>
        <Check on={it.on} onChange={(on) => setItem(id, { on })} readOnly={readOnly} />
        <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
        {note && <Line value={it.note} onChange={(v) => setItem(id, { note: v, on: it.on || !!v })} readOnly={readOnly} />}
      </span>
    );
  };
  const renderBox = (id) => (
    <div key={id} style={{ ...box, display: 'flex', flexDirection: 'column', gap: 7, justifyContent: 'center' }}>
      {boxById[id].rows.map((row, i) => <div key={i} style={{ display: 'flex', gap: narrow ? '8px 16px' : 8, alignItems: 'center', minWidth: 0, flexWrap: narrow ? 'wrap' : 'nowrap' }}>{row.map(renderItem)}</div>)}
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
        {SHEET_BOX_PAIRS.map(([l, r]) => (
          <div key={l} style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>{renderBox(l)}{renderBox(r)}</div>
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
  const [narrow, setNarrow] = useState(() => window.innerWidth < 700);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 700);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const first = useRef(true);
  const exportRef = useRef(null);

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
    const { sheet: next, unmatched } = prefillFromQuote(sheet, quote);
    setSheet(next);
    setMsg(unmatched.length
      ? `已依報價勾好。「${unmatched.join('、')}」紙本上沒有對應的格子，已寫進客戶需求。`
      : '已依報價勾好，你可以再自己改。');
  }

  async function exportImage() {
    if (busy || !exportRef.current) return;
    setBusy(true); setMsg('');
    try {
      const node = exportRef.current;
      const canvas = await html2canvas(node, { scale: Math.min(2, window.devicePixelRatio || 2), backgroundColor: '#ffffff', logging: false, useCORS: true });
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
        <button type="button" disabled={busy} onClick={exportImage} className="btn-primary min-h-11 px-4 text-sm disabled:opacity-40">{busy ? '產生中…' : '存成圖片'}</button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-24 pt-3">
        <div className="mx-auto max-w-3xl space-y-3">
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
          {msg && <p role="status" className="rounded-xl border border-bdr bg-s2 p-3 text-xs leading-relaxed text-ink-2">{msg}</p>}

          <div className="overflow-hidden rounded-2xl border border-bdr bg-white shadow-card">
            <SheetPaper sheet={sheet} onChange={setSheet} narrow={narrow} />
          </div>

          <div className="flex justify-end">
            {!confirmClear
              ? <button type="button" onClick={() => setConfirmClear(true)} disabled={!sheetHasContent(sheet)} className="btn-ghost min-h-11 px-3 text-xs text-danger disabled:opacity-30">清空這張表</button>
              : <span className="flex items-center gap-2 text-xs"><b className="text-danger">全部勾選與文字都會清掉，確定嗎？</b>
                <button type="button" onClick={() => { setSheet(emptySheet(baseHeader)); setConfirmClear(false); setMsg(''); }} className="btn-danger min-h-11 px-3">清空</button>
                <button type="button" onClick={() => setConfirmClear(false)} className="btn-outline min-h-11 px-3">取消</button></span>}
          </div>
        </div>
      </div>

      {/* 輸出圖片用：固定寬度的唯讀版，畫面外 */}
      <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
        <div ref={exportRef} style={{ width: 760, background: '#fff' }}><SheetPaper sheet={sheet} readOnly /></div>
      </div>

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
