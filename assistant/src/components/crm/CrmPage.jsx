import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../../context';
import { STORAGE_KEYS } from '../../storageKeys';
import {
  getClientStatus, clientMatchesFilter, sortClients,
  CAT_COLORS, STATUS_COLOR, STATUS_LABEL, CUSTOMER_KIND_LABEL,
  generateId, findDuplicateClient, getClientCustomerKind,
} from '../../utils/crm';
import { today, formatDate, formatDateFull, addDays, QUICK_DATES } from '../../utils/date';
import ClientDetail from './ClientDetail';
import { Field } from '../ui';
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

export default function CrmPage({ focusId, focusIntent, onFocusConsumed, onFocusIntentConsumed, startNewToken, onStartConsumed, onOpenCase, onCreateCase }) {
  const { clients, cases, cats, stages, industries, thresholds, saveClient, updateClient, deleteClient, deleteClients } = useApp();
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState('createdAt');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [focusDetail, setFocusDetail] = useState(false); // 桌面：收合側欄＋列表，只看客戶詳情
  const [showNewForm, setShowNewForm] = useState(false);
  const listRef = useRef(null);

  // 檢視模式：列表 / 客戶類型看板（手機與桌面皆可使用）
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.crmView) === 'board' ? 'board' : 'list'; } catch { return 'list'; }
  });
  const effectiveView = view === 'board' ? 'board' : 'list';
  function changeView(v) {
    setView(v);
    if (v === 'board') setSelectedId(null);
    try { localStorage.setItem(STORAGE_KEYS.crmView, v); } catch { /* noop */ }
  }

  // 批次選取模式（清理老舊名單用）
  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  function exitSelectMode() {
    setSelectMode(false);
    setCheckedIds(new Set());
    setConfirmBatchDelete(false);
  }

  function toggleChecked(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // 從「今日工作」頁跳轉過來時，直接打開指定客戶
  useEffect(() => {
    if (focusId) {
      setSelectedId(focusId);
      onFocusConsumed?.();
    }
  }, [focusId, onFocusConsumed]);

  useEffect(() => {
    if (startNewToken) {
      setShowNewForm(true);
      onStartConsumed?.();
    }
  }, [startNewToken, onStartConsumed]);

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

  // 產業篩選清單：設定的選項＋客戶資料裡已存在的（涵蓋早期自由填寫的值）
  const industryCounts = useMemo(() => {
    const map = {};
    clients.forEach((c) => {
      if (c.industry) map[c.industry] = (map[c.industry] || 0) + 1;
    });
    return map;
  }, [clients]);

  const industryList = useMemo(() => {
    const set = new Set(industries);
    Object.keys(industryCounts).forEach((name) => set.add(name));
    return [...set];
  }, [industries, industryCounts]);

  const pendingCount = useMemo(() => clients.filter((c) => {
    const nd = c.nextDate ? dayjs(c.nextDate) : null;
    return nd && !nd.isAfter(dayjs(), 'day');
  }).length, [clients]);

  const coldCount = useMemo(() => clients.filter((c) => {
    const s = getClientStatus(c, thresholds);
    return s === 'cold' || s === 'hot';
  }).length, [clients, thresholds]);

  function handleSelect(id) {
    if (selectMode) { toggleChecked(id); return; }
    setSelectedId(id);
    setShowSidebar(false);
  }

  // 全選＝目前篩選＋搜尋結果的全部（先篩「久未聯繫」再全選，最適合清理老名單）
  const allChecked = filteredSorted.length > 0 && filteredSorted.every((c) => checkedIds.has(c.id));
  function toggleCheckAll() {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(filteredSorted.map((c) => c.id)));
  }

  async function handleBatchDelete() {
    const ids = [...checkedIds];
    if (ids.length === 0) return;
    if (ids.includes(selectedId)) setSelectedId(null);
    await deleteClients(ids);
    exitSelectMode();
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
        ${focusDetail ? '' : 'lg:static lg:translate-x-0 lg:z-auto lg:h-full'}
        ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Mobile close */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-bdr">
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
              { key: 'cold', label: '久未聯繫', count: coldCount, color: STATUS_COLOR.cold },
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
            <p className="section-title">客戶階段</p>
            {[...stages].sort((a, b) => a.order - b.order).map((stage) => (
              <SidebarItem key={stage.id} active={filter === `stage:${stage.id}`}
                color={CAT_COLORS[stage.colorIdx % CAT_COLORS.length]}
                label={stage.name} count={stageCounts[stage.id] || 0}
                onClick={() => { setFilter(`stage:${stage.id}`); setShowSidebar(false); }} />
            ))}
          </div>

          {/* Industries（選項可在設定 → 🏭 產業選項管理） */}
          {industryList.length > 0 && (
            <div>
              <p className="section-title">產業</p>
              {industryList.map((name) => (
                <SidebarItem key={name} active={filter === `ind:${name}`}
                  color="#9a9a6f"
                  label={name} count={industryCounts[name] || 0}
                  onClick={() => { setFilter(`ind:${name}`); setShowSidebar(false); }} />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Overlay for mobile drawer */}
      {showSidebar && (
        <div className="lg:hidden fixed inset-0 bg-black/30 z-30" onClick={() => setShowSidebar(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-sage/25 bg-gradient-to-r from-sage/12 via-s1 to-s1 flex-wrap">
          <button onClick={() => setShowSidebar(true)} className={`btn-ghost text-sm ${focusDetail ? '' : 'lg:hidden'}`}>☰</button>
          {selectMode ? (
            <>
              <button onClick={toggleCheckAll} className="btn-outline text-sm">
                {allChecked ? '取消全選' : '全選'}
              </button>
              <span className="text-sm text-ink-2">已選 <strong className="text-ink">{checkedIds.size}</strong> 筆</span>
              <div className="flex-1" />
              <button
                onClick={() => setConfirmBatchDelete(true)}
                disabled={checkedIds.size === 0}
                className="btn-danger text-sm disabled:opacity-40"
              >
                🗑 刪除
              </button>
              <button onClick={exitSelectMode} className="btn-ghost text-sm">取消</button>
            </>
          ) : (
            <>
              {/* 收合/展開：隱藏側欄＋列表放大客戶詳情，再點彈回（平板橫向、電腦；平板直向兩欄時也可用） */}
              {effectiveView === 'list' && selectedClient && (
                <button onClick={() => setFocusDetail((v) => !v)}
                  className="hidden md:inline-flex btn-primary text-sm shrink-0"
                  title={focusDetail ? '展開分類與客戶列表' : '收合側欄與列表，放大客戶詳情'}>
                  {focusDetail ? '◨ 展開列表' : '⤢ 放大詳情'}
                </button>
              )}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋客戶…"
                className="flex-1 min-w-0 text-sm max-w-xs"
              />
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="text-xs py-1">
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="flex rounded-lg border border-bdr overflow-hidden shrink-0">
                {[{ v: 'list', label: '☰ 列表' }, { v: 'board', label: '▦ 客戶類型' }].map(({ v, label }) => (
                  <button
                    key={v}
                    onClick={() => changeView(v)}
                    className={`px-2.5 py-1 text-xs transition-colors ${
                      view === v ? 'bg-accent text-on-accent font-medium' : 'text-ink-2 hover:bg-s2'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {effectiveView === 'list' && (
                <button onClick={() => { setSelectMode(true); setSelectedId(null); setFocusDetail(false); }} className="hidden md:inline-flex btn-outline text-sm">
                  ☑ 選取
                </button>
              )}
              <button onClick={() => setShowNewForm(true)} className="btn-primary text-sm">+ 新增</button>
              <span className="hidden sm:inline text-xs text-ink-3 shrink-0">{filteredSorted.length} 筆</span>
            </>
          )}
        </div>

        {effectiveView === 'board' ? (
          /* 客戶類型看板：手機可點按分類，桌面也可拖曳 */
          <BoardView
            clients={filteredSorted}
            cases={cases}
            cats={cats}
            thresholds={thresholds}
            onSelect={handleSelect}
            onSetCustomerKind={(id, customerKind) => updateClient(id, (c) => ({ ...c, customerKind }))}
          />
        ) : (
          /* List + Detail side by side on desktop */
          <div className="flex flex-1 min-h-0">
            {/* Client list */}
            <div
              ref={listRef}
              className={`overflow-y-auto ${selectedClient ? (focusDetail ? 'hidden' : 'hidden md:block md:w-64 xl:w-96') : 'flex-1'}`}
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
                      selectMode={selectMode}
                      checked={checkedIds.has(client.id)}
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
            {selectedClient && !selectMode && (
              <div className="flex-1 border-l border-bdr overflow-y-auto">
                <ClientDetail
                  key={selectedClient.id}
                  client={selectedClient}
                  cats={cats}
                  stages={stages}
                  initialIntent={focusIntent}
                  onIntentConsumed={onFocusIntentConsumed}
                  onClose={() => { setSelectedId(null); setFocusDetail(false); }}
                  onDelete={async (id) => { await deleteClient(id); setSelectedId(null); setFocusDetail(false); }}
                  onOpenCase={onOpenCase}
                  onCreateCase={onCreateCase}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 看板模式的客戶詳情：右側抽屜 */}
      {effectiveView === 'board' && selectedClient && (
        <>
          <div className="overlay" onClick={() => setSelectedId(null)} />
          <div className="safe-panel fixed inset-y-0 right-0 w-full max-w-xl bg-s1 border-l border-bdr z-50 overflow-y-auto shadow-panel anim-fade-in">
            <ClientDetail
              key={selectedClient.id}
              client={selectedClient}
              cats={cats}
              stages={stages}
              initialIntent={focusIntent}
              onIntentConsumed={onFocusIntentConsumed}
              onClose={() => setSelectedId(null)}
              onDelete={async (id) => { await deleteClient(id); setSelectedId(null); }}
              onOpenCase={onOpenCase}
              onCreateCase={onCreateCase}
            />
          </div>
        </>
      )}

      {/* 批次刪除確認 */}
      {confirmBatchDelete && (
        <>
          <div className="overlay" onClick={() => setConfirmBatchDelete(false)} />
          <div className="modal">
            <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-sm p-5 anim-scale-in z-50">
              <div className="text-3xl text-center mb-2">🗑</div>
              <h3 className="font-bold text-lg text-ink text-center mb-2">批次刪除客戶</h3>
              <p className="text-sm text-ink-2 text-center mb-1">
                確定要刪除 <strong className="text-danger">{checkedIds.size}</strong> 筆客戶資料嗎？
              </p>
              <p className="text-xs text-ink-3 text-center mb-5">
                包含其聯繫紀錄與時間軸，刪除後無法復原（會同步到所有裝置）
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmBatchDelete(false)} className="btn-outline flex-1">取消</button>
                <button onClick={handleBatchDelete} className="btn-danger flex-1">確認刪除</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* New client modal */}
      {showNewForm && (
        <NewClientModal
          cats={cats}
          stages={stages}
          industries={industryList}
          clients={clients}
          onClose={() => setShowNewForm(false)}
          onCreate={handleNewClient}
          onOpenExisting={(id) => { setShowNewForm(false); handleSelect(id); }}
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
function ClientRow({ client, cats, stages, selected, selectMode, checked, onClick }) {
  const { thresholds } = useApp();
  const status = getClientStatus(client, thresholds);
  const cat = cats.find((c) => c.id === client.catId);
  const stage = stages.find((s) => s.id === client.stageId);

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-3 cursor-pointer border-b border-bdr/50 transition-colors relative ${
        selected || checked ? 'bg-accent/8' : 'hover:bg-s2'
      }`}
      style={{ height: ITEM_HEIGHT }}
    >
      {/* Status bar */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r" style={{ background: STATUS_COLOR[status] }} />

      {/* 批次選取 checkbox */}
      {selectMode && (
        <input
          type="checkbox"
          checked={!!checked}
          readOnly
          className="w-4 h-4 shrink-0 ml-1 accent-[#7291a8] pointer-events-none"
        />
      )}

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

// ── BoardView（看板：依買車／改裝客戶分欄）──────────────────────────────────
function BoardView({ clients, cases, cats, thresholds, onSelect, onSetCustomerKind }) {
  const [dragId, setDragId] = useState(null);
  const [overKind, setOverKind] = useState(null);

  const casesByClient = useMemo(() => {
    const map = new Map();
    for (const item of cases || []) {
      if (item.deletedAt || !item.clientId) continue;
      const list = map.get(item.clientId) || [];
      list.push(item);
      map.set(item.clientId, list);
    }
    for (const list of map.values()) list.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    return map;
  }, [cases]);

  const byKind = useMemo(() => {
    const map = { modification: [], purchase: [], both: [], unclassified: [] };
    for (const client of clients) map[getClientCustomerKind(client, cases)].push(client);
    return map;
  }, [clients, cases]);

  const columns = [
    { id: 'modification', label: '改裝客戶', icon: '🛠️', color: '#9382a5' },
    { id: 'purchase', label: '買車客戶', icon: '🚚', color: '#6f9a9c' },
    ...(byKind.both.length ? [{ id: 'both', label: '買車＋改裝', icon: '↔', color: '#bf8a5e' }] : []),
    ...(byKind.unclassified.length ? [{ id: 'unclassified', label: '待分類', icon: '?', color: '#8a919b' }] : []),
  ];

  function handleDrop(customerKind) {
    if (dragId && (customerKind === 'purchase' || customerKind === 'modification')) onSetCustomerKind(dragId, customerKind);
    setDragId(null);
    setOverKind(null);
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-bdr bg-s2/45 px-3 py-2">
        <p className="text-xs font-bold text-ink">客戶類型看板</p>
        <p className="mt-0.5 text-[11px] text-ink-3">直接按卡片下方的「改裝／買車」；桌面也能拖曳換欄。</p>
      </div>
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-3 h-full min-w-max">
        {columns.map((column) => {
          const list = byKind[column.id] || [];
          const acceptsDrop = column.id === 'purchase' || column.id === 'modification';
          const isOver = overKind === column.id;
          return (
            <div
              key={column.id}
              onDragOver={acceptsDrop ? (e) => { e.preventDefault(); setOverKind(column.id); } : undefined}
              onDragLeave={acceptsDrop ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverKind(null); } : undefined}
              onDrop={acceptsDrop ? (e) => { e.preventDefault(); handleDrop(column.id); } : undefined}
              className={`w-[84vw] max-w-72 md:w-72 shrink-0 flex flex-col rounded-xl border transition-colors ${
                isOver ? 'border-accent bg-accent/5' : 'border-bdr bg-s1'
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-bdr/60 shrink-0">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg text-sm" style={{ background: `${column.color}22`, color: column.color }}>{column.icon}</span>
                <span className="font-semibold text-sm text-ink flex-1 truncate">{column.label}</span>
                <span className="text-xs text-ink-3 bg-s2 rounded-full px-1.5 py-0.5">{list.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {list.map((client) => (
                  <BoardCard
                    key={client.id}
                    client={client}
                    customerKind={column.id}
                    clientCases={casesByClient.get(client.id) || []}
                    cats={cats}
                    thresholds={thresholds}
                    dragging={dragId === client.id}
                    onDragStart={() => setDragId(client.id)}
                    onDragEnd={() => { setDragId(null); setOverKind(null); }}
                    onClick={() => onSelect(client.id)}
                    onSetCustomerKind={(kind) => onSetCustomerKind(client.id, kind)}
                  />
                ))}
                {list.length === 0 && (
                  <div className={`text-center text-xs py-6 rounded-lg border border-dashed ${
                    isOver ? 'border-accent text-accent' : 'border-bdr/60 text-ink-3'
                  }`}>
                    {isOver ? `放開以改成${CUSTOMER_KIND_LABEL[column.id]}` : '目前沒有客戶'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function BoardCard({ client, customerKind, clientCases, cats, thresholds, dragging, onDragStart, onDragEnd, onClick, onSetCustomerKind }) {
  const status = getClientStatus(client, thresholds);
  const cat = cats.find((c) => c.id === client.catId);
  const latestCase = clientCases[0];
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`bg-s2 rounded-lg p-2.5 cursor-pointer border border-bdr/50 hover:border-accent/50 transition-all relative ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r" style={{ background: STATUS_COLOR[status] }} />
      <div className="pl-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {client.pinned && <span className="text-[10px]">📌</span>}
          <span className="font-medium text-sm text-ink truncate">{client.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[11px] text-ink-3">{client.phone || '—'}</span>
          {cat && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: CAT_COLORS[cat.colorIdx % CAT_COLORS.length] + '20', color: CAT_COLORS[cat.colorIdx % CAT_COLORS.length] }}
            >
              {cat.name}
            </span>
          )}
          {latestCase?.caseNumber != null && <span className="badge bg-s1 font-mono text-[10px] text-ink-2">#{latestCase.caseNumber}{clientCases.length > 1 ? ` ＋${clientCases.length - 1}` : ''}</span>}
        </div>
        {latestCase && <p className="mt-1.5 truncate text-[11px] text-ink-2">{latestCase.title || CUSTOMER_KIND_LABEL[customerKind]}</p>}
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] font-medium" style={{ color: STATUS_COLOR[status] }}>
            {STATUS_LABEL[status]}
          </span>
          <span className="text-[10px] text-ink-3">
            {client.nextDate ? formatDate(client.nextDate) : '未設追蹤'}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-bdr/60 pt-2">
          {[['modification', '🛠 改裝'], ['purchase', '🚚 買車']].map(([kind, label]) => (
            <button key={kind} type="button" onClick={(event) => { event.stopPropagation(); onSetCustomerKind(kind); }}
              className={`min-h-11 rounded-lg border text-[11px] font-bold ${customerKind === kind ? 'border-accent bg-accent/12 text-accent' : 'border-bdr bg-s1 text-ink-2'}`}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── NewClientModal ────────────────────────────────────────────────────────────
function NewClientModal({ cats, stages, industries, clients, onClose, onCreate, onOpenExisting }) {
  const [form, setForm] = useState({
    name: '', phone: '', lineId: '', clientType: 'personal', industry: '',
    catId: cats[0]?.id || '', stageId: stages[0]?.id || '',
    customerKind: '', intentLevel: 0, notes: '', nextDate: addDays(today(), 7),
  });

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  // 重複偵測：同電話（優先）或同姓名，即時提示避免名單重複
  const dup = useMemo(
    () => findDuplicateClient(clients || [], { name: form.name, phone: form.phone }),
    [clients, form.name, form.phone]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.customerKind) return;
    await onCreate(form);
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-sm p-5 anim-scale-in z-50">
          <h3 className="font-bold text-lg text-ink mb-4">新增客戶</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="姓名 / 公司名" required>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例：陳頭家 / 大發水電行" className="w-full" required />
            </Field>
            <Field label="業務類型" required>
              <div className="grid grid-cols-2 gap-2">
                {[['modification', '🛠 改裝客戶'], ['purchase', '🚚 買車客戶']].map(([kind, label]) => (
                  <button key={kind} type="button" onClick={() => set('customerKind', kind)}
                    className={`min-h-12 rounded-xl border text-sm font-bold ${form.customerKind === kind ? 'border-accent bg-accent/12 text-accent' : 'border-bdr text-ink-2'}`}>{label}</button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="客戶類型">
                <select value={form.clientType} onChange={(e) => set('clientType', e.target.value)} className="w-full">
                  <option value="personal">👤 個人戶</option>
                  <option value="company">🏢 公司戶</option>
                </select>
              </Field>
              <Field label="產業">
                <select
                  value={form.industry}
                  onChange={(e) => set('industry', e.target.value)}
                  className="w-full"
                >
                  <option value="">未指定</option>
                  {industries.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="電話">
                <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0912-345-678" className="w-full" />
              </Field>
              <Field label="LINE ID">
                <input value={form.lineId} onChange={(e) => set('lineId', e.target.value)} className="w-full" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="客戶分類">
                <select value={form.catId} onChange={(e) => set('catId', e.target.value)} className="w-full">
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="客戶階段">
                <select value={form.stageId} onChange={(e) => set('stageId', e.target.value)} className="w-full">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="下次追蹤日期">
              <input type="date" value={form.nextDate} onChange={(e) => set('nextDate', e.target.value)} className="w-full" />
            </Field>
            <Field label="備註">
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="需求、預算、注意事項…" rows={2} className="w-full resize-none" />
            </Field>
            {dup && (
              <div className="bg-warn/10 border border-warn/40 rounded-lg px-3 py-2 flex items-center gap-2"
                style={{ background: '#bf8a5e18', borderColor: '#bf8a5e66' }}>
                <span className="text-sm shrink-0">⚠️</span>
                <span className="flex-1 text-xs" style={{ color: '#a9744b' }}>
                  已有{dup.reason === 'phone' ? '相同電話' : '同名'}客戶「{dup.client.name}」
                  {dup.client.phone ? `（${dup.client.phone}）` : ''}，可能重複。
                </span>
                {onOpenExisting && (
                  <button type="button" onClick={() => onOpenExisting(dup.client.id)}
                    className="btn-outline text-[10px] px-2 py-1 shrink-0">開啟現有</button>
                )}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-outline flex-1">取消</button>
              <button type="submit" disabled={!form.name.trim() || !form.customerKind} className="btn-primary flex-1 disabled:opacity-40">{dup ? '仍要新增' : '新增'}</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
