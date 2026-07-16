import { useMemo, useState, useEffect } from 'react';
import { useApp } from '../../context';
import { db } from '../../db';
import {
  getClientStatus, STATUS_COLOR, CAT_COLORS, FIELD_COLORS, generateId,
  EVENT_TYPES, getOccasionsOnDate,
} from '../../utils/crm';
import { formatDate } from '../../utils/date';
import dayjs from 'dayjs';

const BACKUP_REMIND_DAYS = 7;

export default function TodayPage({ onOpenClient }) {
  const {
    clients, cats, customFields, timers, tasks, thresholds,
    updateClient, saveTimer, deleteTimer, saveTask, deleteTask,
  } = useApp();
  const todayStr = dayjs().format('YYYY-MM-DD');
  const [lastBackupAt, setLastBackupAt] = useState(undefined); // undefined=載入中, null=從未備份
  const [taskInput, setTaskInput] = useState('');

  useEffect(() => {
    db.getLastBackupAt().then(setLastBackupAt).catch(() => setLastBackupAt(null));
  }, []);

  const backupDays = lastBackupAt ? dayjs().diff(dayjs(lastBackupAt), 'day') : null;
  const showBackupWarn = clients.length > 0 && lastBackupAt !== undefined
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
  const visibleTasks = useMemo(() =>
    tasks
      .filter((t) => !t.done || t.doneAt === todayStr)
      .sort((a, b) => (a.done === b.done ? (a.createdAt || '').localeCompare(b.createdAt || '') : a.done ? 1 : -1)),
    [tasks, todayStr]);

  const undoneTaskCount = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);

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

  const allClear = overdue.length === 0 && dueToday.length === 0
    && todayTimers.length === 0 && occasionGroups.length === 0
    && undoneTaskCount === 0 && clientTodos.length === 0;

  async function addTask() {
    const text = taskInput.trim();
    if (!text) return;
    setTaskInput(''); // 先清空再儲存，避免儲存期間輸入的下一筆被清掉
    await saveTask({ id: generateId('task'), text, done: false, doneAt: null });
  }

  async function toggleTask(t) {
    await saveTask({ ...t, done: !t.done, doneAt: !t.done ? todayStr : null });
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
    <div className="max-w-3xl mx-auto p-4 space-y-5">
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

      {/* 統計方塊 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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

      {/* 逾期追蹤 */}
      {overdue.length > 0 && (
        <Section title={`⚠️ 逾期追蹤（${overdue.length}）`} titleColor="#b26b6b">
          {overdue.map((c) => (
            <ClientTaskRow key={c.id} client={c} cats={cats}
              tag={`逾期 ${dayjs(todayStr).diff(dayjs(c.nextDate), 'day')} 天`} tagColor="#b26b6b"
              onOpen={() => onOpenClient(c.id)} onDone={() => markContacted(c)} />
          ))}
        </Section>
      )}

      {/* 今日追蹤 */}
      {dueToday.length > 0 && (
        <Section title={`📅 今日追蹤（${dueToday.length}）`} titleColor="#bf8a5e">
          {dueToday.map((c) => (
            <ClientTaskRow key={c.id} client={c} cats={cats}
              tag="今日" tagColor="#bf8a5e"
              onOpen={() => onOpenClient(c.id)} onDone={() => markContacted(c)} />
          ))}
        </Section>
      )}

      {/* 今日紀念日：依欄位分組（生日、交車週年…），不與追蹤混在一起 */}
      {occasionGroups.map(({ field, items }) => {
        const color = FIELD_COLORS[(field.colorIdx || 0) % FIELD_COLORS.length];
        return (
          <Section key={field.id} title={`🎉 ${field.name}（${items.length}）`} titleColor={color}>
            {items.map(({ client: c, years }) => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-bdr/50 last:border-0">
                <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: color }} />
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
        <Section title={`⏰ 提醒（${todayTimers.length}）`} titleColor="#9382a5">
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
      <Section title={`📋 待辦事項${undoneTaskCount > 0 ? `（${undoneTaskCount}）` : ''}`} titleColor="#7291a8">
        <div className="flex gap-2 px-3 py-2.5 border-b border-bdr/50">
          <input
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
            placeholder="新增待辦（回報主管、送文件、訂配件…）"
            className="flex-1 text-sm min-w-0"
          />
          <button onClick={addTask} className="btn-primary text-xs shrink-0">加入</button>
        </div>
        {visibleTasks.length === 0 && (
          <p className="text-center text-ink-3 text-xs py-4">沒有待辦，輸入上方欄位新增</p>
        )}
        {visibleTasks.map((t) => (
          <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-bdr/50 last:border-0">
            <input type="checkbox" checked={!!t.done} onChange={() => toggleTask(t)} className="shrink-0" />
            <span className={`flex-1 text-sm min-w-0 break-words ${t.done ? 'line-through text-ink-3' : 'text-ink'}`}>
              {t.text}
            </span>
            <button onClick={() => deleteTask(t.id)} className="text-danger/40 hover:text-danger text-xs shrink-0">✕</button>
          </div>
        ))}
      </Section>

      {/* 客戶待辦：各客戶簽約前待辦集中處理 */}
      {clientTodos.length > 0 && (
        <Section title={`👤 客戶待辦（${clientTodos.length}）`} titleColor="#9382a5">
          {clientTodos.map(({ client: c, todo: td }) => (
            <div key={td.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-bdr/50 last:border-0">
              <input type="checkbox" checked={false} onChange={() => toggleClientTodo(c, td.id)} className="shrink-0" />
              <span className="flex-1 text-sm text-ink min-w-0 break-words">{td.text}</span>
              <button
                onClick={() => onOpenClient(c.id)}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/12 text-accent shrink-0 hover:bg-accent/20"
              >
                {c.name} ›
              </button>
            </div>
          ))}
        </Section>
      )}

      {/* 本日成果：自動從客戶時間軸統計 */}
      {todayResults.length > 0 && (
        <Section title="📊 本日成果" titleColor="#7d9b76">
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
        <Section title={`📌 即將簽約（${pinnedClients.length}）`} titleColor="#7291a8">
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
  );
}

function StatTile({ label, value, color }) {
  return (
    <div className="card px-3 py-3 text-center">
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-[11px] text-ink-3 mt-0.5">{label}</p>
    </div>
  );
}

function Section({ title, titleColor, children }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="text-sm font-semibold px-3 py-2.5 border-b border-bdr" style={{ color: titleColor }}>
        {title}
      </h2>
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
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: STATUS_COLOR[status] }} />
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
