import {
  createContext, useContext, useReducer, useEffect, useCallback, useRef, useState,
} from 'react';
import { db } from './db';
import {
  DEFAULT_THRESHOLDS, normalizeThresholds, DEFAULT_TODO_TEMPLATE, DEFAULT_QUOTE_PRESETS,
} from './utils/crm';
import { today } from './utils/date';
import dayjs from 'dayjs';

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
  todoTemplate: DEFAULT_TODO_TEMPLATE,
  quotePresets: DEFAULT_QUOTE_PRESETS,
  timers: [],
  thresholds: DEFAULT_THRESHOLDS,
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
    case 'SET_CATS':
      return { ...state, cats: action.payload };
    case 'SET_STAGES':
      return { ...state, stages: action.payload };
    case 'SET_CUSTOM_FIELDS':
      return { ...state, customFields: action.payload };
    case 'SET_THRESHOLDS':
      return { ...state, thresholds: action.payload };

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
    case 'SET_TODO_TEMPLATE':
      return { ...state, todoTemplate: action.payload };
    case 'SET_QUOTE_PRESETS':
      return { ...state, quotePresets: action.payload };

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

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadAll() {
      try {
        const [clients, cats, stages, customFields, deals, dealFields, tasks, timers, thresholdRow, templateRow, presetsRow] = await Promise.all([
          db.getAll('clients'),
          db.getAll('cats'),
          db.getAll('stages'),
          db.getAll('customFields'),
          db.getAll('deals'),
          db.getAll('dealFields'),
          db.getAll('tasks'),
          db.getAll('timers'),
          db.get('settings', 'crmThresholds').catch(() => null),
          db.get('settings', 'todoTemplate').catch(() => null),
          db.get('settings', 'quotePresets').catch(() => null),
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
            deals, dealFields: resolvedDealFields, tasks, timers,
            thresholds: thresholdRow ? normalizeThresholds(thresholdRow) : DEFAULT_THRESHOLDS,
            todoTemplate: Array.isArray(templateRow?.items) ? templateRow.items : DEFAULT_TODO_TEMPLATE,
            quotePresets: presetsRow?.addons ? presetsRow : DEFAULT_QUOTE_PRESETS,
          },
        });
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

  const deleteClient = useCallback(async (id) => {
    clientsRef.current = clientsRef.current.filter((c) => c.id !== id);
    await db.delete('clients', id);
    dispatch({ type: 'DELETE_CLIENT', id });
  }, []);

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
    const [clients, cats, stages, customFields, deals, dealFields, tasks, timers, thresholdRow, templateRow, presetsRow] = await Promise.all([
      db.getAll('clients'),
      db.getAll('cats'),
      db.getAll('stages'),
      db.getAll('customFields'),
      db.getAll('deals'),
      db.getAll('dealFields'),
      db.getAll('tasks'),
      db.getAll('timers'),
      db.get('settings', 'crmThresholds').catch(() => null),
      db.get('settings', 'todoTemplate').catch(() => null),
      db.get('settings', 'quotePresets').catch(() => null),
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
        timers,
        thresholds: thresholdRow ? normalizeThresholds(thresholdRow) : DEFAULT_THRESHOLDS,
        todoTemplate: Array.isArray(templateRow?.items) ? templateRow.items : DEFAULT_TODO_TEMPLATE,
        quotePresets: presetsRow?.addons ? presetsRow : DEFAULT_QUOTE_PRESETS,
      },
    });
  }, []);

  const value = {
    ...state,
    dispatch,
    saveClient,
    updateClient,
    deleteClient,
    saveCats,
    saveStages,
    saveCustomFields,
    saveDeal,
    deleteDeal,
    saveDealFields,
    saveTask,
    deleteTask,
    saveTodoTemplate,
    saveQuotePresets,
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
