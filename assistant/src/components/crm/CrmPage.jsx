import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../../context';
import { STORAGE_KEYS } from '../../storageKeys';
import {
  getClientStatus, clientMatchesFilter, sortClients,
  CAT_COLORS, STATUS_COLOR, STATUS_LABEL,
  generateId, findDuplicateClient,
} from '../../utils/crm';
import { advanceCasePipeline, buildWorkQueue, CASE_PIPELINE_STAGES, CASE_TYPE_LABEL, getCasePipelineElapsedDays, getCasePipelineStageId, getCasePipelineUpdatedAt, getCaseTotalElapsedDays } from '../../utils/cases';
import { today, formatDate, formatDateFull, addDays, QUICK_DATES } from '../../utils/date';
import ClientDetail from './ClientDetail';
import { Field } from '../ui';
import dayjs from 'dayjs';
import { stockAlert } from '../../utils/stock';

const SORT_OPTIONS = [
  { value: 'createdAt', label: '建立時間' },
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
  const { clients, cases, deals, quoteDrafts, workItems, tasks, cats, stages, industries, thresholds, saveClient, updateClient, deleteClient, deleteClients, saveCase } = useApp();
  const caseWorkQueue = useMemo(
    () => buildWorkQueue({ workItems, tasks, clients, deals, cases })
      .filter((row) => row.caseId && row.sourceType !== 'case-follow-up'),
    [workItems, tasks, clients, deals, cases],
  );
  const filter = 'all';
  const [sortKey, setSortKey] = useState('createdAt');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
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
      const matchingClientIds = new Set(cases.filter((item) =>
        item.title?.toLowerCase().includes(q) || item.clientName?.toLowerCase().includes(q)
      ).map((item) => item.clientId));
      list = list.filter((c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.lineId?.toLowerCase().includes(q) ||
        c.notes?.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q) ||
        c.taxId?.toLowerCase().includes(q) ||
        matchingClientIds.has(c.id) ||
        (c.contacts || []).some((ct) =>
          ct.name?.toLowerCase().includes(q) || ct.phone?.toLowerCase().includes(q)
        )
      );
    }
    return sortClients(list, sortKey);
  }, [clients, cases, filter, sortKey, search, thresholds]);

  const { visibleItems, totalHeight, offsetY } = useVirtualList(filteredSorted, listRef);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedId) || null,
    [clients, selectedId]
  );

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

  function handleSelect(id) {
    if (selectMode) { toggleChecked(id); return; }
    setSelectedId(id);
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
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-sage/25 bg-gradient-to-r from-sage/12 via-s1 to-s1 flex-wrap">
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
                  title={focusDetail ? '展開客戶列表' : '收合客戶列表，放大客戶詳情'}>
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
                {[{ v: 'list', label: '☰ 客戶' }, { v: 'board', label: '▦ 案件流程' }].map(({ v, label }) => (
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
          /* 案件流程看板：類型是標籤，欄位只表示案件進度 */
          <BoardView
            clients={filteredSorted}
            cases={cases}
            deals={deals}
            quotes={quoteDrafts}
            workQueue={caseWorkQueue}
            onOpenCase={onOpenCase}
            onSaveCase={saveCase}
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
                      cases={cases.filter((item) => item.clientId === client.id && !item.deletedAt)}
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

// ── ClientRow ─────────────────────────────────────────────────────────────────
function ClientRow({ client, cats, cases = [], selected, selectMode, checked, onClick }) {
  const cat = cats.find((c) => c.id === client.catId);
  const openCases = cases.filter((item) => item.status !== 'completed');
  const nextCase = [...openCases].filter((item) => item.nextFollowUpDate).sort((a, b) => a.nextFollowUpDate.localeCompare(b.nextFollowUpDate))[0];

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-3 cursor-pointer border-b border-bdr/50 transition-colors relative ${
        selected || checked ? 'bg-accent/8' : 'hover:bg-s2'
      }`}
      style={{ height: ITEM_HEIGHT }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r bg-teal" />

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
        <div className="text-xs font-medium text-teal">{openCases.length} 件進行中</div>
        <div className="text-[10px] text-ink-3 mt-0.5">
          {nextCase ? `${nextCase.title || CASE_TYPE_LABEL[nextCase.type]}・${formatDate(nextCase.nextFollowUpDate)}` : '沒有案件追蹤'}
        </div>
      </div>
    </div>
  );
}

// ── BoardView（看板：以案件流程分欄，買車／改裝只是標籤）──────────────────
function BoardView({ clients, cases, deals, quotes, workQueue, onOpenCase, onSaveCase }) {
  const defaultVisibleCount = 5;
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [mobileStage, setMobileStage] = useState('new');
  const pickedInitialMobileStage = useRef(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [pendingMove, setPendingMove] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [expandedStages, setExpandedStages] = useState(() => new Set());
  const [hideCompleted, setHideCompleted] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.hideCompletedCases) !== 'false'; } catch { return true; }
  });
  const allowedClientIds = useMemo(() => new Set(clients.map((client) => client.id)), [clients]);
  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const pendingByCase = useMemo(() => {
    const map = new Map();
    (workQueue || []).forEach((row) => {
      const list = map.get(row.caseId) || [];
      list.push(row);
      map.set(row.caseId, list);
    });
    return map;
  }, [workQueue]);
  const dealByCase = useMemo(() => new Map(deals.filter((deal) => !deal.caseArchivedAt && deal.caseId).map((deal) => [deal.caseId, deal])), [deals]);
  const visibleCases = useMemo(() => (cases || [])
    .filter((item) => !item.deletedAt && allowedClientIds.has(item.clientId))
    .filter((item) => typeFilter === 'all' || item.type === typeFilter),
  [cases, allowedClientIds, typeFilter]);
  const byStage = useMemo(() => {
    const map = Object.fromEntries(CASE_PIPELINE_STAGES.map((stage) => [stage.id, []]));
    for (const item of visibleCases) map[getCasePipelineStageId(item, { deals, quotes })].push(item);
    Object.entries(map).forEach(([stageId, list]) => list.sort((a, b) => (
      (stageId !== 'completed' ? Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) : 0)
      || (stageId !== 'completed' ? String(a.desiredDeliveryDate || '9999-12-31').localeCompare(String(b.desiredDeliveryDate || '9999-12-31')) : 0)
      ||
      String(getCasePipelineUpdatedAt(b, { deals, quotes })).localeCompare(String(getCasePipelineUpdatedAt(a, { deals, quotes })))
      || String(a.clientName || '').localeCompare(String(b.clientName || ''), 'zh-Hant')
    )));
    return map;
  }, [visibleCases, deals, quotes]);
  const displayedStages = hideCompleted ? CASE_PIPELINE_STAGES.filter((stage) => stage.id !== 'completed') : CASE_PIPELINE_STAGES;

  function toggleCompletedVisibility() {
    setHideCompleted((previous) => {
      const next = !previous;
      try { localStorage.setItem(STORAGE_KEYS.hideCompletedCases, String(next)); } catch { /* noop */ }
      if (next && mobileStage === 'completed') setMobileStage('new');
      return next;
    });
  }

  function toggleStageExpanded(stageId) {
    setExpandedStages((previous) => {
      const next = new Set(previous);
      if (next.has(stageId)) next.delete(stageId); else next.add(stageId);
      return next;
    });
  }

  useEffect(() => {
    if (pickedInitialMobileStage.current) return;
    const firstStageWithCases = CASE_PIPELINE_STAGES.find((stage) => byStage[stage.id]?.length > 0);
    if (firstStageWithCases) setMobileStage(firstStageWithCases.id);
    pickedInitialMobileStage.current = true;
  }, [byStage]);

  function requestMove(item, stageId) {
    if (CASE_PIPELINE_STAGES.findIndex((stage) => stage.id === stageId) >= 2 && !deals.some((deal) => deal.id === item.dealId || deal.caseId === item.id)) {
      setSaveError('請先到報價單確認成交版本，再安排施工與交車。');
      return;
    }
    const from = getCasePipelineStageId(item, { deals, quotes });
    if (from !== stageId) setPendingMove({ item, from, to: stageId });
  }

  async function confirmMove() {
    if (!pendingMove) return;
    const { item, to } = pendingMove;
    setSaveError('');
    try {
      const timestamp = new Date().toISOString();
      await onSaveCase({
        ...advanceCasePipeline(item, to, timestamp),
        status: to === 'completed' ? 'completed' : 'active',
        nextFollowUpDate: to === 'completed' ? '' : item.nextFollowUpDate,
        updatedAt: timestamp,
      });
      setMobileStage(to);
      setPendingMove(null);
    } catch (cause) {
      setSaveError(cause?.message || '進度儲存失敗。');
    }
  }

  async function setCaseType(item, type) {
    if (item.type === type) return;
    setSaveError('');
    try {
      await onSaveCase({ ...item, type, updatedAt: new Date().toISOString() });
    } catch (cause) {
      setSaveError(cause?.message || '案件類型儲存失敗。');
    }
  }

  function handleDrop(stageId) {
    const item = visibleCases.find((row) => row.id === dragId);
    if (item) requestMove(item, stageId);
    setDragId(null);
    setOverStage(null);
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-bdr bg-s2/45 px-3 py-2 space-y-2">
        <div><p className="text-xs font-bold text-ink">案件流程</p><p className="mt-0.5 text-[11px] text-ink-3">每個案件的聯繫與追蹤日都獨立儲存。</p></div>
        <div className="flex gap-2 overflow-x-auto">
          {[['all', '全部'], ['purchase', '🚚 買車'], ['modification', '🛠 改裝']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTypeFilter(id)} className={`min-h-10 shrink-0 rounded-full border px-3 text-xs font-bold ${typeFilter === id ? (id === 'purchase' ? 'border-danger bg-danger text-white' : id === 'modification' ? 'border-warn bg-warn text-ink' : 'border-teal bg-teal text-white') : 'border-bdr bg-s1 text-ink-2'}`}>{label}</button>
          ))}
          <button type="button" onClick={toggleCompletedVisibility} className="min-h-10 shrink-0 rounded-full border border-bdr bg-s1 px-3 text-xs font-bold text-ink-2">{hideCompleted ? `顯示已完工 ${byStage.completed.length}` : '隱藏已完工'}</button>
        </div>
        <div className="flex gap-2 overflow-x-auto md:hidden">
          {displayedStages.map((stage) => <button key={stage.id} type="button" onClick={() => setMobileStage(stage.id)} className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-bold ${mobileStage === stage.id ? 'bg-copper text-on-accent' : 'bg-s1 text-ink-2 border border-bdr'}`}>{stage.label} {byStage[stage.id].length}</button>)}
        </div>
      </div>
      {saveError && <p role="alert" className="m-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{saveError}</p>}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="hidden md:flex gap-3 p-3 h-full min-w-max overflow-x-auto">
        {displayedStages.map((stage) => {
          const list = byStage[stage.id] || [];
          const isExpanded = expandedStages.has(stage.id);
          const displayedList = isExpanded ? list : list.slice(0, defaultVisibleCount);
          const isOver = overStage === stage.id;
          return (
            <div
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverStage(null); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(stage.id); }}
              className={`w-64 shrink-0 flex flex-col rounded-xl border transition-colors ${
                isOver ? 'border-accent bg-accent/5' : 'border-bdr bg-s1'
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-bdr/60 shrink-0">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-copper/12 text-xs font-bold text-copper">{CASE_PIPELINE_STAGES.findIndex((row) => row.id === stage.id) + 1}</span>
                <span className="font-semibold text-sm text-ink flex-1 truncate">{stage.label}</span>
                <span className="text-xs text-ink-3 bg-s2 rounded-full px-1.5 py-0.5">{list.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {displayedList.map((item) => (
                  <BoardCard
                    key={item.id} item={item} client={clientMap.get(item.clientId)}
                    stageUpdatedAt={getCasePipelineUpdatedAt(item, { deals, quotes })}
                    pendingItems={pendingByCase.get(item.id) || []}
                    deal={dealByCase.get(item.id)}
                    stageId={stage.id} dragging={dragId === item.id}
                    onDragStart={() => setDragId(item.id)} onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    onOpen={() => onOpenCase?.(item.id)} onMove={(to) => requestMove(item, to)}
                    onSetType={(type) => setCaseType(item, type)}
                  />
                ))}
                {list.length > defaultVisibleCount && <button type="button" onClick={() => toggleStageExpanded(stage.id)} className="min-h-11 w-full rounded-lg border border-bdr bg-s1 px-3 text-xs font-bold text-ink-2">{isExpanded ? `收合，只顯示最近 ${defaultVisibleCount} 筆` : `顯示其餘 ${list.length - defaultVisibleCount} 筆`}</button>}
                {list.length === 0 && (
                  <div className={`text-center text-xs py-6 rounded-lg border border-dashed ${
                    isOver ? 'border-accent text-accent' : 'border-bdr/60 text-ink-3'
                  }`}>
                    {isOver ? `放開以移到${stage.label}` : '目前沒有案件'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </div>
        <div className="h-full overflow-y-auto p-3 md:hidden">
          <div className="space-y-3">
            {(expandedStages.has(mobileStage) ? byStage[mobileStage] : byStage[mobileStage].slice(0, defaultVisibleCount)).map((item) => <BoardCard key={item.id} item={item} client={clientMap.get(item.clientId)} stageId={mobileStage} stageUpdatedAt={getCasePipelineUpdatedAt(item, { deals, quotes })} pendingItems={pendingByCase.get(item.id) || []} deal={dealByCase.get(item.id)} onOpen={() => onOpenCase?.(item.id)} onMove={(to) => requestMove(item, to)} onSetType={(type) => setCaseType(item, type)} />)}
            {byStage[mobileStage].length > defaultVisibleCount && <button type="button" onClick={() => toggleStageExpanded(mobileStage)} className="min-h-12 w-full rounded-xl border border-bdr bg-s1 px-3 text-sm font-bold text-ink-2">{expandedStages.has(mobileStage) ? `收合，只顯示最近 ${defaultVisibleCount} 筆` : `顯示其餘 ${byStage[mobileStage].length - defaultVisibleCount} 筆`}</button>}
            {byStage[mobileStage].length === 0 && <div className="rounded-2xl border border-dashed border-bdr py-12 text-center text-sm text-ink-3">目前沒有案件</div>}
          </div>
        </div>
      </div>
      {pendingMove && <><div className="overlay" onClick={() => setPendingMove(null)} /><div className="modal"><div className="z-50 w-full max-w-sm rounded-2xl border border-bdr bg-s1 p-5 shadow-panel"><p className="text-xs font-bold text-copper">確認案件進度</p><h3 className="mt-1 text-lg font-bold text-ink">{pendingMove.item.clientName}・{pendingMove.item.title}</h3><p className="mt-3 text-sm text-ink-2">{CASE_PIPELINE_STAGES.find((stage) => stage.id === pendingMove.from)?.label} → <strong>{CASE_PIPELINE_STAGES.find((stage) => stage.id === pendingMove.to)?.label}</strong></p><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => setPendingMove(null)} className="btn-outline min-h-12">取消</button><button type="button" onClick={confirmMove} className="btn-primary min-h-12">確認變更</button></div></div></div></>}
    </div>
  );
}

function BoardCard({ item, client, stageId, stageUpdatedAt, pendingItems = [], deal, dragging, onDragStart, onDragEnd, onOpen, onMove, onSetType }) {
  const stageIndex = CASE_PIPELINE_STAGES.findIndex((stage) => stage.id === stageId);
  const nextStage = CASE_PIPELINE_STAGES[stageIndex + 1];
  const followUpDiff = item.nextFollowUpDate ? dayjs(item.nextFollowUpDate).startOf('day').diff(dayjs().startOf('day'), 'day') : null;
  const stageDays = getCasePipelineElapsedDays({ ...item, pipelineStageUpdatedAt: stageUpdatedAt });
  const totalDays = getCaseTotalElapsedDays({ ...item, pipelineStageUpdatedAt: stageUpdatedAt });
  const stock = stockAlert(deal, item);
  return (
    <article
      draggable={Boolean(onDragStart)}
      onDragStart={(e) => { if (!onDragStart) return; e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      className={`bg-s2 rounded-xl p-3 border border-bdr/60 border-l-4 ${item.type === 'purchase' ? 'border-l-danger' : 'border-l-warn'} hover:border-accent/50 transition-all ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-bold text-ink">{item.clientName || client?.name || '未命名客戶'}</p><p className="mt-1 truncate text-sm text-ink-2">{item.title || '未命名案件'}</p></div><span className="text-ink-3">›</span></div>
      </button>
      {stageId === 'completed' && stageUpdatedAt && <p className="mt-2 inline-flex rounded-full bg-ok/15 px-2 py-1 text-[10px] font-bold text-ok">{dayjs(stageUpdatedAt).format('YYYY 年 MM 月')}交車</p>}
      {(item.urgent || item.desiredDeliveryDate || deal?.quoteId) && <p className={`mt-2 text-[11px] font-bold ${stock.deliveryRisk ? 'text-danger' : 'text-copper'}`}>{item.urgent ? '🔴 急件・' : ''}{item.desiredDeliveryDate ? `希望 ${dayjs(item.desiredDeliveryDate).format('MM/DD')} 交車・` : ''}{deal?.quoteId ? `備品尚缺 ${stock.missing} 項` : '成交配件待核對'}</p>}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
          {[['modification', '🛠 改裝'], ['purchase', '🚚 買車']].map(([kind, label]) => (
            <button key={kind} type="button" onClick={() => onSetType(kind)} className={`min-h-10 rounded-lg border text-[11px] font-bold ${item.type === kind ? (kind === 'purchase' ? 'border-danger bg-danger text-white' : 'border-warn bg-warn text-ink') : 'border-bdr bg-s1 text-ink-3'}`}>{label}</button>
          ))}
      </div>
      <div className="mt-2 rounded-lg bg-s1 px-2.5 py-2 text-[11px]">
        <p className="text-ink-3">最近聯繫：{item.lastContactAt ? dayjs(item.lastContactAt).format('YYYY/MM/DD') : '尚未聯繫'}</p>
        <p className={`mt-1 font-semibold ${followUpDiff != null && followUpDiff < 0 ? 'text-danger' : 'text-copper'}`}>下次追蹤：{item.nextFollowUpDate ? dayjs(item.nextFollowUpDate).format('YYYY/MM/DD') : stageId === 'completed' ? '已完成' : '尚未設定'}</p>
        <p className="mt-1 font-semibold text-ink-2">目前階段：{stageUpdatedAt && dayjs(stageUpdatedAt).isValid() ? `${dayjs(stageUpdatedAt).format('YYYY/MM/DD')} 進入・第 ${stageDays} 天` : '尚無紀錄'}</p>
        <p className="mt-1 text-ink-3">案件總計：{totalDays ? `${totalDays} 天` : '尚無紀錄'}</p>
      </div>
      {pendingItems.length > 0 && (
        <button type="button" onClick={onOpen} className="mt-2 w-full rounded-lg border border-copper/35 bg-copper/10 px-2.5 py-2 text-left">
          <span className="flex items-center justify-between gap-2 text-[11px] font-bold text-copper">
            <span>尚未處理</span>
            <span>{pendingItems.length} 項</span>
          </span>
          <span className="mt-1.5 block space-y-1">
            {pendingItems.slice(0, 2).map((row) => (
              <span key={row.id} className="flex items-start gap-1.5 text-[11px] font-semibold text-ink-2">
                <span aria-hidden="true">•</span><span className="line-clamp-1">{row.title}</span>
              </span>
            ))}
            {pendingItems.length > 2 && <span className="block text-[10px] font-semibold text-ink-3">另有 {pendingItems.length - 2} 項，開啟案件查看</span>}
          </span>
        </button>
      )}
      <div className="mt-2 flex gap-2"><button type="button" onClick={onOpen} className="btn-outline min-h-10 flex-1 text-xs">開啟案件</button>{nextStage && <button type="button" onClick={() => onMove(nextStage.id)} className="btn-primary min-h-10 flex-1 text-xs">下一階段 →</button>}</div>
    </article>
  );
}

// ── NewClientModal ────────────────────────────────────────────────────────────
function NewClientModal({ cats, stages, industries, clients, onClose, onCreate, onOpenExisting }) {
  const [form, setForm] = useState({
    name: '', phone: '', lineId: '', clientType: 'personal', industry: '',
    catId: cats[0]?.id || '', stageId: stages[0]?.id || '', intentLevel: 0, notes: '',
  });

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  // 重複偵測：同電話（優先）或同姓名，即時提示避免名單重複
  const dup = useMemo(
    () => findDuplicateClient(clients || [], { name: form.name, phone: form.phone }),
    [clients, form.name, form.phone]
  );

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
            <Field label="姓名 / 公司名" required>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例：陳頭家 / 大發水電行" className="w-full" required />
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
            <Field label="客戶分類">
                <select value={form.catId} onChange={(e) => set('catId', e.target.value)} className="w-full">
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
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
              <button type="submit" disabled={!form.name.trim()} className="btn-primary flex-1 disabled:opacity-40">{dup ? '仍要新增' : '新增'}</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
