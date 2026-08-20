import {
  createContext, useContext, useReducer, useEffect, useCallback, useRef, useState,
} from 'react';
import { db, setOnBlocked } from './db';
import { startSync, setOnRemoteApplied } from './sync';
import {
  DEFAULT_THRESHOLDS, normalizeThresholds, DEFAULT_TODO_TEMPLATE, DEFAULT_QUOTE_PRESETS,
  resolveQuotePresets, INDUSTRY_SUGGESTIONS,
} from './utils/crm';
import { today } from './utils/date';
import dayjs from 'dayjs';
import { STORAGE_KEYS } from './storageKeys';

const AppContext = createContext(null);

const DEFAULT_CATS = [
  { id: 'cat-1', name: '一般客戶', colorIdx: 0, order: 0 },
  { id: 'cat-2', name: '潛在客戶', colorIdx: 1, order: 1 },
  { id: 'cat-3', name: '成交客戶', colorIdx: 2, order: 2 },
];

// 業績表預設金額欄位（成交金額為內建，這裡是額外欄位，可在設定自訂）
const DEFAULT_DEAL_FIELDS = [
  { id: 'dfield-1', name: '保險金額', colorIdx: 2, order: 0 },
  { id: 'dfield-2', name: '收入', colorIdx: 1, order: 1 },
];

// 貨車銷售固定管道：新名單 → 已聯絡 → 拜訪中 → 試乘 → 報價 → 議價 → 成交 → 交車 → 售後
const DEFAULT_STAGES = [
  { id: 'stage-1', name: '新名單', colorIdx: 6, order: 0 },
  { id: 'stage-2', name: '已聯絡', colorIdx: 5, order: 1 },
  { id: 'stage-3', name: '拜訪中', colorIdx: 2, order: 2 },
  { id: 'stage-4', name: '試乘', colorIdx: 3, order: 3 },
  { id: 'stage-5', name: '報價', colorIdx: 0, order: 4 },
  { id: 'stage-6', name: '議價', colorIdx: 4, order: 5 },
  { id: 'stage-7', name: '成交', colorIdx: 1, order: 6 },
  { id: 'stage-8', name: '交車', colorIdx: 1, order: 7 },
  { id: 'stage-9', name: '售後', colorIdx: 5, order: 8 },
];

const initialState = {
  loading: true,
  clients: [],
  cats: DEFAULT_CATS,
  stages: DEFAULT_STAGES,
  customFields: [],
  deals: [],
  dealFields: DEFAULT_DEAL_FIELDS,
  tasks: [],
  events: [],
  todoTemplate: DEFAULT_TODO_TEMPLATE,
  quotePresets: DEFAULT_QUOTE_PRESETS,
  industries: INDUSTRY_SUGGESTIONS,
  timers: [],
  thresholds: DEFAULT_THRESHOLDS,
  dbBlocked: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOAD_INIT':
      return {
        ...state,
        ...action.payload,
        loading: false,
      };

    // CRM
    case 'UPSERT_CLIENT': {
      const idx = state.clients.findIndex((c) => c.id === action.payload.id);
      const next = [...state.clients];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, clients: next };
    }
    case 'DELETE_CLIENT':
      return { ...state, clients: state.clients.filter((c) => c.id !== action.id) };
    case 'DELETE_CLIENTS': {
      const ids = new Set(action.ids);
      return { ...state, clients: state.clients.filter((c) => !ids.has(c.id)) };
    }
    case 'SET_CATS':
      return { ...state, cats: action.payload };
    case 'SET_STAGES':
      return { ...state, stages: action.payload };
    case 'SET_CUSTOM_FIELDS':
      return { ...state, customFields: action.payload };
    case 'SET_THRESHOLDS':
      return { ...state, thresholds: action.payload };
    case 'SET_DB_BLOCKED':
      return { ...state, dbBlocked: action.payload };

    // Deals（成交歸檔）
    case 'UPSERT_DEAL': {
      const idx = state.deals.findIndex((d) => d.id === action.payload.id);
      const next = [...state.deals];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, deals: next };
    }
    case 'DELETE_DEAL':
      return { ...state, deals: state.deals.filter((d) => d.id !== action.id) };
    case 'SET_DEAL_FIELDS':
      return { ...state, dealFields: action.payload };

    // Tasks（中央待辦）
    case 'UPSERT_TASK': {
      const idx = state.tasks.findIndex((t) => t.id === action.payload.id);
      const next = [...state.tasks];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, tasks: next };
    }
    case 'DELETE_TASK':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };

    // Events（行事曆活動：生日、紀念日、重要日子）
    case 'UPSERT_EVENT': {
      const idx = state.events.findIndex((e) => e.id === action.payload.id);
      const next = [...state.events];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, events: next };
    }
    case 'DELETE_EVENT':
      return { ...state, events: state.events.filter((e) => e.id !== action.id) };

    case 'SET_TODO_TEMPLATE':
      return { ...state, todoTemplate: action.payload };
    case 'SET_QUOTE_PRESETS':
      return { ...state, quotePresets: action.payload };
    case 'SET_INDUSTRIES':
      return { ...state, industries: action.payload };

    // Timers
    case 'SET_TIMERS':
      return { ...state, timers: action.payload };
    case 'UPSERT_TIMER': {
      const idx = state.timers.findIndex((t) => t.id === action.payload.id);
      const next = [...state.timers];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, timers: next };
    }
    case 'DELETE_TIMER':
      return { ...state, timers: state.timers.filter((t) => t.id !== action.id) };

    case 'RELOAD_ALL':
      return { ...initialState, ...action.payload, loading: false };

    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // 同步鏡射 clients，讓快速連續的增量更新（updateClient）不會讀到過期快照
  const clientsRef = useRef(initialState.clients);
  clientsRef.current = state.clients;

  // 只在真正被其他分頁的舊連線擋住時通知（IndexedDB 原生訊號，非猜測性逾時）
  useEffect(() => {
    setOnBlocked(() => dispatch({ type: 'SET_DB_BLOCKED', payload: true }));
  }, []);

  // ☁️ 雲端同步：啟動引擎；遠端合併進本機後刷新整個畫面
  const reloadAllRef = useRef(null);
  useEffect(() => {
    setOnRemoteApplied(() => { reloadAllRef.current?.(); });
    startSync(); // 未啟用時是 no-op
  }, []);

  // 向瀏覽器申請「持久儲存」：空間吃緊時不得自動清掉本系統的資料庫
  useEffect(() => {
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* 不支援就算了 */ }
  }, []);

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadAll() {
      try {
        const [clients, cats, stages, customFields, deals, dealFields, tasks, events, timers, thresholdRow, templateRow, presetsRow, industriesRow] = await Promise.all([
          db.getAll('clients'),
          db.getAll('cats'),
          db.getAll('stages'),
          db.getAll('customFields'),
          db.getAll('deals'),
          db.getAll('dealFields'),
          db.getAll('tasks'),
          db.getAll('events'),
          db.getAll('timers'),
          db.get('settings', 'crmThresholds').catch(() => null),
          db.get('settings', 'todoTemplate').catch(() => null),
          db.get('settings', 'quotePresets').catch(() => null),
          db.get('settings', 'industries').catch(() => null),
        ]);

        const resolvedCats = cats.length > 0 ? cats : DEFAULT_CATS;
        const resolvedStages = stages.length > 0 ? stages : DEFAULT_STAGES;
        const resolvedDealFields = dealFields.length > 0 ? dealFields : DEFAULT_DEAL_FIELDS;

        if (cats.length === 0) for (const c of DEFAULT_CATS) await db.put('cats', c).catch(() => {});
        if (stages.length === 0) for (const s of DEFAULT_STAGES) await db.put('stages', s).catch(() => {});
        if (dealFields.length === 0) for (const f of DEFAULT_DEAL_FIELDS) await db.put('dealFields', f).catch(() => {});

        dispatch({
          type: 'LOAD_INIT',
          payload: {
            clients, cats: resolvedCats, stages: resolvedStages, customFields,
            deals, dealFields: resolvedDealFields, tasks, events, timers,
            thresholds: thresholdRow ? normalizeThresholds(thresholdRow) : DEFAULT_THRESHOLDS,
            todoTemplate: Array.isArray(templateRow?.items) ? templateRow.items : DEFAULT_TODO_TEMPLATE,
            quotePresets: resolveQuotePresets(presetsRow),
            industries: Array.isArray(industriesRow?.items) ? industriesRow.items : INDUSTRY_SUGGESTIONS,
          },
        });
        // 每日一次資料保養：清過期墓碑與 30 天前完成的待辦/提醒（防同步檔長期膨脹）
        try {
          const last = localStorage.getItem(STORAGE_KEYS.housekeepAt);
          if (!last || Date.now() - Date.parse(last) > 24 * 3600 * 1000) {
            localStorage.setItem(STORAGE_KEYS.housekeepAt, new Date().toISOString());
            db.housekeep().catch(() => {});
          }
        } catch { /* noop */ }
      } catch (err) {
        // IndexedDB 不可用時（file:// 限制、隱私模式等），以空資料繼續執行
        console.warn('IndexedDB unavailable, running in memory-only mode:', err);
        dispatch({
          type: 'LOAD_INIT',
          payload: {
            clients: [],
            cats: DEFAULT_CATS,
            stages: DEFAULT_STAGES,
            customFields: [],
            timers: [],
            dbUnavailable: true,
          },
        });
      }
    }
    loadAll();
  }, []);

  // ── CRM ───────────────────────────────────────────────────────────────────
  const saveClient = useCallback(async (client) => {
    const now = new Date().toISOString();
    const full = { createdAt: now, ...client, updatedAt: now };
    // 先同步更新鏡射，再等待寫入，避免同一 tick 內的連續更新彼此覆蓋
    const idx = clientsRef.current.findIndex((c) => c.id === full.id);
    clientsRef.current = idx === -1
      ? [...clientsRef.current, full]
      : clientsRef.current.map((c) => (c.id === full.id ? full : c));
    dispatch({ type: 'UPSERT_CLIENT', payload: full });
    await db.put('clients', full);
    return full;
  }, []);

  /** 以最新狀態做增量更新：updater 收到當前 client、回傳新 client */
  const updateClient = useCallback(async (id, updater) => {
    const current = clientsRef.current.find((c) => c.id === id);
    if (!current) return null;
    return saveClient(updater(current));
  }, [saveClient]);

  /** 刪除客戶時一併清除其關聯的行事曆活動與未完成提醒，避免日曆留下孤兒項目 */
  const cleanupClientLinks = useCallback(async (idSet) => {
    const set = idSet instanceof Set ? idSet : new Set(idSet);
    const [evs, tms] = await Promise.all([db.getAll('events'), db.getAll('timers')]);
    for (const e of evs) {
      if (e.clientId && set.has(e.clientId)) {
        await db.delete('events', e.id);
        dispatch({ type: 'DELETE_EVENT', id: e.id });
      }
    }
    for (const t of tms) {
      if (t.clientId && set.has(t.clientId) && !t.confirmedAt) {
        await db.delete('timers', t.id);
        dispatch({ type: 'DELETE_TIMER', id: t.id });
      }
    }
  }, []);

  const deleteClient = useCallback(async (id) => {
    clientsRef.current = clientsRef.current.filter((c) => c.id !== id);
    await db.delete('clients', id);
    await db.deletePhotosByClient(id).catch(() => {}); // 一併釋放照片佔用的空間
    dispatch({ type: 'DELETE_CLIENT', id });
    await cleanupClientLinks([id]);
  }, [cleanupClientLinks]);

  /** 批次刪除客戶（每筆各留墓碑，同步後其他裝置也會刪除；本機照片一併刪除） */
  const deleteClients = useCallback(async (ids) => {
    const set = new Set(ids);
    clientsRef.current = clientsRef.current.filter((c) => !set.has(c.id));
    dispatch({ type: 'DELETE_CLIENTS', ids });
    for (const id of ids) {
      await db.delete('clients', id);
      await db.deletePhotosByClient(id).catch(() => {});
    }
    await cleanupClientLinks(set);
  }, [cleanupClientLinks]);

  /** 覆寫整個 store：寫入現有項目並刪除已移除的（否則刪除的項目重整後會復活） */
  const overwriteStore = useCallback(async (storeName, items) => {
    for (const it of items) await db.put(storeName, it);
    const existing = await db.getAll(storeName);
    for (const e of existing) {
      if (!items.some((it) => it.id === e.id)) await db.delete(storeName, e.id);
    }
  }, []);

  const saveCats = useCallback(async (cats) => {
    dispatch({ type: 'SET_CATS', payload: cats });
    await overwriteStore('cats', cats);
  }, [overwriteStore]);

  const saveStages = useCallback(async (stages) => {
    dispatch({ type: 'SET_STAGES', payload: stages });
    await overwriteStore('stages', stages);
  }, [overwriteStore]);

  const saveCustomFields = useCallback(async (fields) => {
    dispatch({ type: 'SET_CUSTOM_FIELDS', payload: fields });
    await overwriteStore('customFields', fields);
  }, [overwriteStore]);

  // ── Deals（成交歸檔／業績表）──────────────────────────────────────────────
  const saveDeal = useCallback(async (deal) => {
    const full = { createdAt: new Date().toISOString(), ...deal };
    dispatch({ type: 'UPSERT_DEAL', payload: full });
    await db.put('deals', full);
    return full;
  }, []);

  const deleteDeal = useCallback(async (id) => {
    dispatch({ type: 'DELETE_DEAL', id });
    await db.delete('deals', id);
  }, []);

  const saveDealFields = useCallback(async (fields) => {
    dispatch({ type: 'SET_DEAL_FIELDS', payload: fields });
    await overwriteStore('dealFields', fields);
  }, [overwriteStore]);

  // ── Tasks（中央待辦）──────────────────────────────────────────────────────
  const saveTask = useCallback(async (task) => {
    const full = { createdAt: new Date().toISOString(), ...task };
    dispatch({ type: 'UPSERT_TASK', payload: full });
    await db.put('tasks', full);
    return full;
  }, []);

  const deleteTask = useCallback(async (id) => {
    dispatch({ type: 'DELETE_TASK', id });
    await db.delete('tasks', id);
  }, []);

  // ── Events（行事曆活動）────────────────────────────────────────────────────
  const saveEvent = useCallback(async (event) => {
    const full = { createdAt: new Date().toISOString(), ...event };
    dispatch({ type: 'UPSERT_EVENT', payload: full });
    await db.put('events', full);
    return full;
  }, []);

  const deleteEvent = useCallback(async (id) => {
    dispatch({ type: 'DELETE_EVENT', id });
    await db.delete('events', id);
  }, []);

  // ── 待辦範本（設定頁可編輯；原樣儲存，套用時才過濾空項）──────────────────
  const saveTodoTemplate = useCallback(async (items) => {
    dispatch({ type: 'SET_TODO_TEMPLATE', payload: items });
    await db.put('settings', { key: 'todoTemplate', items }).catch(() => {});
  }, []);

  // ── 報價選單（車體配備 / 補助折抵，設定頁可編輯）────────────────────────
  const saveQuotePresets = useCallback(async (presets) => {
    dispatch({ type: 'SET_QUOTE_PRESETS', payload: presets });
    await db.put('settings', { key: 'quotePresets', ...presets }).catch(() => {});
  }, []);

  // ── 產業選項（設定頁可增刪排序；客戶表單下拉選單與側欄篩選共用）──────────
  const saveIndustries = useCallback(async (items) => {
    dispatch({ type: 'SET_INDUSTRIES', payload: items });
    await db.put('settings', { key: 'industries', items }).catch(() => {});
  }, []);

  const saveThresholds = useCallback(async (t) => {
    const clean = normalizeThresholds(t);
    await db.put('settings', { key: 'crmThresholds', ...clean }).catch(() => {});
    dispatch({ type: 'SET_THRESHOLDS', payload: clean });
    return clean;
  }, []);

  // ── Timers ────────────────────────────────────────────────────────────────
  const saveTimer = useCallback(async (timer) => {
    await db.put('timers', timer);
    dispatch({ type: 'UPSERT_TIMER', payload: timer });
  }, []);

  const deleteTimer = useCallback(async (id) => {
    await db.delete('timers', id);
    dispatch({ type: 'DELETE_TIMER', id });
  }, []);

  // ── Full reload (after import) ────────────────────────────────────────────
  const reloadAll = useCallback(async () => {
    const [clients, cats, stages, customFields, deals, dealFields, tasks, events, timers, thresholdRow, templateRow, presetsRow, industriesRow] = await Promise.all([
      db.getAll('clients'),
      db.getAll('cats'),
      db.getAll('stages'),
      db.getAll('customFields'),
      db.getAll('deals'),
      db.getAll('dealFields'),
      db.getAll('tasks'),
      db.getAll('events'),
      db.getAll('timers'),
      db.get('settings', 'crmThresholds').catch(() => null),
      db.get('settings', 'todoTemplate').catch(() => null),
      db.get('settings', 'quotePresets').catch(() => null),
      db.get('settings', 'industries').catch(() => null),
    ]);
    dispatch({
      type: 'RELOAD_ALL',
      payload: {
        clients,
        cats: cats.length > 0 ? cats : DEFAULT_CATS,
        stages: stages.length > 0 ? stages : DEFAULT_STAGES,
        customFields,
        deals,
        dealFields: dealFields.length > 0 ? dealFields : DEFAULT_DEAL_FIELDS,
        tasks,
        events,
        timers,
        thresholds: thresholdRow ? normalizeThresholds(thresholdRow) : DEFAULT_THRESHOLDS,
        todoTemplate: Array.isArray(templateRow?.items) ? templateRow.items : DEFAULT_TODO_TEMPLATE,
        quotePresets: resolveQuotePresets(presetsRow),
        industries: Array.isArray(industriesRow?.items) ? industriesRow.items : INDUSTRY_SUGGESTIONS,
      },
    });
  }, []);
  reloadAllRef.current = reloadAll;

  const value = {
    ...state,
    dispatch,
    saveClient,
    updateClient,
    deleteClient,
    deleteClients,
    saveCats,
    saveStages,
    saveCustomFields,
    saveDeal,
    deleteDeal,
    saveDealFields,
    saveTask,
    deleteTask,
    saveEvent,
    deleteEvent,
    saveTodoTemplate,
    saveQuotePresets,
    saveIndustries,
    saveThresholds,
    saveTimer,
    deleteTimer,
    reloadAll,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
