import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useApp } from '../../context';
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from '../../utils/cases';
import { addDays, today } from '../../utils/date';
import { formatMoney, generateId } from '../../utils/crm';
import { getWaitingOn, normalizeDeliveryWorkflow } from '../../utils/delivery';

const STATUS_FILTERS = [['active', '進行中'], ['waiting', '等待中'], ['completed', '已完成'], ['all', '全部']];

function nextAction(item, workItems, deals) {
  const direct = workItems.filter((row) => row.caseId === item.id && row.state !== 'done')
    .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')))[0];
  if (direct) return direct;
  if (item.dealId) {
    const workflow = normalizeDeliveryWorkflow(deals.find((row) => row.id === item.dealId));
    const step = workflow.find((row) => !['done', 'na'].includes(row.status) && !getWaitingOn(row, workflow));
    if (step) return { title: step.label, due: step.plannedDate };
  }
  return null;
}

export default function CasesPage({ focusId, startNewToken, onFocusConsumed, onStartConsumed, onOpenClient, onOpenQuotes, onOpenOperations }) {
  const { cases, workItems, activities, clients, deals, quoteDrafts, cats, stages, saveCase, saveWorkItem, saveActivity, saveClient } = useApp();
  const [filter, setFilter] = useState('active');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (focusId) { setSelectedId(focusId); onFocusConsumed?.(); }
  }, [focusId, onFocusConsumed]);
  useEffect(() => {
    if (startNewToken) { setShowNew(true); onStartConsumed?.(); }
  }, [startNewToken, onStartConsumed]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...cases]
      .filter((row) => filter === 'all' || row.status === filter)
      .filter((row) => !needle || [row.clientName, row.title, CASE_TYPE_LABEL[row.type]].some((value) => String(value || '').toLowerCase().includes(needle)))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [cases, filter, query]);
  const selected = cases.find((row) => row.id === selectedId);

  return (
    <div className="max-w-4xl mx-auto px-3 md:px-5 py-4 md:py-6 space-y-4">
      <section className="rounded-2xl border border-teal/30 bg-gradient-to-br from-teal/14 via-s1 to-sage/8 p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-teal">CUSTOMER CASES</p>
            <h1 className="text-2xl font-bold text-ink mt-1">客戶案件</h1>
            <p className="text-sm text-ink-2 mt-1">同一位客戶可有多筆購車或改車案件。</p>
          </div>
          <button type="button" onClick={() => setShowNew(true)} className="btn-primary min-h-11 shrink-0">＋ 新案件</button>
        </div>
      </section>

      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋客戶或案件…" className="w-full min-h-11" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map(([key, label]) => {
          const count = key === 'all' ? cases.length : cases.filter((row) => row.status === key).length;
          return <button key={key} type="button" onClick={() => setFilter(key)} className={`shrink-0 min-h-10 rounded-full border px-3 text-sm ${filter === key ? 'border-teal bg-teal/12 text-teal' : 'border-bdr bg-s1 text-ink-2'}`}>{label} {count}</button>;
        })}
      </div>

      {rows.length === 0 ? (
        <section className="card p-9 text-center">
          <div className="text-4xl">📁</div>
          <h2 className="font-bold text-ink mt-3">這裡還沒有案件</h2>
          <p className="text-sm text-ink-3 mt-1">新增後，只要從案件處理下一步即可。</p>
          <button type="button" onClick={() => setShowNew(true)} className="btn-primary mt-4">＋ 建立第一筆案件</button>
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((item) => {
            const action = nextAction(item, workItems, deals);
            return (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className="card p-4 text-left hover:border-teal/50 active:scale-[0.99] transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className={`badge ${item.type === 'modification' ? 'bg-violet/12 text-violet' : 'bg-teal/12 text-teal'}`}>{CASE_TYPE_LABEL[item.type] || '案件'}</span>
                      <span className="badge bg-s2 text-ink-2">{CASE_STATUS_LABEL[item.status] || '進行中'}</span>
                    </div>
                    <h2 className="font-bold text-ink mt-2 truncate">{item.clientName || '未命名客戶'}</h2>
                    <p className="text-sm text-ink-2 truncate">{item.title || '未命名案件'}</p>
                  </div>
                  <span className="text-ink-3">›</span>
                </div>
                <div className="mt-3 rounded-lg bg-s2 px-3 py-2">
                  <p className="text-[10px] text-ink-3">下一步</p>
                  <p className={`text-sm mt-0.5 ${action ? 'text-ink font-medium' : 'text-ink-3'}`}>{action?.title || '尚未安排工作'}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showNew && <NewCaseModal clients={clients} cats={cats} stages={stages} onClose={() => setShowNew(false)} onSaveCase={saveCase} onSaveClient={saveClient} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onCreated={(id) => { setShowNew(false); setSelectedId(id); }} />}
      {selected && <CaseDetail item={selected} workItems={workItems} activities={activities} deals={deals} quotes={quoteDrafts} onClose={() => setSelectedId(null)} onSaveCase={saveCase} onSaveWorkItem={saveWorkItem} onSaveActivity={saveActivity} onOpenClient={onOpenClient} onOpenQuotes={onOpenQuotes} onOpenOperations={onOpenOperations} />}
    </div>
  );
}

function NewCaseModal({ clients, cats, stages, onClose, onSaveCase, onSaveClient, onSaveWorkItem, onSaveActivity, onCreated }) {
  const [clientMode, setClientMode] = useState(clients.length ? 'existing' : 'new');
  const [clientId, setClientId] = useState(clients[0]?.id || '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('purchase');
  const [title, setTitle] = useState('');
  const [nextTitle, setNextTitle] = useState('確認客戶需求');
  const [due, setDue] = useState(addDays(today(), 1));
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    let client = clients.find((row) => row.id === clientId);
    if (clientMode === 'new') {
      if (!name.trim()) { setSaving(false); return; }
      client = await onSaveClient({
        id: generateId('client'), name: name.trim(), phone: phone.trim(), source: '案件建立',
        catId: cats[0]?.id || '', stageId: stages[0]?.id || '', clientType: 'personal',
        intentLevel: 0, nextDate: '', notes: '', log: [], missedCalls: 0,
      });
    }
    if (!client) { setSaving(false); return; }
    const id = generateId('case');
    const item = await onSaveCase({
      id, clientId: client.id, clientName: client.name, type, status: 'active',
      title: title.trim() || (type === 'purchase' ? '購車案件' : '改裝案件'), source: 'manual', quoteIds: [], dealId: null,
    });
    if (nextTitle.trim()) await onSaveWorkItem({ id: generateId('work'), caseId: id, clientId: client.id, clientName: client.name, title: nextTitle.trim(), due, state: 'todo' });
    await onSaveActivity({ id: generateId('activity'), caseId: id, clientId: client.id, type: 'created', text: `建立${CASE_TYPE_LABEL[type]}案件`, date: today() });
    onCreated(item.id);
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg safe-panel overflow-y-auto anim-slide-up">
      <form onSubmit={submit} className="max-w-xl mx-auto min-h-full bg-s1 md:my-8 md:min-h-0 md:rounded-2xl md:border md:border-bdr">
        <header className="sticky top-0 z-10 bg-s1/95 backdrop-blur border-b border-bdr px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-3">←</button>
          <h2 className="font-bold text-lg text-ink flex-1">建立客戶案件</h2>
          <button type="submit" disabled={saving} className="btn-primary min-h-11">{saving ? '儲存中…' : '建立'}</button>
        </header>
        <div className="p-4 space-y-5 pb-28">
          <section>
            <label className="section-title block px-0">1. 客戶</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button type="button" onClick={() => setClientMode('existing')} className={`min-h-12 rounded-xl border ${clientMode === 'existing' ? 'border-teal bg-teal/12 text-teal' : 'border-bdr'}`}>選既有客戶</button>
              <button type="button" onClick={() => setClientMode('new')} className={`min-h-12 rounded-xl border ${clientMode === 'new' ? 'border-teal bg-teal/12 text-teal' : 'border-bdr'}`}>建立新客戶</button>
            </div>
            {clientMode === 'existing' ? <select value={clientId} onChange={(event) => setClientId(event.target.value)} className="w-full min-h-12 mt-3">{clients.map((row) => <option key={row.id} value={row.id}>{row.name}{row.phone ? `・${row.phone}` : ''}</option>)}</select>
              : <div className="grid grid-cols-1 gap-2 mt-3"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="客戶姓名或公司名稱（必填）" className="min-h-12" /><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="電話（選填）" className="min-h-12" /></div>}
          </section>
          <section>
            <label className="section-title block px-0">2. 案件種類</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[['purchase', '🚛 購車'], ['modification', '🛠️ 改車']].map(([key, label]) => <button key={key} type="button" onClick={() => setType(key)} className={`min-h-16 rounded-xl border text-base font-bold ${type === key ? 'border-teal bg-teal/12 text-teal' : 'border-bdr'}`}>{label}</button>)}
            </div>
          </section>
          <section className="space-y-2">
            <label className="section-title block px-0">3. 案件與下一步</label>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={type === 'purchase' ? '例：K2500 雙廂購車' : '例：尾門＋帆布改裝'} className="w-full min-h-12" />
            <input value={nextTitle} onChange={(event) => setNextTitle(event.target.value)} placeholder="下一步要做什麼" className="w-full min-h-12" />
            <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="w-full min-h-12" />
          </section>
        </div>
      </form>
    </div>
  );
}

function CaseDetail({ item, workItems, activities, deals, quotes, onClose, onSaveCase, onSaveWorkItem, onSaveActivity, onOpenClient, onOpenQuotes, onOpenOperations }) {
  const [newTitle, setNewTitle] = useState('');
  const [due, setDue] = useState(addDays(today(), 1));
  const linkedDeal = deals.find((row) => row.id === item.dealId);
  const linkedQuotes = quotes.filter((row) => (item.quoteIds || []).includes(row.id));
  const caseWork = workItems.filter((row) => row.caseId === item.id);
  const pending = caseWork.filter((row) => row.state !== 'done');
  const completed = caseWork.filter((row) => row.state === 'done');
  const timeline = activities.filter((row) => row.caseId === item.id).sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  const workflow = normalizeDeliveryWorkflow(linkedDeal);

  async function addWork(event) {
    event.preventDefault();
    if (!newTitle.trim()) return;
    await onSaveWorkItem({ id: generateId('work'), caseId: item.id, clientId: item.clientId, clientName: item.clientName, title: newTitle.trim(), due, state: 'todo' });
    await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, type: 'work', text: `新增工作：${newTitle.trim()}`, date: today() });
    setNewTitle('');
  }

  async function finishWork(row) {
    await onSaveWorkItem({ ...row, state: 'done', completedAt: new Date().toISOString() });
    await onSaveActivity({ id: generateId('activity'), caseId: item.id, clientId: item.clientId, type: 'work', text: `完成：${row.title}`, date: today() });
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg safe-panel overflow-y-auto anim-slide-right">
      <div className="max-w-3xl mx-auto min-h-full bg-bg">
        <header className="sticky top-0 z-20 bg-s1/95 backdrop-blur border-b border-bdr px-3 py-2.5 flex items-center gap-2">
          <button type="button" onClick={onClose} className="btn-ghost min-h-11 px-3">←</button>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink truncate">{item.clientName || '未命名客戶'}</p>
            <p className="text-xs text-ink-3 truncate">{CASE_TYPE_LABEL[item.type]}・{item.title}</p>
          </div>
          <select value={item.status} onChange={(event) => onSaveCase({ ...item, status: event.target.value })} className="min-h-10 text-xs w-24">
            <option value="active">進行中</option><option value="waiting">等待中</option><option value="completed">已完成</option>
          </select>
        </header>

        <div className="p-3 md:p-5 space-y-4 pb-28">
          <section className="grid grid-cols-3 gap-2">
            <button type="button" disabled={!item.clientId} onClick={() => item.clientId && onOpenClient?.(item.clientId)} className="card min-h-16 px-2 py-3 text-xs font-bold text-accent disabled:opacity-40">👤 客戶資料</button>
            <button type="button" onClick={onOpenQuotes} className="card min-h-16 px-2 py-3 text-xs font-bold text-gold">🧾 報價管理</button>
            <button type="button" onClick={onOpenOperations} className="card min-h-16 px-2 py-3 text-xs font-bold text-copper">🚚 施工進度</button>
          </section>

          <section className="card p-4">
            <h2 className="font-bold text-ink">下一步</h2>
            {pending.length === 0 ? <p className="text-sm text-ink-3 mt-3">尚未安排工作。</p> : <div className="space-y-2 mt-3">{pending.map((row) => <div key={row.id} className="rounded-xl border border-bdr bg-s2 p-3 flex items-center gap-3"><button type="button" onClick={() => finishWork(row)} className="w-10 h-10 rounded-full border-2 border-ok text-ok font-bold shrink-0" aria-label={`完成 ${row.title}`}>✓</button><div className="min-w-0 flex-1"><p className="font-medium text-ink">{row.title}</p><p className="text-xs text-ink-3 mt-0.5">{row.due ? dayjs(row.due).format('YYYY/MM/DD') : '未排日期'}{row.state === 'waiting' ? '・等待中' : ''}</p></div></div>)}</div>}
            <form onSubmit={addWork} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="新增下一步…" className="min-h-11" />
              <button className="btn-primary min-h-11">加入</button>
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className="min-h-11 col-span-2" />
            </form>
          </section>

          {workflow.length > 0 && <section className="card p-4"><div className="flex items-center justify-between gap-2"><h2 className="font-bold text-ink">交車施工流程</h2><button type="button" onClick={onOpenOperations} className="text-xs text-copper">完整管理 →</button></div><div className="space-y-2 mt-3">{workflow.map((step, index) => { const waiting = getWaitingOn(step, workflow); return <div key={step.id} className="flex gap-3"><div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${['done', 'na'].includes(step.status) ? 'bg-ok text-on-accent' : waiting ? 'bg-gold/15 text-gold' : 'bg-accent/12 text-accent'}`}>{['done', 'na'].includes(step.status) ? '✓' : index + 1}</div><div className="min-w-0 pb-2"><p className="text-sm font-medium text-ink">{step.label}</p><p className="text-[11px] text-ink-3">{waiting ? `等待：${waiting.label}` : step.plannedDate || step.service}</p></div></div>; })}</div></section>}

          {(linkedQuotes.length > 0 || linkedDeal) && <section className="card p-4"><h2 className="font-bold text-ink">關聯資料</h2>{linkedQuotes.map((quote) => <div key={quote.id} className="mt-3 flex items-center justify-between gap-3"><div><p className="text-sm text-ink">報價・{quote.model || '未填車型'}</p><p className="text-xs text-ink-3">{quote.date}</p></div><strong className="text-gold">NT$ {formatMoney(quote.total)}</strong></div>)}{linkedDeal && <div className="mt-3 flex items-center justify-between gap-3"><div><p className="text-sm text-ink">成交・{linkedDeal.model || linkedDeal.note || '車輛'}</p><p className="text-xs text-ink-3">{linkedDeal.date}</p></div><strong className="text-copper">NT$ {formatMoney(linkedDeal.amount)}</strong></div>}</section>}

          <section className="card p-4"><h2 className="font-bold text-ink">案件紀錄</h2>{timeline.length === 0 ? <p className="text-sm text-ink-3 mt-3">目前沒有紀錄。</p> : <div className="mt-3 space-y-3">{timeline.map((row) => <div key={row.id} className="border-l-2 border-bdr pl-3"><p className="text-sm text-ink">{row.text}</p><p className="text-[11px] text-ink-3 mt-0.5">{dayjs(row.date || row.createdAt).format('YYYY/MM/DD HH:mm')}</p></div>)}</div>}</section>
          {completed.length > 0 && <details className="card p-4"><summary className="font-bold text-ink cursor-pointer">已完成工作 {completed.length} 項</summary><div className="mt-3 space-y-2">{completed.map((row) => <p key={row.id} className="text-sm text-ink-3 line-through">✓ {row.title}</p>)}</div></details>}
        </div>
      </div>
    </div>
  );
}
