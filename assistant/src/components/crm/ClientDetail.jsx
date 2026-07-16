import { useState } from 'react';
import {
  getClientStatus, STATUS_COLOR, STATUS_LABEL, CAT_COLORS, FIELD_COLORS, generateId,
  EVENT_TYPES, QUICK_EVENT_KEYS, DELIVERY_FOLLOWUP_DAYS, formatMoney, INDUSTRY_SUGGESTIONS,
} from '../../utils/crm';
import { today, formatDateFull, addDays, QUICK_DATES } from '../../utils/date';
import { useApp } from '../../context';
import DealModal from '../deals/DealModal';
import QuoteModal from '../quote/QuoteModal';
import dayjs from 'dayjs';

const INTENT_LABELS = ['未評估', '低', '中', '高', '非常高'];
const INTENT_COLORS = ['#8a919b', '#9a9a6f', '#6f9a9c', '#7d9b76', '#bf8a5e'];

// 編輯表單只碰這些欄位；儲存時合併到最新客戶資料，
// 報價單/時間軸/待辦等不在清單內的資料永遠不會被編輯覆蓋
const EDITABLE_FIELDS = [
  'name', 'phone', 'lineId', 'email', 'address', 'source',
  'clientType', 'taxId', 'industry', 'contacts', 'referrerId', 'referralFee',
  'catId', 'stageId', 'intentLevel', 'notes', 'customFieldValues',
];

function pickEditable(client) {
  const out = {};
  for (const k of EDITABLE_FIELDS) out[k] = client[k];
  return out;
}

export default function ClientDetail({ client, cats, stages, onClose, onDelete }) {
  const {
    clients, customFields, saveTimer, timers, updateClient, thresholds,
    deals, dealFields, saveDeal, todoTemplate,
  } = useApp();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => pickEditable(client));
  const [logInput, setLogInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddTimer, setShowAddTimer] = useState(false);
  const [timerNote, setTimerNote] = useState('');
  const [timerTime, setTimerTime] = useState('');
  const [eventType, setEventType] = useState(null);
  const [eventNote, setEventNote] = useState('');
  const [eventAmount, setEventAmount] = useState('');
  // 交車年度商機提醒（保險續保 / 驗車 / 舊換新預測），日期可調
  const [annualReminders, setAnnualReminders] = useState({
    insurance: { on: true, date: '' },
    inspection: { on: true, date: '' },
    replace: { on: true, date: '' },
  });
  const [signingNote, setSigningNote] = useState(client.signingNote || '');
  const [todoInput, setTodoInput] = useState('');
  const [showDealModal, setShowDealModal] = useState(false);
  const [quoteModal, setQuoteModal] = useState(null); // null=關閉, 'new'=新增, quote物件=編輯
  const [confirmDeleteQuoteId, setConfirmDeleteQuoteId] = useState(null);
  const [editingLog, setEditingLog] = useState(null); // { id, date, text, amount }
  const [confirmDeleteLogId, setConfirmDeleteLogId] = useState(null);

  const clientDeals = deals
    .filter((d) => d.clientId === client.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 轉介紹：介紹人與此客戶介紹出去的名單
  const referrer = client.referrerId ? clients.find((c) => c.id === client.referrerId) : null;
  const referredClients = clients.filter((c) => c.referrerId === client.id);

  const status = getClientStatus(client, thresholds);
  const cat = cats.find((c) => c.id === client.catId);
  const stage = stages.find((s) => s.id === client.stageId);
  const daysSinceContact = client.lastContact ? dayjs().diff(dayjs(client.lastContact), 'day') : null;
  const daysSinceCreated = dayjs().diff(dayjs(client.createdAt), 'day');

  // Timers belonging to this client
  const clientTimers = timers.filter((t) => t.clientId === client.id && !t.confirmedAt);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSave() {
    setEditing(false);
    // 以最新客戶資料為底、只合併可編輯欄位，避免舊快照覆蓋掉報價單/時間軸等
    await updateClient(client.id, (c) => ({ ...c, ...form }));
  }

  async function handleContacted() {
    const t = today();
    const logEntry = {
      id: generateId('log'),
      date: t,
      text: logInput.trim() || '已聯繫',
      type: 'contact',
    };
    setLogInput(''); // 先清空再儲存，避免儲存期間輸入的新內容被清掉
    await updateClient(client.id, (c) => ({
      ...c,
      lastContact: t,
      missedCalls: 0,
      log: [...(c.log || []), logEntry],
    }));
  }

  async function handleMissedCall() {
    await updateClient(client.id, (c) => ({
      ...c,
      missedCalls: (c.missedCalls || 0) + 1,
      log: [
        ...(c.log || []),
        { id: generateId('log'), date: today(), text: '致電未接', type: 'missed' },
      ],
    }));
  }

  // ── 業務流程事件（報價/看車試乘/貸款補件/下訂/交車/售後回訪/LINE 摘要）──────
  async function handleAddEvent() {
    if (!eventType) return;
    const t = today();
    const type = eventType;
    const def = EVENT_TYPES[type];
    const entry = {
      id: generateId('log'),
      date: t,
      type,
      text: eventNote.trim() || def.label,
    };
    const amount = Number(eventAmount);
    if (def.hasAmount && amount > 0) entry.amount = amount;

    const annual = annualReminders;

    // 先關閉表單再儲存：避免連點重複記錄、避免儲存期間的輸入被清掉
    setEventType(null);
    setEventNote('');
    setEventAmount('');

    // 交車：自動建立 3 / 7 / 30 天售後回訪提醒，並把下次追蹤設為 3 天後
    const isDelivery = type === 'delivery';
    if (isDelivery) {
      for (const n of DELIVERY_FOLLOWUP_DAYS) {
        await saveTimer({
          id: generateId('timer'),
          clientId: client.id,
          clientName: client.name,
          note: `交車後 ${n} 天售後回訪`,
          triggerAt: dayjs().add(n, 'day').hour(9).minute(0).second(0).toISOString(),
          confirmedAt: null,
        });
      }
      // 年度商機提醒：保險續保 / 驗車到期（續保佣金、回廠、換車的再接觸點）
      const annualDefs = [
        { key: 'insurance', note: '保險續保回訪（交車滿一年）' },
        { key: 'inspection', note: '驗車到期回訪' },
        { key: 'replace', note: '舊換新評估（車齡近 5 年，談換車）' },
      ];
      for (const def2 of annualDefs) {
        const r = annual[def2.key];
        if (!r.on || !r.date) continue;
        await saveTimer({
          id: generateId('timer'),
          clientId: client.id,
          clientName: client.name,
          note: def2.note,
          triggerAt: dayjs(r.date).hour(9).minute(0).second(0).toISOString(),
          confirmedAt: null,
        });
      }
    }

    await updateClient(client.id, (c) => ({
      ...c,
      lastContact: t,
      missedCalls: 0,
      log: [...(c.log || []), entry],
      ...(isDelivery ? { nextDate: addDays(t, DELIVERY_FOLLOWUP_DAYS[0]) } : {}),
    }));
  }

  // ── 即將簽約：置頂 / 重點備註 / 簽約前待辦 ─────────────────────────────────
  async function togglePinned() {
    await updateClient(client.id, (c) => ({ ...c, pinned: !c.pinned }));
  }

  async function saveSigningNote() {
    if ((client.signingNote || '') !== signingNote) {
      await updateClient(client.id, (c) => ({ ...c, signingNote }));
    }
  }

  async function addTodo() {
    const text = todoInput.trim();
    if (!text) return;
    setTodoInput(''); // 先清空再儲存，避免儲存期間輸入的下一筆被清掉
    await updateClient(client.id, (c) => ({
      ...c,
      todos: [...(c.todos || []), { id: generateId('todo'), text, done: false }],
    }));
  }

  async function toggleTodo(id) {
    await updateClient(client.id, (c) => ({
      ...c,
      todos: (c.todos || []).map((td) => td.id === id ? { ...td, done: !td.done } : td),
    }));
  }

  async function removeTodo(id) {
    await updateClient(client.id, (c) => ({
      ...c,
      todos: (c.todos || []).filter((td) => td.id !== id),
    }));
  }

  /** 報價單：新增寫入 quotes + 時間軸事件；編輯同步更新對應事件的金額與說明 */
  async function handleSaveQuote(q) {
    const isEdit = quoteModal && quoteModal !== 'new';
    setQuoteModal(null);
    const t = today();
    await updateClient(client.id, (c) => {
      const quotes = [...(c.quotes || [])];
      const idx = quotes.findIndex((x) => x.id === q.id);
      const record = {
        id: q.id, date: q.date, model: q.model, items: q.items,
        note: q.note, total: q.total, loan: q.loan,
      };
      if (idx === -1) quotes.push(record);
      else quotes[idx] = record;
      let log = c.log || [];
      if (isEdit) {
        log = log.map((e) => (e.quoteId === q.id ? { ...e, text: q.text, amount: q.total } : e));
      } else {
        log = [...log, {
          id: generateId('log'), date: t, type: 'quote', quoteId: q.id, text: q.text, amount: q.total,
        }];
      }
      return {
        ...c,
        quotes,
        log,
        ...(isEdit ? {} : { lastContact: t, missedCalls: 0 }),
      };
    });
  }

  async function removeQuote(id) {
    setConfirmDeleteQuoteId(null);
    // 只刪報價單存檔，時間軸的報價事件保留為歷史
    await updateClient(client.id, (c) => ({
      ...c,
      quotes: (c.quotes || []).filter((q) => q.id !== id),
    }));
  }

  /** 時間軸事件：編輯 / 刪除 */
  async function saveLogEdit() {
    const { id, date, text, amount } = editingLog;
    setEditingLog(null);
    await updateClient(client.id, (c) => ({
      ...c,
      log: (c.log || []).map((e) => {
        if (e.id !== id) return e;
        const next = { ...e, date: date || e.date, text: text.trim() || e.text };
        delete next.amount;
        if (Number(amount) > 0) next.amount = Number(amount);
        return next;
      }),
    }));
  }

  async function deleteLogEntry(id) {
    setConfirmDeleteLogId(null);
    await updateClient(client.id, (c) => ({
      ...c,
      log: (c.log || []).filter((e) => e.id !== id),
    }));
  }

  /** 成交歸檔：寫入業績表 + 客戶時間軸 */
  async function handleArchiveDeal(deal) {
    setShowDealModal(false);
    await saveDeal(deal);
    const monthLabel = dayjs(deal.date).format('M月');
    await updateClient(client.id, (c) => ({
      ...c,
      lastContact: deal.date,
      log: [...(c.log || []), {
        id: generateId('log'),
        date: deal.date,
        type: 'deal',
        text: `成交歸檔至 ${monthLabel}業績表${deal.note ? `：${deal.note}` : ''}`,
        ...(deal.amount > 0 ? { amount: deal.amount } : {}),
      }],
    }));
  }

  /** 套用交車待辦範本（設定頁可編輯內容；跳過空項與已存在的同名項目） */
  async function applyTodoTemplate() {
    await updateClient(client.id, (c) => {
      const existing = new Set((c.todos || []).map((td) => td.text));
      const additions = todoTemplate
        .map((s) => s.trim())
        .filter((text) => text && !existing.has(text))
        .map((text) => ({ id: generateId('todo'), text, done: false }));
      return { ...c, todos: [...(c.todos || []), ...additions] };
    });
  }

  async function handleAddTimer() {
    if (!timerNote.trim() || !timerTime) return;
    const note = timerNote.trim();
    const triggerAt = new Date(timerTime).toISOString();
    // 先關閉表單再儲存，避免連點重複建立
    setTimerNote('');
    setTimerTime('');
    setShowAddTimer(false);
    await saveTimer({
      id: generateId('timer'),
      clientId: client.id,
      clientName: client.name,
      note,
      triggerAt,
      confirmedAt: null,
    });
  }

  function setNextDate(dateStr) {
    updateClient(client.id, (c) => ({ ...c, nextDate: dateStr }));
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-s1 border-b border-bdr sticky top-0 z-10">
        <div className="w-2 h-8 rounded-full shrink-0" style={{ background: STATUS_COLOR[status] }} />
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-base text-ink truncate">{client.name}</h2>
          <p className="text-xs" style={{ color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={togglePinned}
            title={client.pinned ? '取消置頂' : '置頂（即將簽約）'}
            className={`btn text-xs ${client.pinned ? 'bg-accent/15 text-accent' : 'btn-outline'}`}
          >
            📌{client.pinned ? '已置頂' : ''}
          </button>
          {editing ? (
            <>
              <button onClick={handleSave} className="btn-primary text-xs">儲存</button>
              <button onClick={() => { setEditing(false); setForm(pickEditable(client)); }} className="btn-outline text-xs">取消</button>
            </>
          ) : (
            <button
              onClick={() => { setForm(pickEditable(client)); setEditing(true); }}
              className="btn-outline text-xs"
            >編輯</button>
          )}
          <button onClick={onClose} className="md:hidden btn-ghost text-lg px-2">✕</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-s2 rounded-lg py-2">
            <p className="text-lg font-bold text-ink-2">{daysSinceCreated}</p>
            <p className="text-[10px] text-ink-3">建立天數</p>
          </div>
          <div className="bg-s2 rounded-lg py-2">
            <p className="text-lg font-bold text-ink-2">{daysSinceContact ?? '—'}</p>
            <p className="text-[10px] text-ink-3">距上次聯繫</p>
          </div>
          <div className={`rounded-lg py-2 ${client.missedCalls >= 5 ? 'bg-danger/10' : 'bg-s2'}`}>
            <p className={`text-lg font-bold ${client.missedCalls >= 5 ? 'text-danger' : 'text-ink-2'}`}>
              {client.missedCalls || 0}
            </p>
            <p className="text-[10px] text-ink-3">未接次數</p>
          </div>
        </div>

        {client.missedCalls >= 5 && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger">
            ⚠️ 未接次數達 {client.missedCalls} 次，建議考慮從名單中移除
          </div>
        )}

        {/* Basic info */}
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink-2">基本資料</h3>
          {editing ? (
            <div className="space-y-2">
              <input value={form.name || ''} onChange={(e) => setField('name', e.target.value)} placeholder="姓名 / 公司名" className="w-full" />
              <div className="grid grid-cols-2 gap-2">
                <select value={form.clientType || 'personal'} onChange={(e) => setField('clientType', e.target.value)} className="w-full">
                  <option value="personal">個人戶</option>
                  <option value="company">公司戶</option>
                </select>
                {form.clientType === 'company' ? (
                  <input value={form.taxId || ''} onChange={(e) => setField('taxId', e.target.value)} placeholder="統編" className="w-full" />
                ) : <span />}
              </div>
              <input
                list="industry-options"
                value={form.industry || ''}
                onChange={(e) => setField('industry', e.target.value)}
                placeholder="產業（水電、物流、市場…決定推什麼車斗）"
                className="w-full"
              />
              <datalist id="industry-options">
                {INDUSTRY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
              <input value={form.phone || ''} onChange={(e) => setField('phone', e.target.value)} placeholder="電話" className="w-full" />
              <input value={form.lineId || ''} onChange={(e) => setField('lineId', e.target.value)} placeholder="LINE ID" className="w-full" />
              <input value={form.email || ''} onChange={(e) => setField('email', e.target.value)} placeholder="Email" className="w-full" />
              <input value={form.address || ''} onChange={(e) => setField('address', e.target.value)} placeholder="地址（公司/交車地點）" className="w-full" />
              <input value={form.source || ''} onChange={(e) => setField('source', e.target.value)} placeholder="來源（FB、路過、轉介紹…）" className="w-full" />

              {/* 多聯絡人：老闆 / 採購 / 司機分開存 */}
              <div className="space-y-1.5">
                <p className="text-xs text-ink-3">聯絡人（老闆/採購/司機…）</p>
                {(form.contacts || []).map((ct) => (
                  <div key={ct.id} className="flex gap-1.5">
                    <input value={ct.role} placeholder="角色"
                      onChange={(e) => setField('contacts', form.contacts.map((x) => x.id === ct.id ? { ...x, role: e.target.value } : x))}
                      className="w-16 shrink-0 text-sm" />
                    <input value={ct.name} placeholder="姓名"
                      onChange={(e) => setField('contacts', form.contacts.map((x) => x.id === ct.id ? { ...x, name: e.target.value } : x))}
                      className="w-20 text-sm" />
                    <input value={ct.phone} placeholder="電話"
                      onChange={(e) => setField('contacts', form.contacts.map((x) => x.id === ct.id ? { ...x, phone: e.target.value } : x))}
                      className="flex-1 min-w-0 text-sm" />
                    <button type="button"
                      onClick={() => setField('contacts', form.contacts.filter((x) => x.id !== ct.id))}
                      className="text-danger/50 hover:text-danger shrink-0">✕</button>
                  </div>
                ))}
                <button type="button"
                  onClick={() => setField('contacts', [...(form.contacts || []), { id: generateId('ct'), role: '', name: '', phone: '' }])}
                  className="btn-outline text-xs">＋ 聯絡人</button>
              </div>

              {/* 轉介紹 */}
              <div className="grid grid-cols-2 gap-2">
                <select value={form.referrerId || ''} onChange={(e) => setField('referrerId', e.target.value || null)} className="w-full">
                  <option value="">無介紹人</option>
                  {clients.filter((c) => c.id !== client.id).map((c) => (
                    <option key={c.id} value={c.id}>介紹人：{c.name}</option>
                  ))}
                </select>
                <input type="number" min="0" value={form.referralFee ?? ''}
                  onChange={(e) => setField('referralFee', e.target.value === '' ? null : Number(e.target.value))}
                  placeholder="介紹金（元）" className="w-full" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={form.catId || ''} onChange={(e) => setField('catId', e.target.value)} className="w-full">
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={form.stageId || ''} onChange={(e) => setField('stageId', e.target.value)} className="w-full">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <select value={form.intentLevel || 0} onChange={(e) => setField('intentLevel', Number(e.target.value))} className="w-full">
                {INTENT_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
              </select>
              <textarea value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} placeholder="備註" rows={2} className="w-full resize-none" />
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <InfoRow label="類型" value={
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="badge" style={{
                    background: (client.clientType === 'company' ? '#7291a8' : '#8a919b') + '20',
                    color: client.clientType === 'company' ? '#7291a8' : '#8a919b',
                  }}>
                    {client.clientType === 'company' ? '🏢 公司戶' : '👤 個人戶'}
                  </span>
                  {client.clientType === 'company' && client.taxId && (
                    <span className="text-ink-3 text-xs">統編 {client.taxId}</span>
                  )}
                  {client.industry && (
                    <span className="badge" style={{ background: '#9a9a6f20', color: '#9a9a6f' }}>
                      {client.industry}
                    </span>
                  )}
                </span>
              } />
              <InfoRow label="電話" value={
                client.phone
                  ? <a href={`tel:${client.phone}`} className="text-accent underline">{client.phone}</a>
                  : '—'
              } />
              <InfoRow label="LINE" value={client.lineId || '—'} />
              <InfoRow label="Email" value={client.email || '—'} />
              <InfoRow label="地址" value={
                client.address
                  ? <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`}
                      target="_blank" rel="noreferrer" className="text-accent underline"
                    >{client.address} 🗺</a>
                  : '—'
              } />
              <InfoRow label="來源" value={client.source || '—'} />
              {(client.contacts || []).length > 0 && (
                <InfoRow label="聯絡人" value={
                  <span className="space-y-0.5 block">
                    {client.contacts.map((ct) => (
                      <span key={ct.id} className="block">
                        {ct.role && <span className="text-ink-3 text-xs mr-1">[{ct.role}]</span>}
                        {ct.name}
                        {ct.phone && (
                          <a href={`tel:${ct.phone}`} className="text-accent underline ml-1.5 text-xs">{ct.phone}</a>
                        )}
                      </span>
                    ))}
                  </span>
                } />
              )}
              {(referrer || client.referralFee > 0) && (
                <InfoRow label="轉介紹" value={
                  <span>
                    {referrer ? `由 ${referrer.name} 介紹` : '—'}
                    {client.referralFee > 0 && (
                      <span className="text-accent font-medium ml-1.5">介紹金 NT$ {formatMoney(client.referralFee)}</span>
                    )}
                  </span>
                } />
              )}
              {referredClients.length > 0 && (
                <InfoRow label="介紹名單" value={
                  <span className="text-ink-2">
                    介紹了 {referredClients.length} 位：{referredClients.map((c) => c.name).join('、')}
                  </span>
                } />
              )}
              <InfoRow label="分類" value={cat ? (
                <span className="badge" style={{ background: CAT_COLORS[cat.colorIdx % 7] + '20', color: CAT_COLORS[cat.colorIdx % 7] }}>
                  {cat.name}
                </span>
              ) : '—'} />
              <InfoRow label="進度" value={stage?.name || '—'} />
              <InfoRow label="意願度" value={
                <span style={{ color: INTENT_COLORS[client.intentLevel || 0] }} className="font-medium">
                  {INTENT_LABELS[client.intentLevel || 0]}
                </span>
              } />
              <InfoRow label="備註" value={<span className="text-ink-2 whitespace-pre-wrap">{client.notes || '—'}</span>} />
            </div>
          )}
        </section>

        {/* Custom fields */}
        {customFields.length > 0 && (
          <section className="card p-4 space-y-2">
            <h3 className="font-semibold text-sm text-ink-2">自訂欄位</h3>
            {customFields.map((field) => (
              <div key={field.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs font-medium w-20 shrink-0" style={{ color: FIELD_COLORS[field.colorIdx || 0] }}>
                  {field.name}
                </span>
                {editing ? (
                  <input
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    value={form.customFieldValues?.[field.id] || ''}
                    onChange={(e) => setField('customFieldValues', {
                      ...(form.customFieldValues || {}),
                      [field.id]: e.target.value,
                    })}
                    className="flex-1 text-sm"
                  />
                ) : (
                  <span className="text-ink-2">{client.customFieldValues?.[field.id] || '—'}</span>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Next follow-up date */}
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink-2">📅 下次追蹤日期</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={client.nextDate || ''}
              onChange={(e) => setNextDate(e.target.value)}
              className="text-sm"
            />
            <span className="text-xs text-ink-3">快速：</span>
            {QUICK_DATES.map(({ label, days }) => (
              <button key={label} onClick={() => setNextDate(addDays(today(), days))} className="btn-outline text-xs px-2 py-1">
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Contact actions */}
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink-2">📞 聯繫操作</h3>
          <textarea
            value={logInput}
            onChange={(e) => setLogInput(e.target.value)}
            placeholder="聯繫備註（可留空）"
            rows={2}
            className="w-full resize-none text-sm"
          />
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleContacted} className="btn-primary text-sm flex-1">✅ 已聯繫</button>
            <button onClick={handleMissedCall} className="btn-outline text-sm flex-1">
              📵 未接 ({client.missedCalls || 0})
            </button>
          </div>
          {client.lastContact && (
            <p className="text-xs text-ink-3">上次聯繫：{formatDateFull(client.lastContact)}</p>
          )}
        </section>

        {/* 業務流程事件 */}
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink-2">🚛 業務進度記錄</h3>
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_EVENT_KEYS.map((key) => {
              const def = EVENT_TYPES[key];
              const active = eventType === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setEventType(active ? null : key);
                    setEventNote('');
                    setEventAmount('');
                    if (key === 'delivery' && !active) {
                      const in11mo = dayjs().add(11, 'month').format('YYYY-MM-DD');
                      // 舊換新預測：車齡近 5 年前半年進場談換車
                      const in54mo = dayjs().add(54, 'month').format('YYYY-MM-DD');
                      setAnnualReminders({
                        insurance: { on: true, date: in11mo },
                        inspection: { on: true, date: in11mo },
                        replace: { on: true, date: in54mo },
                      });
                    }
                  }}
                  className={`btn text-xs px-2 py-1 border ${active ? 'text-white' : ''}`}
                  style={active
                    ? { background: def.color, borderColor: def.color }
                    : { borderColor: def.color + '60', color: def.color }}
                >
                  {def.icon} {def.label}
                </button>
              );
            })}
          </div>

          {eventType && (
            <div className="space-y-2 bg-s2 rounded-lg p-3 anim-fade-in">
              <textarea
                value={eventNote}
                onChange={(e) => setEventNote(e.target.value)}
                placeholder={`${EVENT_TYPES[eventType].label}內容（車型、條件、結果…）`}
                rows={2}
                className="w-full resize-none text-sm"
              />
              {EVENT_TYPES[eventType].hasAmount && (
                <input
                  type="number"
                  value={eventAmount}
                  onChange={(e) => setEventAmount(e.target.value)}
                  placeholder="金額（元，選填）"
                  className="w-full text-sm"
                />
              )}
              {eventType === 'delivery' && (
                <div className="space-y-2">
                  <p className="text-xs text-ink-3">
                    🔔 記錄交車後會自動建立 {DELIVERY_FOLLOWUP_DAYS.join(' / ')} 天售後回訪提醒
                  </p>
                  <p className="text-xs font-medium text-ink-2">年度商機提醒（日期可調）：</p>
                  {[
                    { key: 'insurance', label: '🛡 保險續保' },
                    { key: 'inspection', label: '🔧 驗車到期' },
                    { key: 'replace', label: '🔄 舊換新評估' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-xs text-ink-2">
                      <input
                        type="checkbox"
                        checked={annualReminders[key].on}
                        onChange={(e) => setAnnualReminders((a) => ({
                          ...a, [key]: { ...a[key], on: e.target.checked },
                        }))}
                      />
                      <span className="w-20 shrink-0">{label}</span>
                      <input
                        type="date"
                        value={annualReminders[key].date}
                        disabled={!annualReminders[key].on}
                        onChange={(e) => setAnnualReminders((a) => ({
                          ...a, [key]: { ...a[key], date: e.target.value },
                        }))}
                        className="flex-1 text-xs disabled:opacity-40"
                      />
                    </label>
                  ))}
                </div>
              )}
              <button onClick={handleAddEvent} className="btn-primary text-xs w-full">
                {EVENT_TYPES[eventType].icon} 記錄「{EVENT_TYPES[eventType].label}」
              </button>
            </div>
          )}
        </section>

        {/* 報價單（可回頭編輯） */}
        <section className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-ink-2">🧾 報價單</h3>
            <button onClick={() => setQuoteModal('new')} className="btn-primary text-xs">
              ＋ 建立報價單
            </button>
          </div>
          {(client.quotes || []).length === 0 && (
            <p className="text-xs text-ink-3">填車型與項目價格，產生可截圖的報價單；建立後可隨時回來編輯。</p>
          )}
          {[...(client.quotes || [])].reverse().map((q) => (
            <div key={q.id} className="flex items-center gap-2 text-xs bg-s2 rounded-lg px-3 py-2">
              <span className="text-ink-3 font-mono shrink-0">{dayjs(q.date).format('MM/DD')}</span>
              <span className="flex-1 truncate text-ink-2">{q.model || '未填車型'}</span>
              <span className="font-semibold text-accent shrink-0">NT$ {formatMoney(q.total)}</span>
              <button onClick={() => setQuoteModal(q)} className="text-ink-3 hover:text-ink shrink-0">✏️</button>
              {confirmDeleteQuoteId === q.id ? (
                <span className="flex gap-1 shrink-0">
                  <button onClick={() => removeQuote(q.id)} className="btn-danger text-[10px] px-1.5 py-0.5">刪除</button>
                  <button onClick={() => setConfirmDeleteQuoteId(null)} className="btn-outline text-[10px] px-1.5 py-0.5">取消</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDeleteQuoteId(q.id)} className="text-danger/40 hover:text-danger shrink-0">✕</button>
              )}
            </div>
          ))}
        </section>

        {/* 成交歸檔 */}
        <section className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-ink-2">🏆 成交歸檔</h3>
            <button onClick={() => setShowDealModal(true)} className="btn-primary text-xs">
              ＋ 歸檔到業績表
            </button>
          </div>
          <p className="text-xs text-ink-3">
            成交後把金額歸入當月業績表，可記錄保險金額、收入等欄位並自動加總（欄位可在設定自訂）。
          </p>
          {clientDeals.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-xs bg-s2 rounded-lg px-3 py-2">
              <span className="text-ink-3 font-mono">{dayjs(d.date).format('YYYY/MM/DD')}</span>
              <span className="font-semibold text-accent">NT$ {formatMoney(d.amount)}</span>
              {d.note && <span className="text-ink-2 truncate">{d.note}</span>}
            </div>
          ))}
        </section>

        {/* 即將簽約：重點備註 + 簽約前待辦 */}
        {client.pinned && (
          <section className="card p-4 space-y-3 border-accent/40">
            <h3 className="font-semibold text-sm text-accent">📌 即將簽約</h3>
            <textarea
              value={signingNote}
              onChange={(e) => setSigningNote(e.target.value)}
              onBlur={saveSigningNote}
              placeholder="重點備註（價格底線、關鍵條件、注意事項…）"
              rows={2}
              className="w-full resize-none text-sm"
            />
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-ink-2">
                  簽約前待辦
                  {(client.todos || []).length > 0 && (
                    <span className="text-ink-3 font-normal ml-1">
                      （{(client.todos || []).filter((td) => td.done).length}/{(client.todos || []).length}）
                    </span>
                  )}
                </p>
                <button onClick={applyTodoTemplate} className="text-xs text-accent hover:underline">
                  ＋套用交車待辦範本
                </button>
              </div>
              <div className="space-y-1">
                {(client.todos || []).map((td) => (
                  <div key={td.id} className="flex items-center gap-2 text-sm group">
                    <input type="checkbox" checked={td.done} onChange={() => toggleTodo(td.id)} className="shrink-0" />
                    <span className={`flex-1 ${td.done ? 'line-through text-ink-3' : 'text-ink-2'}`}>{td.text}</span>
                    <button onClick={() => removeTodo(td.id)} className="text-danger/40 hover:text-danger text-xs">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  value={todoInput}
                  onChange={(e) => setTodoInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); }}
                  placeholder="新增待辦（保險、車貸文件…）"
                  className="flex-1 text-sm"
                />
                <button onClick={addTodo} className="btn-outline text-xs">加入</button>
              </div>
            </div>
          </section>
        )}

        {/* Timer section */}
        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-ink-2">⏰ 計時提醒</h3>
            <button onClick={() => setShowAddTimer(!showAddTimer)} className="btn-outline text-xs">
              {showAddTimer ? '取消' : '+ 新增提醒'}
            </button>
          </div>

          {showAddTimer && (
            <div className="space-y-2 bg-s2 rounded-lg p-3">
              <input
                value={timerNote}
                onChange={(e) => setTimerNote(e.target.value)}
                placeholder="提醒內容"
                className="w-full text-sm"
              />
              <input
                type="datetime-local"
                value={timerTime}
                min={dayjs().format('YYYY-MM-DDTHH:mm')}
                onChange={(e) => setTimerTime(e.target.value)}
                className="w-full text-sm"
              />
              <button onClick={handleAddTimer} className="btn-primary text-xs w-full">確認新增</button>
            </div>
          )}

          {clientTimers.length === 0 && !showAddTimer && (
            <p className="text-xs text-ink-3">無待確認提醒</p>
          )}
          {clientTimers.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-xs bg-s2 rounded-lg px-3 py-2">
              <span className="text-ink-2">{t.note}</span>
              <span className="text-ink-3 shrink-0 ml-2">{dayjs(t.triggerAt).format('MM/DD HH:mm')}</span>
            </div>
          ))}
        </section>

        {/* 互動時間軸 */}
        {(client.log || []).length > 0 && (
          <section className="card p-4">
            <h3 className="font-semibold text-sm text-ink-2 mb-3">📜 互動時間軸</h3>
            <div className="space-y-0">
              {[...(client.log || [])].reverse().slice(0, 50).map((entry, idx, arr) => {
                const def = EVENT_TYPES[entry.type] || EVENT_TYPES.contact;
                const isEditing = editingLog?.id === entry.id;
                return (
                  <div key={entry.id} className="flex gap-3 text-sm relative group">
                    {/* Timeline rail */}
                    <div className="flex flex-col items-center shrink-0 w-6">
                      <span className="text-sm leading-none mt-0.5">{def.icon}</span>
                      {idx < arr.length - 1 && <div className="w-px flex-1 bg-bdr my-1" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-1.5 bg-s2 rounded-lg p-2">
                          <div className="flex gap-1.5 flex-wrap">
                            <input type="date" value={editingLog.date}
                              onChange={(e) => setEditingLog((v) => ({ ...v, date: e.target.value }))}
                              className="text-xs" />
                            <input type="number" min="0" value={editingLog.amount}
                              onChange={(e) => setEditingLog((v) => ({ ...v, amount: e.target.value }))}
                              placeholder="金額（留空移除）" className="text-xs w-32" />
                          </div>
                          <textarea value={editingLog.text}
                            onChange={(e) => setEditingLog((v) => ({ ...v, text: e.target.value }))}
                            rows={2} className="w-full resize-none text-xs" />
                          <div className="flex gap-1.5">
                            <button onClick={saveLogEdit} className="btn-primary text-[10px] px-2 py-0.5">儲存</button>
                            <button onClick={() => setEditingLog(null)} className="btn-outline text-[10px] px-2 py-0.5">取消</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                              style={{ background: def.color + '18', color: def.color }}>
                              {def.label}
                            </span>
                            <span className="text-[10px] text-ink-3">{formatDateFull(entry.date)}</span>
                            {entry.amount > 0 && (
                              <span className="text-[10px] font-semibold text-accent">
                                NT$ {entry.amount.toLocaleString('zh-TW')}
                              </span>
                            )}
                            <span className="ml-auto flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => setEditingLog({
                                  id: entry.id, date: entry.date,
                                  text: entry.text, amount: entry.amount ? String(entry.amount) : '',
                                })}
                                className="text-ink-3 hover:text-ink text-[11px]">✏️</button>
                              {confirmDeleteLogId === entry.id ? (
                                <>
                                  <button onClick={() => deleteLogEntry(entry.id)}
                                    className="btn-danger text-[10px] px-1.5 py-0.5">刪除</button>
                                  <button onClick={() => setConfirmDeleteLogId(null)}
                                    className="btn-outline text-[10px] px-1.5 py-0.5">取消</button>
                                </>
                              ) : (
                                <button onClick={() => setConfirmDeleteLogId(entry.id)}
                                  className="text-danger/40 hover:text-danger text-[11px]">✕</button>
                              )}
                            </span>
                          </div>
                          <p className="text-ink-2 mt-0.5 whitespace-pre-wrap break-words">{entry.text}</p>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {quoteModal && (
          <QuoteModal
            client={client}
            quote={quoteModal === 'new' ? null : quoteModal}
            onClose={() => setQuoteModal(null)}
            onSaveQuote={handleSaveQuote}
          />
        )}

        {showDealModal && (
          <DealModal
            deal={null}
            client={client}
            dealFields={dealFields}
            onClose={() => setShowDealModal(false)}
            onSave={handleArchiveDeal}
          />
        )}

        {/* Danger zone */}
        <section className="card p-4 border-danger/20">
          {!showDeleteConfirm ? (
            <button onClick={() => setShowDeleteConfirm(true)} className="text-danger text-sm hover:underline">
              🗑 刪除此客戶
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-danger font-medium">確定要刪除「{client.name}」嗎？此操作無法還原。</p>
              <div className="flex gap-2">
                <button onClick={() => onDelete(client.id)} className="btn-danger text-sm flex-1">確定刪除</button>
                <button onClick={() => setShowDeleteConfirm(false)} className="btn-outline text-sm flex-1">取消</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-ink-3 w-14 shrink-0 text-xs mt-0.5">{label}</span>
      <span className="text-ink-2 flex-1">{value}</span>
    </div>
  );
}
