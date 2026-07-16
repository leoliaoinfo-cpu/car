import { useState, useMemo } from 'react';
import { useApp } from '../../context';
import { getClientStatus, STATUS_COLOR, formatMoney, generateId, getOccasionsOnDate } from '../../utils/crm';
import { today } from '../../utils/date';
import dayjs from 'dayjs';

// 行事曆事件型別（追蹤 / 提醒 / 成交 / 紀念日）
const EV = {
  follow:   { icon: '📅', label: '追蹤', color: '#bf8a5e' },
  timer:    { icon: '⏰', label: '提醒', color: '#9382a5' },
  deal:     { icon: '🏆', label: '成交', color: '#a99760' },
  occasion: { icon: '🎉', label: '紀念日', color: '#b58a96' },
};

export default function CalendarPage({ onOpenClient }) {
  const { clients, timers, deals, customFields, updateClient, thresholds } = useApp();
  const todayStr = today();
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'));
  const [selectedDate, setSelectedDate] = useState(todayStr);

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

  const getEvents = (dateStr) => [
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

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      {/* 標題 + 月份導覽 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-ink">📅 行事曆</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => shiftMonth(-1)} className="btn-ghost text-lg px-2.5">‹</button>
          <span className="font-semibold text-ink min-w-28 text-center text-sm">
            {dayjs(monthKey + '-01').format('YYYY 年 M 月')}
          </span>
          <button onClick={() => shiftMonth(1)} className="btn-ghost text-lg px-2.5">›</button>
          <button onClick={goToday} className="btn-outline text-xs ml-1">今天</button>
        </div>
      </div>

      {/* 圖例 */}
      <div className="flex gap-3 text-[11px] text-ink-3">
        {Object.values(EV).map((e) => (
          <span key={e.label} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: e.color }} />
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
                  className={`min-h-14 md:min-h-16 p-1 border-b border-r border-bdr/40 last:border-r-0 text-left align-top transition-colors ${
                    isSelected ? 'bg-accent/15' : 'hover:bg-s2'
                  } ${inMonth ? '' : 'opacity-35'}`}
                >
                  <span className={`inline-flex items-center justify-center w-6 h-6 text-xs rounded-full ${
                    isToday ? 'bg-accent text-on-accent font-bold' : hasOverdueFollow ? 'text-danger font-bold' : 'text-ink-2'
                  }`}>
                    {d.date()}
                  </span>
                  {evs.length > 0 && (
                    <span className="flex items-center gap-0.5 mt-0.5 px-0.5 flex-wrap">
                      {evs.slice(0, 4).map((e, i) => (
                        <span key={i} className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: EV[e.type].color }} />
                      ))}
                      {evs.length > 4 && <span className="text-[9px] text-ink-3 leading-none">+{evs.length - 4}</span>}
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
        <h2 className="text-sm font-semibold text-ink px-3 py-2.5 border-b border-bdr">
          {dayjs(selectedDate).format('M月D日 dddd')}
          <span className="text-ink-3 font-normal ml-2 text-xs">{selectedEvents.length} 件事項</span>
        </h2>
        {selectedEvents.length === 0 && (
          <p className="text-center text-ink-3 text-sm py-8">這天沒有安排 🎉</p>
        )}
        {selectedEvents.map((e, i) => {
          const def = EV[e.type];
          const clickable = !!e.clientId;
          return (
            <div key={i}
              className={`flex items-center gap-3 px-3 py-2.5 border-b border-bdr/50 last:border-0 ${clickable ? 'cursor-pointer hover:bg-s2' : ''}`}
              onClick={() => clickable && onOpenClient(e.clientId)}
            >
              <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: def.color }} />
              <span className="text-base shrink-0">{def.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">
                  {e.time && <span className="font-mono text-xs text-ink-3 mr-1.5">{e.time}</span>}
                  {e.title}
                </p>
                {e.sub && <p className="text-xs text-ink-3 truncate">{e.sub}</p>}
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
              {clickable && <span className="text-ink-3 text-xs shrink-0">›</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
