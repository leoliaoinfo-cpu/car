import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../../context';
import {
  getClientStatus, clientMatchesFilter, sortClients,
  CAT_COLORS, STATUS_COLOR, STATUS_LABEL, generateId, INDUSTRY_SUGGESTIONS,
} from '../../utils/crm';
import { today, formatDate, formatDateFull, addDays, QUICK_DATES } from '../../utils/date';
import ClientDetail from './ClientDetail';
import dayjs from 'dayjs';

const SORT_OPTIONS = [
  { value: 'createdAt', label: '建立時間' },
  { value: 'nextDate', label: '追蹤日期' },
  { value: 'lastContact', label: '最後聯繫' },
  { value: 'name', label: '姓名' },
  { value: 'intent', label: '意願度' },
];

const ITEM_HEIGHT = 72; // px for desktop row / card

function useVirtualList(items, containerRef, itemHeight = ITEM_HEIGHT) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, [containerRef]);

  const buffer = 8;
  const startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
  const endIdx = Math.min(items.length - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer);
  const visibleItems = items.slice(startIdx, endIdx + 1);
  const totalHeight = items.length * itemHeight;
  const offsetY = startIdx * itemHeight;

  return { visibleItems, totalHeight, offsetY };
}

export default function CrmPage({ focusId, onFocusConsumed }) {
  const { clients, cats, stages, thresholds, saveClient, deleteClient } = useApp();
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState('createdAt');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const listRef = useRef(null);

  // 從「今日工作」頁跳轉過來時，直接打開指定客戶
  useEffect(() => {
    if (focusId) {
      setSelectedId(focusId);
      onFocusConsumed?.();
    }
  }, [focusId, onFocusConsumed]);

  const filteredSorted = useMemo(() => {
    let list = clients.filter((c) => clientMatchesFilter(c, filter, thresholds));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.lineId?.toLowerCase().includes(q) ||
        c.notes?.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q) ||
        c.taxId?.toLowerCase().includes(q) ||
        (c.contacts || []).some((ct) =>
          ct.name?.toLowerCase().includes(q) || ct.phone?.toLowerCase().includes(q)
        )
      );
    }
    return sortClients(list, sortKey);
  }, [clients, filter, sortKey, search, thresholds]);

  const { visibleItems, totalHeight, offsetY } = useVirtualList(filteredSorted, listRef);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedId) || null,
    [clients, selectedId]
  );

  const catCounts = useMemo(() => {
    const map = {};
    clients.forEach((c) => {
      map[c.catId] = (map[c.catId] || 0) + 1;
    });
    return map;
  }, [clients]);

  const stageCounts = useMemo(() => {
    const map = {};
    clients.forEach((c) => {
      map[c.stageId] = (map[c.stageId] || 0) + 1;
    });
    return map;
  }, [clients]);

  const pendingCount = useMemo(() => clients.filter((c) => {
    const nd = c.nextDate ? dayjs(c.nextDate) : null;
    return nd && !nd.isAfter(dayjs(), 'day');
  }).length, [clients]);

  const coldCount = useMemo(() => clients.filter((c) => {
    const s = getClientStatus(c, thresholds);
    return s === 'cold' || s === 'hot';
  }).length, [clients, thresholds]);

  function handleSelect(id) {
    setSelectedId(id);
    setShowSidebar(false);
  }

  async function handleNewClient(data) {
    const client = {
      id: generateId('client'),
      ...data,
      log: [],
      missedCalls: 0,
      createdAt: new Date().toISOString(),
    };
    await saveClient(client);
    setSelectedId(client.id);
    setShowNewForm(false);
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar — drawer on mobile, fixed on desktop */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-s1 border-r border-bdr flex flex-col transition-transform duration-300
        md:static md:translate-x-0 md:z-auto md:h-full
        ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Mobile close */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-bdr">
          <span className="font-semibold text-ink">篩選分類</span>
          <button onClick={() => setShowSidebar(false)} className="text-ink-3 text-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Fixed filters */}
          <div>
            <p className="section-title">快速篩選</p>
            {[
              { key: 'all', label: '全部', count: clients.length, color: '#8f7a68' },
              { key: 'pending', label: '待聯繫', count: pendingCount, color: STATUS_COLOR.warn },
              { key: 'cold', label: '冷掉了', count: coldCount, color: STATUS_COLOR.cold },
            ].map((f) => (
              <SidebarItem key={f.key} active={filter === f.key} color={f.color}
                label={f.label} count={f.count} onClick={() => { setFilter(f.key); setShowSidebar(false); }} />
            ))}
          </div>

          {/* Categories */}
          <div>
            <p className="section-title">客戶分類</p>
            {[...cats].sort((a, b) => a.order - b.order).map((cat) => (
              <SidebarItem key={cat.id} active={filter === `cat:${cat.id}`}
                color={CAT_COLORS[cat.colorIdx % CAT_COLORS.length]}
                label={cat.name} count={catCounts[cat.id] || 0}
                onClick={() => { setFilter(`cat:${cat.id}`); setShowSidebar(false); }} />
            ))}
          </div>

          {/* Stages */}
          <div>
            <p className="section-title">業務進度</p>
            {[...stages].sort((a, b) => a.order - b.order).map((stage) => (
              <SidebarItem key={stage.id} active={filter === `stage:${stage.id}`}
                color={CAT_COLORS[stage.colorIdx % CAT_COLORS.length]}
                label={stage.name} count={stageCounts[stage.id] || 0}
                onClick={() => { setFilter(`stage:${stage.id}`); setShowSidebar(false); }} />
            ))}
          </div>
        </div>
      </aside>

      {/* Overlay for mobile drawer */}
      {showSidebar && (
        <div className="md:hidden fixed inset-0 bg-black/30 z-30" onClick={() => setShowSidebar(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-bdr bg-s1 flex-wrap">
          <button onClick={() => setShowSidebar(true)} className="md:hidden btn-ghost text-sm">☰</button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋客戶…"
            className="flex-1 min-w-0 text-sm max-w-xs"
          />
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="text-xs py-1">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => setShowNewForm(true)} className="btn-primary text-sm">+ 新增</button>
          <span className="text-xs text-ink-3 shrink-0">{filteredSorted.length} 筆</span>
        </div>

        {/* List + Detail side by side on desktop */}
        <div className="flex flex-1 min-h-0">
          {/* Client list */}
          <div
            ref={listRef}
            className={`overflow-y-auto ${selectedClient ? 'hidden md:block md:w-80 lg:w-96' : 'flex-1'}`}
          >
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${offsetY}px)` }}>
                {visibleItems.map((client) => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    cats={cats}
                    stages={stages}
                    selected={selectedId === client.id}
                    onClick={() => handleSelect(client.id)}
                  />
                ))}
              </div>
            </div>
            {filteredSorted.length === 0 && (
              <div className="py-16 text-center text-ink-3 text-sm">
                {search ? '沒有符合的客戶' : '尚無客戶，點右上角「新增」'}
              </div>
            )}
          </div>

          {/* Client detail */}
          {selectedClient && (
            <div className="flex-1 border-l border-bdr overflow-y-auto">
              <ClientDetail
                key={selectedClient.id}
                client={selectedClient}
                cats={cats}
                stages={stages}
                onClose={() => setSelectedId(null)}
                onDelete={async (id) => { await deleteClient(id); setSelectedId(null); }}
              />
            </div>
          )}
        </div>
      </div>

      {/* New client modal */}
      {showNewForm && (
        <NewClientModal
          cats={cats}
          stages={stages}
          onClose={() => setShowNewForm(false)}
          onCreate={handleNewClient}
        />
      )}
    </div>
  );
}

// ── SidebarItem ──────────────────────────────────────────────────────────────
function SidebarItem({ label, count, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-colors ${
        active ? 'bg-accent/10 text-accent font-medium' : 'text-ink-2 hover:bg-s3'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        {label}
      </span>
      <span className={`text-xs ${active ? 'text-accent' : 'text-ink-3'}`}>{count}</span>
    </button>
  );
}

// ── ClientRow ─────────────────────────────────────────────────────────────────
function ClientRow({ client, cats, stages, selected, onClick }) {
  const { thresholds } = useApp();
  const status = getClientStatus(client, thresholds);
  const cat = cats.find((c) => c.id === client.catId);
  const stage = stages.find((s) => s.id === client.stageId);

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-3 cursor-pointer border-b border-bdr/50 transition-colors relative ${
        selected ? 'bg-accent/8' : 'hover:bg-s2'
      }`}
      style={{ height: ITEM_HEIGHT }}
    >
      {/* Status bar */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r" style={{ background: STATUS_COLOR[status] }} />

      <div className="flex-1 min-w-0 pl-1">
        <div className="flex items-center gap-1.5">
          {client.pinned && <span className="text-xs">📌</span>}
          <span className="font-medium text-sm text-ink truncate">{client.name}</span>
          {client.missedCalls > 0 && (
            <span className={`text-xs px-1 rounded ${client.missedCalls >= 5 ? 'bg-danger/15 text-danger' : 'bg-s3 text-ink-2'}`}>
              📵{client.missedCalls}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-ink-3 truncate">{client.phone || '—'}</span>
          {cat && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: CAT_COLORS[cat.colorIdx % CAT_COLORS.length] + '20', color: CAT_COLORS[cat.colorIdx % CAT_COLORS.length] }}
            >
              {cat.name}
            </span>
          )}
          {client.industry && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: '#9a9a6f20', color: '#9a9a6f' }}>
              {client.industry}
            </span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-xs font-medium" style={{ color: STATUS_COLOR[status] }}>
          {STATUS_LABEL[status]}
        </div>
        <div className="text-[10px] text-ink-3 mt-0.5">
          {client.nextDate ? formatDate(client.nextDate) : '未設追蹤'}
        </div>
      </div>
    </div>
  );
}

// ── NewClientModal ────────────────────────────────────────────────────────────
function NewClientModal({ cats, stages, onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '', phone: '', lineId: '', clientType: 'personal', industry: '',
    catId: cats[0]?.id || '', stageId: stages[0]?.id || '',
    intentLevel: 0, notes: '', nextDate: addDays(today(), 7),
  });

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await onCreate(form);
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-sm p-5 anim-scale-in z-50">
          <h3 className="font-bold text-lg text-ink mb-4">新增客戶</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="姓名 / 公司名 *" className="w-full" required />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.clientType} onChange={(e) => set('clientType', e.target.value)} className="w-full">
                <option value="personal">👤 個人戶</option>
                <option value="company">🏢 公司戶</option>
              </select>
              <input
                list="industry-options-new"
                value={form.industry}
                onChange={(e) => set('industry', e.target.value)}
                placeholder="產業"
                className="w-full"
              />
              <datalist id="industry-options-new">
                {INDUSTRY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="電話" className="w-full" />
            <input value={form.lineId} onChange={(e) => set('lineId', e.target.value)} placeholder="LINE ID" className="w-full" />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.catId} onChange={(e) => set('catId', e.target.value)} className="w-full">
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={form.stageId} onChange={(e) => set('stageId', e.target.value)} className="w-full">
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              下次追蹤：
              <input type="date" value={form.nextDate} onChange={(e) => set('nextDate', e.target.value)} className="flex-1" />
            </label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="備註" rows={2} className="w-full resize-none" />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-outline flex-1">取消</button>
              <button type="submit" className="btn-primary flex-1">新增</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
