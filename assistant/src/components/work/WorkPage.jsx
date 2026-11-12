import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { addDays, today } from '../../utils/date';
import { EVENT_TYPES, generateId } from '../../utils/crm';
import { canCancel, canSnooze, primaryLabel, useWorkActions } from './useWorkActions';

const FILTERS = [
  ['overdue', '逾期'], ['today', '今天'], ['next', '接下來'], ['waiting', '還在等'],
];
const EMPTY_TEXT = {
  overdue: '沒有逾期的事',
  today: '今天的事都做完了',
  next: '接下來沒有排好的事',
  waiting: '沒有在等別人的事',
};
const WHO_FALLBACK = { task: '我的待辦', timer: '提醒', event: '活動', workItem: '我的待辦' };
const STALE_PREVIEW = 3;

function dueText(row) {
  if (row.stale) return '太久沒追';
  if (row.followUpReminder && row.group === 'overdue') return `該追了 ${dayjs(row.due).format('M/D')}`;
  if (row.followUpReminder && row.group === 'today') return '今天要追';
  if (row.waitingOn) return `等：${row.waitingOn}`;
  if (!row.due) return '沒排日期';
  const time = row.time ? ` ${row.time}` : '';
  if (row.group === 'overdue') return `逾期 ${dayjs(row.due).format('M/D')}`;
  if (row.group === 'today') return `今天${time}`;
  return `${dayjs(row.due).format('M/D（dd）')}${time}`;
}

function badgeTone(row) {
  if (row.group === 'overdue' || row.stale) return 'bg-danger/12 text-danger';
  if (row.group === 'waiting') return 'bg-gold/12 text-gold';
  return 'bg-accent/10 text-accent';
}

export default function WorkPage({ onOpenClient, onOpenCase, onOpenOperations, onOpenCalendar, onOpenCases, onQuickCreate }) {
  const { clients, saveTask } = useApp();
  const { queue, busyId, complete, snoozeTo, cancel, openRow } = useWorkActions({ onOpenClient, onOpenCase, onOpenOperations, onOpenCalendar });
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, queue.filter((row) => row.group === key).length])), [queue]);
  const firstActive = FILTERS.find(([key]) => counts[key] > 0)?.[0] || 'today';
  const [filter, setFilter] = useState(firstActive);
  const [openId, setOpenId] = useState(null); // 點卡片展開的其他動作
  const [snoozingId, setSnoozingId] = useState(null);
  const [cancelingId, setCancelingId] = useState(null);
  const [showAllStale, setShowAllStale] = useState(false);

  const inGroup = queue.filter((row) => row.group === filter);
  const staleRows = inGroup.filter((row) => row.stale);
  const visible = showAllStale || staleRows.length <= STALE_PREVIEW
    ? inGroup
    : [...inGroup.filter((row) => !row.stale), ...staleRows.slice(0, STALE_PREVIEW)];
  const hiddenStale = inGroup.length - visible.length;
  const nextAvailableFilter = FILTERS.find(([key]) => key !== filter && counts[key] > 0);

  async function doSnooze(row, due) {
    await snoozeTo(row, due);
    setSnoozingId(null);
  }

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-5 py-3 md:py-6 space-y-2.5">
      <header className="flex items-center justify-between gap-3 px-1">
        <h1 className="text-lg font-bold text-ink">{dayjs().format('M月D日 dddd')}</h1>
        <button type="button" onClick={onQuickCreate} className="hidden lg:inline-flex btn-primary min-h-10 shrink-0">＋ 新增</button>
      </header>

      <div className="grid grid-cols-4 gap-1.5" role="tablist" aria-label="工作篩選">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
            className={`min-h-11 rounded-xl border px-1 text-sm transition-colors ${filter === key ? 'border-copper bg-copper/12 text-copper font-bold' : 'border-bdr bg-s1 text-ink-2'}`}>
            {label} <strong className={key === 'overdue' && counts[key] > 0 ? 'text-danger' : ''}>{counts[key]}</strong>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <section className="card px-5 py-8 text-center">
          <h2 className="font-bold text-ink">{EMPTY_TEXT[filter]}</h2>
          {nextAvailableFilter && <button type="button" onClick={() => setFilter(nextAvailableFilter[0])} className="btn-primary mt-4 min-h-11 px-5">看「{nextAvailableFilter[1]}」{counts[nextAvailableFilter[0]]} 件</button>}
        </section>
      ) : (
        <div className="space-y-2" data-testid="work-list">
          {visible.map((row) => {
            const who = row.clientName || WHO_FALLBACK[row.sourceType] || '待辦';
            const what = [row.title, row.caseTitle].filter(Boolean).join('・');
            const open = openId === row.id;
            return (
              <article key={row.id} data-work-id={row.id} className={`card px-3 py-2.5 border-l-4 ${row.group === 'overdue' || row.stale ? 'border-l-danger' : row.group === 'waiting' ? 'border-l-gold' : 'border-l-copper'}`}>
                <button type="button" onClick={() => { setOpenId(open ? null : row.id); setSnoozingId(null); setCancelingId(null); }} className="w-full text-left" aria-expanded={open}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-bold text-ink">{row.urgent && <span className="text-danger">急件 </span>}{who}</p>
                    <span className={`badge shrink-0 ${badgeTone(row)}`}>{dueText(row)}</span>
                  </div>
                  <p className={`mt-0.5 text-sm text-ink-2 ${open ? '' : 'truncate'}`}>{what}{row.note ? `・${row.note}` : ''}</p>
                </button>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busyId != null} onClick={() => complete(row)} className="btn-primary flex-1 min-h-10 disabled:opacity-50">{primaryLabel(row)}</button>
                  {canSnooze(row) && <button type="button" disabled={busyId != null} onClick={() => { setSnoozingId(snoozingId === row.id ? null : row.id); setCancelingId(null); }} className="btn-outline min-h-10 px-4">{row.stale ? '排日期' : '延後'}</button>}
                </div>
                {snoozingId === row.id && (
                  <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-s2 p-2">
                    <button type="button" onClick={() => doSnooze(row, addDays(today(), 1))} className="btn-outline bg-s1 min-h-10">明天</button>
                    <button type="button" onClick={() => doSnooze(row, addDays(today(), 3))} className="btn-outline bg-s1 min-h-10">3 天後</button>
                    <label className="btn-outline bg-s1 min-h-10 relative overflow-hidden">選日期
                      <input type="date" aria-label="延後到指定日期" min={today()} onChange={(event) => event.target.value && doSnooze(row, event.target.value)} className="absolute inset-0 h-full w-full opacity-0" />
                    </label>
                  </div>
                )}
                {open && (
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-bdr pt-2">
                    {row.caseId && <button type="button" onClick={() => onOpenCase?.(row.caseId)} className="btn-outline min-h-10 text-xs">看案件</button>}
                    {row.clientId && <button type="button" onClick={() => onOpenClient?.(row.clientId)} className="btn-outline min-h-10 text-xs">看客戶</button>}
                    {row.sourceType === 'delivery' && <button type="button" onClick={() => openRow(row)} className="btn-outline min-h-10 text-xs">看施工進度</button>}
                    {canCancel(row) && <button type="button" onClick={() => setCancelingId(row.id)} className="btn-ghost min-h-10 text-xs text-danger">不用做了</button>}
                  </div>
                )}
                {cancelingId === row.id && (
                  <div role="alert" className="mt-2 rounded-xl border border-danger/35 bg-danger/5 p-3">
                    <p className="text-sm font-bold text-danger">確定不做「{row.title}」？</p>
                    <p className="mt-1 text-xs text-ink-3">會從工作清單拿掉，案件紀錄還在。</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setCancelingId(null)} className="btn-outline min-h-10">先留著</button>
                      <button type="button" onClick={async () => { await cancel(row); setCancelingId(null); }} className="btn-danger min-h-10">確定不做</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          {hiddenStale > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowAllStale(true)} className="btn-outline min-h-11 text-sm">還有 {hiddenStale} 件太久沒追</button>
              <button type="button" onClick={onOpenCases} className="btn-outline min-h-11 text-sm">到案件頁整理</button>
            </div>
          )}
        </div>
      )}

      <AddTask clients={clients} onSave={saveTask} />
      <TodayResults clients={clients} />
    </div>
  );
}

/** 記一件不屬於任何案件的待辦（原本在「完整工作總覽」）。 */
function AddTask({ onSave }) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  async function submit(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await onSave({ id: generateId('task'), text: value, done: false, doneAt: null, due: due || null, clientId: null, clientName: null });
      setSaved(due ? `已加入，${dayjs(due).format('M/D')} 會提醒` : '已加入「接下來」');
      setText('');
      setDue('');
    } catch (cause) {
      window.alert(cause?.message || '待辦儲存失敗。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="card">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-bold text-ink-2">📝 記一件待辦</summary>
      <form onSubmit={submit} className="space-y-2 border-t border-bdr p-3">
        <input value={text} onChange={(event) => { setText(event.target.value); setSaved(''); }} placeholder="例：繳牌照稅、回電給保險" aria-label="待辦內容" className="min-h-11 w-full" />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label="哪一天要做（可不填）" className="min-h-11 w-full" />
          <button disabled={saving || !text.trim()} className="btn-primary min-h-11 px-5 disabled:opacity-50">{saving ? '加入中…' : '加入'}</button>
        </div>
        <p className="text-xs text-ink-3">{saved || '日期可以不填，會放在「接下來」。'}</p>
      </form>
    </details>
  );
}

/** 今天做了什麼：從客戶紀錄自動統計，不用自己寫日報。 */
function TodayResults({ clients }) {
  const results = useMemo(() => {
    const date = today();
    const counts = {};
    const amounts = {};
    for (const client of clients) {
      for (const entry of client.log || []) {
        if (entry.date !== date) continue;
        counts[entry.type] = (counts[entry.type] || 0) + 1;
        if (entry.amount > 0) amounts[entry.type] = (amounts[entry.type] || 0) + entry.amount;
      }
    }
    return ['deal', 'contact', 'line', 'quote', 'visit', 'loan', 'order', 'delivery', 'aftercare', 'missed']
      .filter((type) => counts[type])
      .map((type) => ({ type, ...EVENT_TYPES[type], count: counts[type], amount: amounts[type] }));
  }, [clients]);
  if (results.length === 0) return null;
  const total = results.reduce((sum, row) => sum + row.count, 0);
  return (
    <details className="card">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-bold text-ink-2">📊 今天做了 {total} 件事</summary>
      <div className="flex flex-wrap gap-2 border-t border-bdr p-3">
        {results.map((row) => (
          <span key={row.type} className="rounded-lg px-2.5 py-1.5 text-xs font-medium" style={{ background: `${row.color}14`, color: row.color }}>
            {row.icon} {row.label} × {row.count}{row.amount > 0 ? `　NT$ ${row.amount.toLocaleString('zh-TW')}` : ''}
          </span>
        ))}
      </div>
    </details>
  );
}
