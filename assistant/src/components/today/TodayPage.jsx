import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../../context';
import { db } from '../../db';
import { isSyncEnabled } from '../../sync';
import {
  getClientStatus, STATUS_COLOR, CAT_COLORS, FIELD_COLORS, generateId,
  EVENT_TYPES, getOccasionsOnDate,
} from '../../utils/crm';
import { formatDate } from '../../utils/date';
import { downloadICS, needsIcsExport, snoozeIcsReminder } from '../../utils/ics';
import dayjs from 'dayjs';

const BACKUP_REMIND_DAYS = 7;

export default function TodayPage({ onOpenClient }) {
  const {
    clients, cats, customFields, timers, tasks, events, thresholds,
    updateClient, saveTimer, deleteTimer, saveTask, deleteTask,
  } = useApp();
  const todayStr = dayjs().format('YYYY-MM-DD');
  const [lastBackupAt, setLastBackupAt] = useState(undefined); // undefined=載入中, null=從未備份
  const [taskInput, setTaskInput] = useState('');
  const [taskDue, setTaskDue] = useState(''); // 新增待辦的處理日期（選填）
  const [expandFuture, setExpandFuture] = useState(false); // 是否展開「未來排程」
  const [taskClient, setTaskClient] = useState(null); // @提及連結的客戶 {id, name}
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);

  // 輸入中的 @查詢字串（游標尾端的 @xxx）；null = 沒在打提及
  const mentionQuery = useMemo(() => {
    const m = taskInput.match(/@([^\s@]*)$/);
    return m ? m[1] : null;
  }, [taskInput]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null || mentionDismissed) return [];
    const q = mentionQuery.toLowerCase();
    return clients
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, 6);
  }, [clients, mentionQuery, mentionDismissed]);

  function pickMention(client) {
    setTaskInput((v) => v.replace(/@[^\s@]*$/, `@${client.name} `));
    setTaskClient({ id: client.id, name: client.name });
    setMentionIdx(0);
  }

  useEffect(() => {
    db.getLastBackupAt().then(setLastBackupAt).catch(() => setLastBackupAt(null));
  }, []);

  // 久沒匯出提醒：有「上次匯出後才新增/改的」活動或提醒才提示（不會一直吵）
  const icsNeeded = useMemo(() => needsIcsExport(events, timers), [events, timers]);
  const [icsHidden, setIcsHidden] = useState(false);
  const showIcsReminder = icsNeeded && !icsHidden;
  function exportIcsNow() {
    downloadICS({ events, timers, clients });
    setIcsHidden(true);
  }
  function snoozeIcs() {
    snoozeIcsReminder();
    setIcsHidden(true);
  }

  const backupDays = lastBackupAt ? dayjs().diff(dayjs(lastBackupAt), 'day') : null;
  // 雲端同步啟用時資料已自動備份到雲端，不再提醒手動下載
  const showBackupWarn = !isSyncEnabled() && clients.length > 0 && lastBackupAt !== undefined
    && (lastBackupAt === null || backupDays >= BACKUP_REMIND_DAYS);

  async function handleQuickBackup() {
    await db.exportAndDownload();
    setLastBackupAt(new Date().toISOString());
  }

  const overdue = useMemo(() =>
    clients
      .filter((c) => c.nextDate && c.nextDate < todayStr)
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate)),
    [clients, todayStr]);

  const dueToday = useMemo(() =>
    clients.filter((c) => c.nextDate === todayStr),
    [clients, todayStr]);

  // 今日交車 + 逾期未交車（預計交車日已過但還沒按「交車」歸檔）；置頂客戶優先、再依日期
  const deliveries = useMemo(() =>
    clients
      .filter((c) => c.deliveryDate && c.deliveryDate <= todayStr)
      .sort((a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        || a.deliveryDate.localeCompare(b.deliveryDate)
        || a.name.localeCompare(b.name, 'zh-Hant')),
    [clients, todayStr]);

  const pinnedClients = useMemo(() =>
    clients.filter((c) => c.pinned),
    [clients]);

  const todayTimers = useMemo(() =>
    timers
      .filter((t) => !t.confirmedAt && dayjs(t.triggerAt).isBefore(dayjs().endOf('day')))
      .sort((a, b) => a.triggerAt.localeCompare(b.triggerAt)),
    [timers]);

  const coldCount = useMemo(() =>
    clients.filter((c) => ['hot', 'cold'].includes(getClientStatus(c, thresholds))).length,
    [clients, thresholds]);

  // 今日活動（使用者在行事曆自建的生日 / 紀念日 / 重要日子）
  const todayEvents = useMemo(() => {
    const md = todayStr.slice(5);
    const out = [];
    for (const e of events) {
      const match = e.repeat === 'yearly' ? e.date.slice(5) === md : e.date === todayStr;
      if (!match) continue;
      const years = e.repeat === 'yearly' ? Number(todayStr.slice(0, 4)) - Number(e.date.slice(0, 4)) : 0;
      if (years < 0) continue;
      out.push({ event: e, years });
    }
    return out.sort((a, b) => (a.event.time || '').localeCompare(b.event.time || ''));
  }, [events, todayStr]);

  // 今日紀念日（生日、交車週年…）：依欄位分組，同一種欄位放一起
  const occasionGroups = useMemo(() => {
    const list = getOccasionsOnDate(clients, customFields, todayStr);
    const groups = {};
    for (const o of list) {
      (groups[o.field.id] = groups[o.field.id] || { field: o.field, items: [] }).items.push(o);
    }
    return Object.values(groups);
  }, [clients, customFields, todayStr]);

  // 中央待辦：未完成的都顯示；今天剛勾完的保留（劃線），可反悔取消勾選
  // 待辦分區：有處理日期→「排程」（逾期/今天一定顯示、未來收合），無日期→「無期限」；
  // 有日期者一律由近到遠排序（越緊急越前面）
  const taskGroups = useMemo(() => {
    const undone = tasks.filter((t) => !t.done);
    const byDue = (a, b) => a.due.localeCompare(b.due);
    return {
      due: undone.filter((t) => t.due && t.due <= todayStr).sort(byDue),          // 逾期＋今天
      future: undone.filter((t) => t.due && t.due > todayStr).sort(byDue),        // 未來（預設收合）
      noDate: undone.filter((t) => !t.due)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),    // 無期限
      doneToday: tasks.filter((t) => t.done && t.doneAt === todayStr),            // 今天剛勾完（劃線）
    };
  }, [tasks, todayStr]);

  const undoneTaskCount = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);
  const hasAnyTask = taskGroups.due.length + taskGroups.future.length
    + taskGroups.noDate.length + taskGroups.doneToday.length > 0;

  // 客戶待辦：所有客戶簽約前待辦中未完成的，集中到今日工作逐一處理
  const clientTodos = useMemo(() => {
    const out = [];
    for (const c of clients) {
      for (const td of c.todos || []) {
        if (!td.done) out.push({ client: c, todo: td });
      }
    }
    return out;
  }, [clients]);

  const allClear = overdue.length === 0 && dueToday.length === 0 && deliveries.length === 0
    && todayTimers.length === 0 && occasionGroups.length === 0 && todayEvents.length === 0
    && undoneTaskCount === 0 && clientTodos.length === 0;

  async function addTask() {
    const text = taskInput.trim();
    if (!text) return;
    // @提及的客戶連結：使用者若把 @客戶名 刪掉就不連結
    const linked = taskClient && text.includes(`@${taskClient.name}`) ? taskClient : null;
    const due = taskDue || null;
    setTaskInput(''); // 先清空再儲存，避免儲存期間輸入的下一筆被清掉
    setTaskClient(null);
    setTaskDue('');
    await saveTask({
      id: generateId('task'), text, done: false, doneAt: null, due,
      clientId: linked?.id || null, clientName: linked?.name || null,
    });
  }

  async function toggleTask(t) {
    await saveTask({ ...t, done: !t.done, doneAt: !t.done ? todayStr : null });
  }

  async function setTaskDate(t, due) {
    await saveTask({ ...t, due: due || null });
  }

  async function toggleClientTodo(client, todoId) {
    await updateClient(client.id, (c) => ({
      ...c,
      todos: (c.todos || []).map((td) => (td.id === todoId ? { ...td, done: !td.done } : td)),
    }));
  }

  // 本日成果：從所有客戶時間軸自動統計今天記錄的事件，不需手動填日報
  const todayResults = useMemo(() => {
    const counts = {};
    const amounts = {};
    for (const c of clients) {
      for (const entry of c.log || []) {
        if (entry.date !== todayStr) continue;
        counts[entry.type] = (counts[entry.type] || 0) + 1;
        if (entry.amount > 0) amounts[entry.type] = (amounts[entry.type] || 0) + entry.amount;
      }
    }
    const order = ['deal', 'contact', 'line', 'quote', 'visit', 'loan', 'order', 'delivery', 'aftercare', 'missed'];
    return order
      .filter((type) => counts[type])
      .map((type) => ({ type, ...EVENT_TYPES[type], count: counts[type], amount: amounts[type] }));
  }, [clients, todayStr]);

  async function markContacted(client) {
    await updateClient(client.id, (c) => ({
      ...c,
      lastContact: todayStr,
      missedCalls: 0,
      nextDate: null,
      log: [
        ...(c.log || []),
        { id: generateId('log'), date: todayStr, text: '已聯繫', type: 'contact' },
      ],
    }));
  }

  /** 紀念日問候：記錄聯繫但保留原本排程的下次追蹤日期 */
  async function logGreeting(client, label) {
    await updateClient(client.id, (c) => ({
      ...c,
      lastContact: todayStr,
      missedCalls: 0,
      log: [
        ...(c.log || []),
        { id: generateId('log'), date: todayStr, text: `${label}問候`, type: 'contact' },
      ],
    }));
  }

  async function confirmTimer(t) {
    await saveTimer({ ...t, confirmedAt: new Date().toISOString() });
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="space-y-4 mb-4">
      {/* 日期標題 */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink">☀️ 今日工作</h1>
          <p className="text-sm text-ink-3 mt-0.5">{dayjs().format('YYYY年M月D日 dddd')}</p>
        </div>
      </div>

      {/* 備份提醒：資料只存在此瀏覽器，太久沒備份就提醒 */}
      {showBackupWarn && (
        <div className="flex items-center gap-3 bg-danger/10 border border-danger/30 rounded-xl px-4 py-3">
          <span className="text-lg shrink-0">💾</span>
          <p className="flex-1 text-xs text-danger">
            {lastBackupAt === null ? '尚未備份過資料' : `已 ${backupDays} 天未備份`}
            ——客戶名單只存在這個瀏覽器，建議立即下載備份。
          </p>
          <button onClick={handleQuickBackup} className="btn-danger text-xs shrink-0">立即備份</button>
        </div>
      )}

      {/* 久沒匯出提醒：有新活動 / 提醒還沒進手機行事曆 */}
      {showIcsReminder && (
        <div className="flex items-center gap-3 bg-accent/8 border border-accent/25 rounded-xl px-4 py-3">
          <span className="text-lg shrink-0">📲</span>
          <p className="flex-1 text-xs text-ink-2">
            有活動 / 提醒還沒匯出到手機行事曆——匯出後手機才會準時提醒你（生日 / 紀念日會每年自動重複）。
          </p>
          <button onClick={exportIcsNow} className="btn-primary text-xs shrink-0">匯出</button>
          <button onClick={snoozeIcs} className="text-ink-3 hover:text-ink text-sm shrink-0" title="暫時關閉，有新的再提醒">✕</button>
        </div>
      )}

      {/* 統計方塊 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatTile label="今日交車" value={deliveries.length} color={deliveries.length > 0 ? '#c0764f' : '#7d9b76'} />
        <StatTile label="逾期追蹤" value={overdue.length} color={overdue.length > 0 ? '#b26b6b' : '#7d9b76'} />
        <StatTile label="今日追蹤" value={dueToday.length} color="#bf8a5e" />
        <StatTile label="即將簽約" value={pinnedClients.length} color="#7291a8" />
        <StatTile label="久未聯繫" value={coldCount} color={coldCount > 0 ? '#c0764f' : '#7d9b76'} />
      </div>

      {allClear && pinnedClients.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-ink-2 font-medium">今天沒有待辦事項</p>
          <p className="text-xs text-ink-3 mt-1">到「客戶追蹤」開發新客戶，或檢查久未聯繫的名單。</p>
        </div>
      )}
      </div>

      {/* 待辦卡片：桌面 2 欄瀑布流、手機單欄（iOS 小工具風） */}
      <div className="md:columns-2 md:gap-4">
      {/* 今日交車（含逾期未交車）— 最優先，放最上方 */}
      {deliveries.length > 0 && (
        <Section icon="🚚" title="今日交車" count={deliveries.length} color="#c0764f">
          {deliveries.map((c) => {
            const late = c.deliveryDate < todayStr;
            const lateDays = late ? dayjs(todayStr).diff(dayjs(c.deliveryDate), 'day') : 0;
            const color = late ? '#b26b6b' : '#c0764f';
            return (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-bdr/50 last:border-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenClient(c.id)}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.pinned && <span className="text-[11px]" title="置頂客戶">📌</span>}
                    <span className="font-medium text-sm text-ink">{c.name}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ background: color + '20', color }}>
                      {late ? `逾期 ${lateDays} 天未交車` : '今天交車'}
                    </span>
                  </div>
                  <p className="text-xs text-ink-3 mt-0.5">
                    預計 {formatDate(c.deliveryDate)}{c.phone ? ` · ${c.phone}` : ''}
                  </p>
                </div>
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="btn-outline text-xs shrink-0" onClick={(e) => e.stopPropagation()}>📞</a>
                )}
                <button onClick={() => onOpenClient(c.id)} className="btn-primary text-xs shrink-0">交車</button>
              </div>
            );
          })}
        </Section>
      )}

      {/* 逾期追蹤 */}
      {overdue.length > 0 && (
        <Section icon="⚠️" title="逾期追蹤" count={overdue.length} color="#b26b6b">
          {overdue.map((c) => (
            <ClientTaskRow key={c.id} client={c} cats={cats}
              tag={`逾期 ${dayjs(todayStr).diff(dayjs(c.nextDate), 'day')} 天`} tagColor="#b26b6b"
              onOpen={() => onOpenClient(c.id)} onDone={() => markContacted(c)} />
          ))}
        </Section>
      )}

      {/* 今日追蹤 */}
      {dueToday.length > 0 && (
        <Section icon="📅" title="今日追蹤" count={dueToday.length} color="#bf8a5e">
          {dueToday.map((c) => (
            <ClientTaskRow key={c.id} client={c} cats={cats}
              tag="今日" tagColor="#bf8a5e"
              onOpen={() => onOpenClient(c.id)} onDone={() => markContacted(c)} />
          ))}
        </Section>
      )}

      {/* 今日活動：行事曆自建的生日 / 紀念日 / 重要日子 */}
      {todayEvents.length > 0 && (
        <Section icon="🗓" title="今日活動" count={todayEvents.length} color="#6f9a9c">
          {todayEvents.map(({ event: e, years }) => {
            const client = e.clientId ? clients.find((c) => c.id === e.clientId) : null;
            return (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-bdr/50 last:border-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#6f9a9c' }} />
                {e.time && <span className="text-xs font-mono text-ink-3 shrink-0">{e.time}</span>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-sm text-ink">{e.title}</span>
                    {years > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#6f9a9c20', color: '#6f9a9c' }}>
                        滿 {years} 年
                      </span>
                    )}
                    {e.repeat === 'yearly' && <span className="text-[10px] text-ink-3">🔁 每年</span>}
                  </div>
                  {e.note && <p className="text-xs text-ink-3 mt-0.5">{e.note}</p>}
                </div>
                {client && (
                  <button onClick={() => onOpenClient(client.id)}
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/12 text-accent shrink-0 hover:bg-accent/20">
                    {client.name} ›
                  </button>
                )}
                {client?.phone && (
                  <a href={`tel:${client.phone}`} className="btn-outline text-xs shrink-0" onClick={(ev) => ev.stopPropagation()}>📞</a>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {/* 今日紀念日：依欄位分組（生日、交車週年…），不與追蹤混在一起 */}
      {occasionGroups.map(({ field, items }) => {
        const color = FIELD_COLORS[(field.colorIdx || 0) % FIELD_COLORS.length];
        return (
          <Section key={field.id} icon="🎉" title={field.name} count={items.length} color={color}>
            {items.map(({ client: c, years }) => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-bdr/50 last:border-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpenClient(c.id)}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-sm text-ink">{c.name}</span>
                    {years > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: color + '20', color }}>
                        滿 {years} 年
                      </span>
                    )}
                  </div>
                  {c.phone && <p className="text-xs text-ink-3 mt-0.5">{c.phone}</p>}
                </div>
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="btn-outline text-xs shrink-0" onClick={(e) => e.stopPropagation()}>
                    📞
                  </a>
                )}
                <button onClick={() => logGreeting(c, field.name)} className="btn-primary text-xs shrink-0">已問候</button>
              </div>
            ))}
          </Section>
        );
      })}

      {/* 今日提醒 */}
      {todayTimers.length > 0 && (
        <Section icon="⏰" title="提醒" count={todayTimers.length} color="#9382a5">
          {todayTimers.map((t) => {
            const past = dayjs(t.triggerAt).isBefore(dayjs());
            return (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-bdr/50 last:border-0">
                <span className={`text-xs font-mono shrink-0 ${past ? 'text-danger font-semibold' : 'text-ink-3'}`}>
                  {dayjs(t.triggerAt).format('HH:mm')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{t.note}</p>
                  {t.clientName && (
                    <button
                      onClick={() => t.clientId && onOpenClient(t.clientId)}
                      className="text-xs text-accent hover:underline"
                    >
                      {t.clientName}
                    </button>
                  )}
                </div>
                <button onClick={() => confirmTimer(t)} className="btn-outline text-xs shrink-0">完成</button>
                <button onClick={() => deleteTimer(t.id)} className="text-danger/40 hover:text-danger text-xs shrink-0">✕</button>
              </div>
            );
          })}
        </Section>
      )}

      {/* 中央待辦：直接記錄與處理雜事 */}
      <Section icon="📋" title="待辦事項" count={undoneTaskCount} color="#7291a8">
        <div className="px-3 py-2.5 border-b border-bdr/50">
          <div className="flex gap-2">
            <input
              value={taskInput}
              onChange={(e) => { setTaskInput(e.target.value); setMentionDismissed(false); setMentionIdx(0); }}
              onKeyDown={(e) => {
                if (mentionCandidates.length > 0) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionCandidates.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
                  if (e.key === 'Enter') { e.preventDefault(); pickMention(mentionCandidates[mentionIdx]); return; }
                  if (e.key === 'Escape') { setMentionDismissed(true); return; }
                }
                if (e.key === 'Enter') addTask();
              }}
              placeholder="新增待辦（輸入 @ 可連結客戶）"
              className="flex-1 text-sm min-w-0"
            />
            <button onClick={addTask} className="btn-primary text-xs shrink-0">加入</button>
          </div>
          {/* 處理日期（選填）：填了就進「排程」、不填進「無期限」，不會每天都出現 */}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[11px] text-ink-3 shrink-0">🗓 處理日期</span>
            <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="text-xs" />
            {taskDue && <button onClick={() => setTaskDue('')} className="text-ink-3 hover:text-ink text-xs">清除</button>}
            <span className="text-[10px] text-ink-3 flex-1 text-right">不填＝無期限</span>
          </div>
          {mentionCandidates.length > 0 && (
            <div className="mt-2 rounded-lg border border-bdr bg-s2 overflow-hidden anim-fade-in">
              <p className="text-[10px] text-ink-3 px-3 pt-2 pb-1">選擇要連結的客戶</p>
              {mentionCandidates.map((c, i) => (
                <button
                  key={c.id}
                  onMouseDown={(e) => { e.preventDefault(); pickMention(c); }}
                  onMouseEnter={() => setMentionIdx(i)}
                  className={`flex items-center gap-2 w-full text-left px-3 py-2 text-sm ${i === mentionIdx ? 'bg-accent/15' : ''}`}
                >
                  <span className="font-medium text-ink">{c.name}</span>
                  {c.phone && <span className="text-xs text-ink-3">{c.phone}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {!hasAnyTask && (
          <p className="text-center text-ink-3 text-xs py-4">沒有待辦，輸入上方欄位新增</p>
        )}

        {/* 排程：逾期＋今天（由近到遠，一定顯示） */}
        {(taskGroups.due.length > 0 || taskGroups.future.length > 0) && (
          <p className="text-[11px] font-semibold text-ink-3 px-3 pt-2 pb-1">🗓 排程</p>
        )}
        {taskGroups.due.map((t) => (
          <TaskRow key={t.id} task={t} todayStr={todayStr} onToggle={() => toggleTask(t)}
            onDelete={() => deleteTask(t.id)} onOpenClient={onOpenClient} onSetDate={(d) => setTaskDate(t, d)} />
        ))}

        {/* 未來排程：預設收合，不會每天都出現 */}
        {taskGroups.future.length > 0 && (expandFuture ? (
          <>
            {taskGroups.future.map((t) => (
              <TaskRow key={t.id} task={t} todayStr={todayStr} onToggle={() => toggleTask(t)}
                onDelete={() => deleteTask(t.id)} onOpenClient={onOpenClient} onSetDate={(d) => setTaskDate(t, d)} />
            ))}
            <button onClick={() => setExpandFuture(false)}
              className="w-full text-center text-[11px] text-ink-3 py-1.5 hover:text-ink border-b border-bdr/50">▲ 收合未來待辦</button>
          </>
        ) : (
          <button onClick={() => setExpandFuture(true)}
            className="w-full flex items-center gap-1.5 text-left text-[11px] text-accent px-3 py-2 hover:bg-s2 border-b border-bdr/50">
            <span>▸</span> 之後還有 {taskGroups.future.length} 則排程待辦（點開查看）
          </button>
        ))}

        {/* 無期限 */}
        {taskGroups.noDate.length > 0 && (
          <>
            {(taskGroups.due.length > 0 || taskGroups.future.length > 0) && (
              <p className="text-[11px] font-semibold text-ink-3 px-3 pt-2 pb-1">♾️ 無期限</p>
            )}
            {taskGroups.noDate.map((t) => (
              <TaskRow key={t.id} task={t} todayStr={todayStr} onToggle={() => toggleTask(t)}
                onDelete={() => deleteTask(t.id)} onOpenClient={onOpenClient} onSetDate={(d) => setTaskDate(t, d)} />
            ))}
          </>
        )}

        {/* 今天剛勾完的（劃線，可反悔取消勾選） */}
        {taskGroups.doneToday.map((t) => (
          <TaskRow key={t.id} task={t} todayStr={todayStr} onToggle={() => toggleTask(t)}
            onDelete={() => deleteTask(t.id)} onOpenClient={onOpenClient} onSetDate={(d) => setTaskDate(t, d)} />
        ))}
      </Section>

      {/* 客戶待辦：依客戶 / 依項目分組收合、可篩選，置頂客戶優先 */}
      <ClientTodosSection clients={clients} onOpenClient={onOpenClient} toggleClientTodo={toggleClientTodo} />

      {/* 本日成果：自動從客戶時間軸統計 */}
      {todayResults.length > 0 && (
        <Section icon="📊" title="本日成果" color="#7d9b76">
          <div className="flex flex-wrap gap-2 px-3 py-3">
            {todayResults.map((r) => (
              <div key={r.type} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{ background: r.color + '14' }}>
                <span className="text-sm">{r.icon}</span>
                <span className="text-xs font-medium" style={{ color: r.color }}>
                  {r.label} × {r.count}
                </span>
                {r.amount > 0 && (
                  <span className="text-[10px] font-semibold" style={{ color: r.color }}>
                    NT$ {r.amount.toLocaleString('zh-TW')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 即將簽約 */}
      {pinnedClients.length > 0 && (
        <Section icon="📌" title="即將簽約" count={pinnedClients.length} color="#7291a8">
          {pinnedClients.map((c) => {
            const todos = c.todos || [];
            const doneCount = todos.filter((td) => td.done).length;
            return (
              <div key={c.id} className="px-3 py-2.5 border-b border-bdr/50 last:border-0 cursor-pointer hover:bg-s2 transition-colors"
                onClick={() => onOpenClient(c.id)}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-ink">{c.name}</span>
                  {todos.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${doneCount === todos.length ? 'bg-ok/15 text-ok' : 'bg-s3 text-ink-2'}`}>
                      待辦 {doneCount}/{todos.length}
                    </span>
                  )}
                  {c.nextDate && (
                    <span className="text-[10px] text-ink-3 ml-auto shrink-0">追蹤 {formatDate(c.nextDate)}</span>
                  )}
                </div>
                {c.signingNote && (
                  <p className="text-xs text-ink-2 mt-1 whitespace-pre-wrap line-clamp-2">💡 {c.signingNote}</p>
                )}
              </div>
            );
          })}
        </Section>
      )}
      </div>
    </div>
  );
}

/** 待辦文字：有連結客戶時，@客戶名 顯示為可點擊、跳到該客戶詳情 */
function TaskText({ task, onOpenClient }) {
  const mention = task.clientId && task.clientName ? `@${task.clientName}` : null;
  const idx = mention ? task.text.indexOf(mention) : -1;
  if (idx === -1) return task.text;
  return (
    <>
      {task.text.slice(0, idx)}
      <button
        onClick={() => onOpenClient(task.clientId)}
        className="text-accent font-medium hover:underline align-baseline"
      >
        {mention}
      </button>
      {task.text.slice(idx + mention.length)}
    </>
  );
}

/** 單筆待辦：勾選、文字、可點的日期標籤（改處理日期）、刪除 */
function TaskRow({ task, todayStr, onToggle, onDelete, onOpenClient, onSetDate }) {
  const due = task.due || '';
  const late = due && due < todayStr;
  const isToday = due === todayStr;
  const color = late ? '#b26b6b' : isToday ? '#bf8a5e' : '#7291a8';
  const label = due
    ? (late ? `逾期 ${dayjs(todayStr).diff(dayjs(due), 'day')} 天` : isToday ? '今天' : formatDate(due))
    : '＋日期';
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-bdr/50 last:border-0">
      <input type="checkbox" checked={!!task.done} onChange={onToggle} className="shrink-0" />
      <span className={`flex-1 text-sm min-w-0 break-words ${task.done ? 'line-through text-ink-3' : 'text-ink'}`}>
        <TaskText task={task} onOpenClient={onOpenClient} />
      </span>
      {/* 日期標籤：點一下叫出原生日期選擇器可改；有 due 上色、無 due 虛線 */}
      <label className="relative shrink-0 cursor-pointer" title="設定 / 修改處理日期">
        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap border ${due ? '' : 'border-dashed border-bdr text-ink-3'}`}
          style={due ? { background: color + '20', color, borderColor: 'transparent' } : undefined}>
          {due && late && '⚠️ '}{label}
        </span>
        <input type="date" value={due} onChange={(e) => onSetDate(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" style={{ padding: 0, border: 'none' }} />
      </label>
      <button onClick={onDelete} className="text-danger/40 hover:text-danger text-xs shrink-0">✕</button>
    </div>
  );
}

/**
 * 客戶待辦（可收合分組）：
 *  - 「依客戶」：每位客戶一列，顯示剩餘待辦數，點擊才展開全部待辦；置頂客戶排最前
 *  - 「依項目」：相同待辦名稱合併成一組，展開看有哪些客戶還沒完成
 *  - 篩選框：輸入客戶名或項目關鍵字即時過濾（篩選時自動展開符合的群組）
 */
function ClientTodosSection({ clients, onOpenClient, toggleClientTodo }) {
  const [mode, setMode] = useState('client'); // 'client' | 'item'
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const COLOR = '#9382a5';
  const q = filter.trim().toLowerCase();
  const todayStr = dayjs().format('YYYY-MM-DD');

  // 待辦處理日期小標籤（唯讀，與客戶檔案的日期同步顯示）
  const dueTag = (due) => {
    if (!due) return null;
    const late = due < todayStr, isToday = due === todayStr;
    const color = late ? '#b26b6b' : isToday ? '#bf8a5e' : '#7291a8';
    const label = late ? `逾期 ${dayjs(todayStr).diff(dayjs(due), 'day')} 天` : isToday ? '今天' : dayjs(due).format('MM/DD');
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0"
        style={{ background: color + '20', color }}>{late && '⚠️ '}{label}</span>
    );
  };
  // 客戶待辦排序：有日期近到遠、無日期在後
  const byDue = (a, b) => {
    const ad = a.due || '', bd = b.due || '';
    if (!!ad !== !!bd) return ad ? -1 : 1;
    if (ad && bd && ad !== bd) return ad.localeCompare(bd);
    return 0;
  };

  // 攤平所有未完成的客戶待辦
  const flat = useMemo(() => {
    const out = [];
    for (const c of clients) for (const td of c.todos || []) if (!td.done) out.push({ client: c, todo: td });
    return out;
  }, [clients]);
  const total = flat.length;

  // 依客戶分組：置頂優先 → 剩餘數多者 → 名稱
  const byClient = useMemo(() => {
    const map = new Map();
    for (const { client, todo } of flat) {
      if (!map.has(client.id)) map.set(client.id, { client, todos: [] });
      map.get(client.id).todos.push(todo);
    }
    for (const g of map.values()) g.todos.sort(byDue);
    return [...map.values()].sort((a, b) => {
      const pa = a.client.pinned ? 1 : 0, pb = b.client.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      if (b.todos.length !== a.todos.length) return b.todos.length - a.todos.length;
      return a.client.name.localeCompare(b.client.name, 'zh-Hant');
    });
  }, [flat]);

  // 依項目分組：相同待辦名稱合併，數量多者在前
  const byItem = useMemo(() => {
    const map = new Map();
    for (const { client, todo } of flat) {
      const key = todo.text.trim() || '（未命名）';
      if (!map.has(key)) map.set(key, { text: key, items: [] });
      map.get(key).items.push({ client, todo });
    }
    for (const g of map.values()) {
      g.items.sort((a, b) => (b.client.pinned ? 1 : 0) - (a.client.pinned ? 1 : 0)
        || a.client.name.localeCompare(b.client.name, 'zh-Hant'));
    }
    return [...map.values()].sort((a, b) => (b.items.length - a.items.length)
      || a.text.localeCompare(b.text, 'zh-Hant'));
  }, [flat]);

  const filteredClient = q
    ? byClient.filter((g) => g.client.name.toLowerCase().includes(q) || g.todos.some((t) => t.text.toLowerCase().includes(q)))
    : byClient;
  const filteredItem = q
    ? byItem.filter((g) => g.text.toLowerCase().includes(q) || g.items.some((it) => it.client.name.toLowerCase().includes(q)))
    : byItem;

  if (total === 0) return null;

  const toggleExp = (key) => setExpanded((s) => {
    const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n;
  });
  const badge = (n) => (
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md tabular-nums shrink-0"
      style={{ background: COLOR + '22', color: COLOR }}>{n}</span>
  );
  const empty = <p className="text-center text-ink-3 text-xs py-4">找不到符合「{filter}」的客戶或項目</p>;

  return (
    <Section icon="👤" title="客戶待辦" count={total} color={COLOR}>
      {/* 分組模式切換 + 篩選 */}
      <div className="flex items-center gap-2 px-3 pt-1 pb-2">
        <div className="flex rounded-lg bg-s2 p-0.5 text-xs shrink-0">
          {[['client', '依客戶'], ['item', '依項目']].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${mode === m ? 'bg-s1 text-accent shadow-card' : 'text-ink-3'}`}>
              {label}
            </button>
          ))}
        </div>
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="篩選客戶或項目" className="flex-1 text-xs min-w-0" />
      </div>

      {mode === 'client' ? (
        filteredClient.length === 0 ? empty : filteredClient.map(({ client: c, todos }) => {
          const open = expanded.has('c:' + c.id) || !!q;
          return (
            <div key={c.id} className="border-b border-bdr/50 last:border-0">
              <div className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-s2 transition-colors"
                onClick={() => toggleExp('c:' + c.id)}>
                <span className="text-ink-3 text-[10px] w-3 shrink-0">{open ? '▼' : '▶'}</span>
                {c.pinned && <span className="text-[11px] shrink-0" title="置頂客戶">📌</span>}
                <span className="font-medium text-sm text-ink flex-1 min-w-0 truncate">{c.name}</span>
                {badge(todos.length)}
                <button onClick={(e) => { e.stopPropagation(); onOpenClient(c.id); }}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/12 text-accent shrink-0 hover:bg-accent/20">開啟 ›</button>
              </div>
              {open && (
                <div className="pb-1">
                  {todos.map((td) => (
                    <label key={td.id} className="flex items-center gap-2.5 pl-8 pr-3 py-1.5 cursor-pointer hover:bg-s2/60">
                      <input type="checkbox" checked={false} onChange={() => toggleClientTodo(c, td.id)} className="shrink-0" />
                      <span className="flex-1 text-sm text-ink-2 min-w-0 break-words">{td.text}</span>
                      {dueTag(td.due)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })
      ) : (
        filteredItem.length === 0 ? empty : filteredItem.map(({ text, items }) => {
          const open = expanded.has('i:' + text) || !!q;
          return (
            <div key={text} className="border-b border-bdr/50 last:border-0">
              <div className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-s2 transition-colors"
                onClick={() => toggleExp('i:' + text)}>
                <span className="text-ink-3 text-[10px] w-3 shrink-0">{open ? '▼' : '▶'}</span>
                <span className="font-medium text-sm text-ink flex-1 min-w-0 truncate">{text}</span>
                {badge(items.length)}
              </div>
              {open && (
                <div className="pb-1">
                  {items.map(({ client: c, todo: td }) => (
                    <div key={c.id + ':' + td.id} className="flex items-center gap-2.5 pl-8 pr-3 py-1.5 hover:bg-s2/60">
                      <input type="checkbox" checked={false} onChange={() => toggleClientTodo(c, td.id)} className="shrink-0" />
                      <button onClick={() => onOpenClient(c.id)}
                        className="flex-1 text-left text-sm text-accent min-w-0 truncate hover:underline">
                        {c.pinned && '📌 '}{c.name} ›
                      </button>
                      {dueTag(td.due)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </Section>
  );
}

// iOS 小工具風統計方塊：淡色底、大數字、下方標籤
function StatTile({ label, value, color }) {
  return (
    <div className="rounded-2xl px-3.5 py-3 border border-bdr" style={{ background: color + '14' }}>
      <p className="text-[26px] font-bold leading-none tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[11px] text-ink-2 mt-1.5 font-medium">{label}</p>
    </div>
  );
}

/** iOS 小工具風卡片：大圓角、標頭（圖示＋標題＋右側件數徽章），內容為條列 */
function Section({ icon, title, count, color, children }) {
  return (
    <section className="bg-s1 rounded-[22px] border border-bdr shadow-card overflow-hidden break-inside-avoid mb-4">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-1.5">
        <span className="text-[15px] leading-none shrink-0">{icon}</span>
        <h2 className="text-[15px] font-bold text-ink flex-1 min-w-0 truncate">{title}</h2>
        {count > 0 && (
          <span className="text-[13px] font-bold px-2 py-0.5 rounded-lg tabular-nums shrink-0"
            style={{ background: color + '22', color }}>{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function ClientTaskRow({ client, cats, tag, tagColor, onOpen, onDone }) {
  const { thresholds } = useApp();
  const status = getClientStatus(client, thresholds);
  const cat = cats.find((c) => c.id === client.catId);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-bdr/50 last:border-0">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[status] }} />
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-sm text-ink">{client.name}</span>
          {cat && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: CAT_COLORS[cat.colorIdx % CAT_COLORS.length] + '20', color: CAT_COLORS[cat.colorIdx % CAT_COLORS.length] }}>
              {cat.name}
            </span>
          )}
          <span className="text-[10px] font-medium" style={{ color: tagColor }}>{tag}</span>
        </div>
        {client.phone && <p className="text-xs text-ink-3 mt-0.5">{client.phone}</p>}
      </div>
      {client.phone && (
        <a href={`tel:${client.phone}`} className="btn-outline text-xs shrink-0" onClick={(e) => e.stopPropagation()}>
          📞
        </a>
      )}
      <button onClick={onDone} className="btn-primary text-xs shrink-0">已聯繫</button>
    </div>
  );
}
