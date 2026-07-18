import { useState, useMemo } from 'react';
import { useApp } from '../../context';
import { getClientStatus, STATUS_COLOR, formatMoney, generateId, getOccasionsOnDate } from '../../utils/crm';
import { today } from '../../utils/date';
import { downloadICS } from '../../utils/ics';
import { Field, ClientPicker } from '../ui';
import dayjs from 'dayjs';

// 行事曆事件型別（活動 / 追蹤 / 提醒 / 成交 / 紀念日）
const EV = {
  event:    { icon: '🗓', label: '活動', color: '#6f9a9c' },
  follow:   { icon: '📅', label: '追蹤', color: '#bf8a5e' },
  timer:    { icon: '⏰', label: '提醒', color: '#9382a5' },
  deal:     { icon: '🏆', label: '成交', color: '#a99760' },
  occasion: { icon: '🎉', label: '紀念日', color: '#b58a96' },
};

export default function CalendarPage({ onOpenClient }) {
  const { clients, timers, deals, customFields, events, saveEvent, deleteEvent, updateClient, thresholds } = useApp();
  const todayStr = today();
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'));
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [eventModal, setEventModal] = useState(null); // null | {date} 新增 | event 物件 編輯
  const [exportMsg, setExportMsg] = useState('');

  // date(YYYY-MM-DD) -> 事件列表
  const eventsByDate = useMemo(() => {
    const map = {};
    const push = (date, ev) => {
      if (!date) return;
      (map[date] = map[date] || []).push(ev);
    };
    for (const c of clients) {
      if (c.nextDate) {
        push(c.nextDate, {
          type: 'follow', clientId: c.id, title: c.name,
          sub: c.phone || '', client: c,
        });
      }
    }
    for (const t of timers) {
      if (t.confirmedAt) continue;
      push(dayjs(t.triggerAt).format('YYYY-MM-DD'), {
        type: 'timer', clientId: t.clientId || null, title: t.note || t.clientName,
        sub: t.clientName || '', time: dayjs(t.triggerAt).format('HH:mm'),
      });
    }
    for (const d of deals) {
      push(d.date, {
        type: 'deal', clientId: d.clientId, title: d.clientName || '成交',
        sub: `NT$ ${formatMoney(d.amount)}${d.note ? `・${d.note}` : ''}`,
      });
    }
    // 提醒依時間排序、追蹤在前
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }
    return map;
  }, [clients, timers, deals]);

  // 月曆格子：從該月第一週的週一到最後一週的週日
  const weeks = useMemo(() => {
    const first = dayjs(monthKey + '-01');
    let d = first.startOf('week');
    const end = first.endOf('month').endOf('week');
    const out = [];
    let week = [];
    while (d.isBefore(end) || d.isSame(end, 'day')) {
      week.push(d);
      if (week.length === 7) { out.push(week); week = []; }
      d = d.add(1, 'day');
    }
    return out;
  }, [monthKey]);

  // 紀念日（自訂日期欄位）：僅需計算目前顯示的月曆範圍
  const occasionsByDate = useMemo(() => {
    const map = {};
    for (const week of weeks) {
      for (const d of week) {
        const ds = d.format('YYYY-MM-DD');
        const os = getOccasionsOnDate(clients, customFields, ds);
        for (const o of os) {
          (map[ds] = map[ds] || []).push({
            type: 'occasion',
            clientId: o.client.id,
            title: `${o.field.name}｜${o.client.name}`,
            sub: o.years > 0 ? `滿 ${o.years} 年` : '',
          });
        }
      }
    }
    return map;
  }, [weeks, clients, customFields]);

  // 使用者自建活動（生日 / 紀念日 / 重要日子）：一次性比對日期，每年重複比對月日
  const customEventsByDate = useMemo(() => {
    const map = {};
    for (const week of weeks) {
      for (const d of week) {
        const ds = d.format('YYYY-MM-DD');
        const md = ds.slice(5);
        for (const e of events) {
          const match = e.repeat === 'yearly' ? e.date.slice(5) === md : e.date === ds;
          if (!match) continue;
          const years = e.repeat === 'yearly' ? Number(ds.slice(0, 4)) - Number(e.date.slice(0, 4)) : 0;
          if (years < 0) continue;
          (map[ds] = map[ds] || []).push({
            type: 'event', event: e, clientId: e.clientId || null,
            title: e.title, time: e.time || '',
            sub: e.repeat === 'yearly' && years > 0 ? `滿 ${years} 年` : (e.note || ''),
          });
        }
      }
    }
    return map;
  }, [weeks, events]);

  const getEvents = (dateStr) => [
    ...(customEventsByDate[dateStr] || []),
    ...(eventsByDate[dateStr] || []),
    ...(occasionsByDate[dateStr] || []),
  ];

  const weekdayLabels = useMemo(() => {
    // 依 locale 的週起始日排列（zh-tw 週一開始）
    const start = dayjs().startOf('week');
    return Array.from({ length: 7 }, (_, i) => start.add(i, 'day').format('dd'));
  }, []);

  const selectedEvents = getEvents(selectedDate);

  function shiftMonth(n) {
    setMonthKey(dayjs(monthKey + '-01').add(n, 'month').format('YYYY-MM'));
  }

  function goToday() {
    setMonthKey(dayjs().format('YYYY-MM'));
    setSelectedDate(todayStr);
  }

  async function markContacted(client) {
    await updateClient(client.id, (c) => ({
      ...c,
      lastContact: todayStr,
      missedCalls: 0,
      nextDate: null,
      log: [...(c.log || []), {
        id: generateId('log'),
        date: todayStr, text: '已聯繫', type: 'contact',
      }],
    }));
  }

  function handleExportICS() {
    const n = downloadICS({ events, timers, clients });
    if (n === 0) {
      setExportMsg('目前沒有活動或提醒可匯出——先新增生日 / 重要日子再試。');
    } else {
      setExportMsg(`已匯出 ${n} 筆到 .ics 檔。用手機打開它即可加入系統行事曆，之後靠手機準時提醒（生日 / 紀念日會每年自動重複）。`);
    }
    setTimeout(() => setExportMsg(''), 8000);
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      {/* 標題 + 月份導覽 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-ink">📅 行事曆</h1>
          <button
            onClick={handleExportICS}
            title="把活動與提醒匯出，匯入手機系統行事曆後靠原生提醒準時通知"
            className="btn-outline text-xs"
          >
            📲 匯出到手機行事曆
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => shiftMonth(-1)} className="btn-ghost text-lg px-2.5">‹</button>
          <span className="font-semibold text-ink min-w-28 text-center text-sm">
            {dayjs(monthKey + '-01').format('YYYY 年 M 月')}
          </span>
          <button onClick={() => shiftMonth(1)} className="btn-ghost text-lg px-2.5">›</button>
          <button onClick={goToday} className="btn-outline text-xs ml-1">今天</button>
        </div>
      </div>
      {exportMsg && (
        <div className="bg-ok/10 border border-ok/30 rounded-lg px-3 py-2 text-xs text-ink-2">{exportMsg}</div>
      )}

      {/* 圖例（顏色對應日曆內的文字標籤） */}
      <div className="flex gap-2 flex-wrap text-[11px]">
        {Object.values(EV).map((e) => (
          <span key={e.label} className="px-1.5 py-0.5 rounded text-white" style={{ background: e.color }}>
            {e.icon} {e.label}
          </span>
        ))}
      </div>

      {/* 月曆網格 */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-bdr">
          {weekdayLabels.map((w) => (
            <div key={w} className="text-center text-[11px] text-ink-3 py-1.5 font-medium">{w}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((d) => {
              const dateStr = d.format('YYYY-MM-DD');
              const inMonth = d.format('YYYY-MM') === monthKey;
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const evs = getEvents(dateStr);
              const hasOverdueFollow = evs.some((e) => e.type === 'follow' && dateStr < todayStr);
              return (
                <button
                  key={dateStr}
                  onClick={() => { setSelectedDate(dateStr); if (!inMonth) setMonthKey(d.format('YYYY-MM')); }}
                  className={`min-h-20 md:min-h-24 p-1 border-b border-r border-bdr/40 last:border-r-0 text-left align-top transition-colors flex flex-col ${
                    isSelected ? 'bg-accent/15' : 'hover:bg-s2'
                  } ${inMonth ? '' : 'opacity-35'}`}
                >
                  <span className={`inline-flex items-center justify-center w-6 h-6 text-xs rounded-full shrink-0 ${
                    isToday ? 'bg-accent text-on-accent font-bold' : hasOverdueFollow ? 'text-danger font-bold' : 'text-ink-2'
                  }`}>
                    {d.date()}
                  </span>
                  {/* 直接顯示文字標籤（不用圓點），一眼看清當天有什麼事 */}
                  {evs.length > 0 && (
                    <span className="flex flex-col gap-0.5 mt-0.5 min-w-0">
                      {evs.slice(0, 3).map((e, i) => (
                        <span
                          key={i}
                          className="text-[9px] md:text-[10px] leading-tight px-1 py-0.5 rounded text-white truncate"
                          style={{ background: EV[e.type].color }}
                          title={`${EV[e.type].label}：${e.title}`}
                        >
                          {e.time ? `${e.time} ` : ''}{e.title}
                        </span>
                      ))}
                      {evs.length > 3 && (
                        <span className="text-[9px] text-ink-3 leading-none px-0.5">+{evs.length - 3} 更多</span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* 選定日期的事件清單 */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-bdr">
          <h2 className="text-sm font-semibold text-ink">
            {dayjs(selectedDate).format('M月D日 dddd')}
            <span className="text-ink-3 font-normal ml-2 text-xs">{selectedEvents.length} 件事項</span>
          </h2>
          <button
            onClick={() => setEventModal({ date: selectedDate })}
            className="btn-primary text-xs shrink-0"
          >
            ＋ 新增活動
          </button>
        </div>
        {selectedEvents.length === 0 && (
          <p className="text-center text-ink-3 text-sm py-8">
            這天沒有安排 · 點右上角「新增活動」記錄生日或重要日子
          </p>
        )}
        {selectedEvents.map((e, i) => {
          const def = EV[e.type];
          const isUserEvent = e.type === 'event';
          const clickable = isUserEvent || !!e.clientId;
          return (
            <div key={i}
              className={`flex items-center gap-3 px-3 py-2.5 border-b border-bdr/50 last:border-0 ${clickable ? 'cursor-pointer hover:bg-s2' : ''}`}
              onClick={() => {
                if (isUserEvent) setEventModal(e.event);
                else if (e.clientId) onOpenClient(e.clientId);
              }}
            >
              <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: def.color }} />
              <span className="text-base shrink-0">{def.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">
                  {e.time && <span className="font-mono text-xs text-ink-3 mr-1.5">{e.time}</span>}
                  {e.title}
                  {isUserEvent && e.event.repeat === 'yearly' && (
                    <span className="text-[10px] text-ink-3 ml-1.5">🔁 每年</span>
                  )}
                </p>
                {e.sub && <p className="text-xs text-ink-3 truncate">{e.sub}</p>}
                {isUserEvent && e.clientId && (
                  <button
                    onClick={(ev) => { ev.stopPropagation(); onOpenClient(e.clientId); }}
                    className="text-xs text-accent hover:underline"
                  >
                    {clients.find((c) => c.id === e.clientId)?.name || '關聯客戶'} ›
                  </button>
                )}
              </div>
              {e.type === 'follow' && e.client && (
                <>
                  <span className="text-[10px] font-medium shrink-0"
                    style={{ color: STATUS_COLOR[getClientStatus(e.client, thresholds)] }}>
                    {selectedDate < todayStr ? '已逾期' : selectedDate === todayStr ? '今日' : '排定'}
                  </span>
                  <button
                    onClick={(ev) => { ev.stopPropagation(); markContacted(e.client); }}
                    className="btn-primary text-xs shrink-0"
                  >
                    已聯繫
                  </button>
                </>
              )}
              {isUserEvent && <span className="text-ink-3 text-xs shrink-0">✏️</span>}
              {!isUserEvent && e.clientId && <span className="text-ink-3 text-xs shrink-0">›</span>}
            </div>
          );
        })}
      </div>

      {eventModal && (
        <EventModal
          initial={eventModal}
          clients={clients}
          onClose={() => setEventModal(null)}
          onSave={async (ev) => { await saveEvent(ev); setEventModal(null); }}
          onDelete={async (id) => { await deleteEvent(id); setEventModal(null); }}
        />
      )}
    </div>
  );
}

// ── EventModal（新增 / 編輯行事曆活動）────────────────────────────────────────
function EventModal({ initial, clients, onSave, onClose, onDelete }) {
  const isEdit = !!initial.id;
  const [title, setTitle] = useState(initial.title || '');
  const [date, setDate] = useState(initial.date || today());
  const [time, setTime] = useState(initial.time || '');
  // 新增時預設「每年重複」（生日/紀念日為主要用途）；編輯時沿用原設定
  const [yearly, setYearly] = useState(initial.id ? initial.repeat === 'yearly' : true);
  const [clientId, setClientId] = useState(initial.clientId || '');
  const [note, setNote] = useState(initial.note || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  function submit() {
    if (!title.trim() || !date) return;
    onSave({
      id: initial.id || generateId('event'),
      title: title.trim(),
      date,
      time: time || '',
      repeat: yearly ? 'yearly' : 'none',
      clientId: clientId || null,
      note: note.trim(),
    });
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-sm p-5 anim-scale-in z-50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg text-ink">🗓 {isEdit ? '編輯活動' : '新增活動'}</h3>
            <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1">✕</button>
          </div>

          <div className="space-y-3">
            <Field label="活動名稱" required>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="例：陳頭家生日 / 交車紀念 / 開工日"
                className="w-full" autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="日期">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" />
              </Field>
              <Field label="時間（選填）">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer bg-s2 rounded-lg px-3 py-2">
              <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} className="shrink-0" />
              <span>🔁 每年重複（生日、紀念日用這個）</span>
            </label>
            <Field label="關聯客戶（選填）">
              <ClientPicker clients={clients} value={clientId} onChange={setClientId} />
            </Field>
            <Field label="備註（選填）">
              <input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="地點、提醒事項…" className="w-full" />
            </Field>
          </div>

          <div className="flex gap-2 mt-5">
            {isEdit && (
              confirmDelete ? (
                <>
                  <button onClick={() => onDelete(initial.id)} className="btn-danger text-sm flex-1">確認刪除</button>
                  <button onClick={() => setConfirmDelete(false)} className="btn-outline text-sm flex-1">取消</button>
                </>
              ) : (
                <>
                  <button onClick={() => setConfirmDelete(true)} className="btn-outline text-sm text-danger">刪除</button>
                  <button onClick={submit} disabled={!title.trim()} className="btn-primary text-sm flex-1 disabled:opacity-40">儲存</button>
                </>
              )
            )}
            {!isEdit && (
              <>
                <button onClick={onClose} className="btn-outline text-sm flex-1">取消</button>
                <button onClick={submit} disabled={!title.trim()} className="btn-primary text-sm flex-1 disabled:opacity-40">新增</button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
