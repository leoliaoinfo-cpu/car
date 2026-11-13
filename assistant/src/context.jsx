import {
  createContext, useContext, useReducer, useEffect, useCallback, useRef, useState,
} from 'react';
import { db, setOnBlocked } from './db';
import { startSync, setOnRemoteApplied } from './sync';
import {
  DEFAULT_THRESHOLDS, normalizeThresholds, DEFAULT_TODO_TEMPLATE, DEFAULT_QUOTE_PRESETS,
  resolveQuotePresets, INDUSTRY_SUGGESTIONS,
} from './utils/crm';
import { today, addDays } from './utils/date';
import dayjs from 'dayjs';
import { STORAGE_KEYS } from './storageKeys';
import {
  buildPricingRecord, collectCustomItemHistory, EMPTY_COST_CATALOG, normalizeCostCatalog, normalizeCustomItemHistory,
} from './utils/pricing';
import { stockItemsFromQuote } from './utils/stock';
import { canonicalizeQuotes, collectReferencedCaseIds, findGhostQuoteCases, planQuoteCaseLink } from './utils/quotes';
import { normalizeDeliveryWorkflow as normalizeDeliveryWorkflowSafe, planDeliveryCompletion, selectPreSaleItemsToClose } from './utils/delivery';
import { generateId } from './utils/crm';
import { DEFAULT_HEIGHT_CONFIG, normalizeHeightConfig } from './utils/reception';
import { advanceCasePipeline, assignCaseNumbers, findDealForCase, buildLegacyCaseSeeds, FIRST_CASE_NUMBER, inferCaseType } from './utils/cases';
import { changedPatch, pricingRecordsToDropForClients, recTs } from './utils/dataMerge.js';

const AppContext = createContext(null);

async function migrateLegacyQuotes(clients, quoteDrafts) {
  const canonical = canonicalizeQuotes(clients, quoteDrafts);
  if (!canonical.migrated) return canonical;
  // 只寫回真的變動的資料，且原樣寫入（不重蓋 _ts）：搬移不是使用者的新修改，
  // 不能因此蓋掉別台裝置較新的版本，也不能讓別台已刪除的報價復活。
  const added = new Set(canonical.addedQuoteIds);
  const changed = new Set(canonical.changedClientIds);
  for (const quote of canonical.quoteDrafts) if (added.has(quote.id)) await db.putRaw('quoteDrafts', quote);
  // 客戶只比原本時間 +1ms：贏過「同一版但還帶舊 quotes 的自己」（避免兩台同分互相覆蓋），但輸給任何真正較新的修改
  for (const client of canonical.clients) if (changed.has(client.id)) await db.putRaw('clients', { ...client, _ts: recTs(client) + 1 });
  return canonical;
}

/**
 * 啟動時的整理寫入。預設分類／階段／業績欄位只放記憶體、不寫進資料庫——
 * 寫進去會帶新的 _ts，新裝置一同步就把使用者在別台自訂好的同 id 資料蓋回預設值。
 */
async function persistStartupMigrations({ customPricingHistoryRow, resolvedCustomPricingHistory, caseNumberSequenceRow, nextNumber }) {
  // 自訂品項歷史：只有真的搬到東西才寫；空的不寫（否則新裝置的空清單會蓋掉雲端真實紀錄）
  if (!customPricingHistoryRow?.legacyMigratedAt && resolvedCustomPricingHistory.length > 0) {
    await db.put('settings', {
      key: 'customPricingHistory', entries: resolvedCustomPricingHistory,
      legacyMigratedAt: new Date().toISOString(),
    });
  }
  // 案件編號序號：還沒有任何編號時不必寫（避免新裝置的「100」蓋掉雲端已用到的序號）
  const isPristine = !caseNumberSequenceRow && nextNumber === FIRST_CASE_NUMBER;
  if (!isPristine && caseNumberSequenceRow?.nextNumber !== nextNumber) {
    await db.put('settings', { key: 'caseNumberSequence', nextNumber });
  }
}

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
  pricingRecords: [],
  quoteDrafts: [],
  receptionSessions: [],
  suppliers: [],
  cases: [],
  deletedCases: [],
  workItems: [],
  activities: [],
  tasks: [],
  events: [],
  todoTemplate: DEFAULT_TODO_TEMPLATE,
  quotePresets: DEFAULT_QUOTE_PRESETS,
  costCatalog: EMPTY_COST_CATALOG,
  customPricingHistory: [],
  industries: INDUSTRY_SUGGESTIONS,
  timers: [],
  thresholds: DEFAULT_THRESHOLDS,
  heightConfig: DEFAULT_HEIGHT_CONFIG,
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
    case 'SET_HEIGHT_CONFIG':
      return { ...state, heightConfig: action.payload };
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
    case 'UPSERT_PRICING_RECORD': {
      const idx = state.pricingRecords.findIndex((row) => row.id === action.payload.id);
      const next = [...state.pricingRecords];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, pricingRecords: next };
    }
    case 'DELETE_PRICING_RECORD':
      return { ...state, pricingRecords: state.pricingRecords.filter((row) => row.id !== action.id) };
    case 'UPSERT_QUOTE_DRAFT': {
      const idx = state.quoteDrafts.findIndex((row) => row.id === action.payload.id);
      const next = [...state.quoteDrafts];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, quoteDrafts: next };
    }
    case 'DELETE_QUOTE_DRAFT':
      return { ...state, quoteDrafts: state.quoteDrafts.filter((row) => row.id !== action.id) };
    case 'UPSERT_RECEPTION_SESSION': {
      const idx = state.receptionSessions.findIndex((row) => row.id === action.payload.id);
      const next = [...state.receptionSessions];
      if (idx === -1) next.push(action.payload); else next[idx] = action.payload;
      return { ...state, receptionSessions: next };
    }
    case 'DELETE_RECEPTION_SESSION':
      return { ...state, receptionSessions: state.receptionSessions.filter((row) => row.id !== action.id) };
    case 'UPSERT_SUPPLIER': {
      const idx = state.suppliers.findIndex((row) => row.id === action.payload.id);
      const next = [...state.suppliers];
      if (idx === -1) next.push(action.payload); else next[idx] = action.payload;
      return { ...state, suppliers: next };
    }
    case 'DELETE_SUPPLIER':
      return { ...state, suppliers: state.suppliers.filter((row) => row.id !== action.id) };

    // Cases / workbench（新介面；不取代或刪除既有客戶、報價與成交資料）
    case 'UPSERT_CASE': {
      const idx = state.cases.findIndex((row) => row.id === action.payload.id);
      const next = [...state.cases];
      if (idx === -1) next.push(action.payload); else next[idx] = action.payload;
      return { ...state, cases: next };
    }
    case 'DELETE_CASE':
      return { ...state, cases: state.cases.filter((row) => row.id !== action.id) };
    case 'ARCHIVE_CASE':
      return { ...state, cases: state.cases.filter((row) => row.id !== action.payload.id), deletedCases: [...state.deletedCases.filter((row) => row.id !== action.payload.id), action.payload] };
    case 'RESTORE_CASE':
      return { ...state, deletedCases: state.deletedCases.filter((row) => row.id !== action.payload.id), cases: [...state.cases.filter((row) => row.id !== action.payload.id), action.payload] };
    case 'UPSERT_WORK_ITEM': {
      const idx = state.workItems.findIndex((row) => row.id === action.payload.id);
      const next = [...state.workItems];
      if (idx === -1) next.push(action.payload); else next[idx] = action.payload;
      return { ...state, workItems: next };
    }
    case 'DELETE_WORK_ITEM':
      return { ...state, workItems: state.workItems.filter((row) => row.id !== action.id) };
    case 'UPSERT_ACTIVITY': {
      const idx = state.activities.findIndex((row) => row.id === action.payload.id);
      const next = [...state.activities];
      if (idx === -1) next.push(action.payload); else next[idx] = action.payload;
      return { ...state, activities: next };
    }
    case 'DELETE_ACTIVITY':
      return { ...state, activities: state.activities.filter((row) => row.id !== action.id) };

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
    case 'SET_COST_CATALOG':
      return { ...state, costCatalog: action.payload };
    case 'SET_CUSTOM_PRICING_HISTORY':
      return { ...state, customPricingHistory: action.payload };
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
  const casesRef = useRef(initialState.cases);
  casesRef.current = state.cases;
  const caseNumberNextRef = useRef(FIRST_CASE_NUMBER);

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
        const [clients, cats, stages, customFields, deals, dealFields, pricingRecords, quoteDrafts, receptionSessions, suppliers, cases, workItems, activities, tasks, events, timers, thresholdRow, templateRow, presetsRow, costCatalogRow, customPricingHistoryRow, industriesRow, heightConfigRow, caseNumberSequenceRow] = await Promise.all([
          db.getAll('clients'),
          db.getAll('cats'),
          db.getAll('stages'),
          db.getAll('customFields'),
          db.getAll('deals'),
          db.getAll('dealFields'),
          db.getAll('pricingRecords'),
          db.getAll('quoteDrafts'),
          db.getAll('receptionSessions'),
          db.getAll('suppliers'),
          db.getAll('cases'),
          db.getAll('workItems'),
          db.getAll('activities'),
          db.getAll('tasks'),
          db.getAll('events'),
          db.getAll('timers'),
          db.get('settings', 'crmThresholds').catch(() => null),
          db.get('settings', 'todoTemplate').catch(() => null),
          db.get('settings', 'quotePresets').catch(() => null),
          db.get('settings', 'costCatalog').catch(() => null),
          db.get('settings', 'customPricingHistory').catch(() => null),
          db.get('settings', 'industries').catch(() => null),
          db.get('settings', 'heightConfig').catch(() => null),
          db.get('settings', 'caseNumberSequence').catch(() => null),
        ]);

        const resolvedCats = cats.length > 0 ? cats : DEFAULT_CATS;
        const resolvedStages = stages.length > 0 ? stages : DEFAULT_STAGES;
        const resolvedDealFields = dealFields.length > 0 ? dealFields : DEFAULT_DEAL_FIELDS;
        const storedCustomPricingHistory = normalizeCustomItemHistory(customPricingHistoryRow?.entries);
        const resolvedCustomPricingHistory = customPricingHistoryRow?.legacyMigratedAt
          ? storedCustomPricingHistory : collectCustomItemHistory([
            { id: 'central-custom-pricing', customItemHistory: storedCustomPricingHistory },
            ...pricingRecords,
          ]);

        const canonical = await migrateLegacyQuotes(clients, quoteDrafts);
        const caseSeeds = buildLegacyCaseSeeds({
          deals, quotes: canonical.quoteDrafts, clients: canonical.clients, existingCases: cases,
        });
        for (const item of caseSeeds) await db.put('cases', item);
        // 舊版替「只做報價」長出的空殼「未命名客戶」案件：沒有任何使用者資料才移除（報價保留）。
        const ghostCaseIds = new Set(findGhostQuoteCases({
          cases, quotes: canonical.quoteDrafts,
          referencedCaseIds: collectReferencedCaseIds(workItems, activities, tasks, deals, events),
        }));
        for (const id of ghostCaseIds) await db.delete('cases', id).catch(() => {});
        const keptCases = cases.filter((row) => !ghostCaseIds.has(row.id));
        const numberedCases = assignCaseNumbers([...keptCases, ...caseSeeds], caseNumberSequenceRow?.nextNumber);
        const changedCaseIds = new Set(numberedCases.changedIds);
        for (const item of numberedCases.cases) if (changedCaseIds.has(item.id)) await db.put('cases', item);
        caseNumberNextRef.current = numberedCases.nextNumber;
        const visibleCases = numberedCases.cases.filter((row) => !row.deletedAt);
        casesRef.current = visibleCases;
        await persistStartupMigrations({
          customPricingHistoryRow, resolvedCustomPricingHistory, caseNumberSequenceRow, nextNumber: numberedCases.nextNumber,
        });
        const resolvedCases = visibleCases;
        dispatch({
          type: 'LOAD_INIT',
          payload: {
            clients: canonical.clients, cats: resolvedCats, stages: resolvedStages, customFields,
            deals, dealFields: resolvedDealFields, pricingRecords, quoteDrafts: canonical.quoteDrafts, receptionSessions, suppliers,
            cases: resolvedCases, deletedCases: numberedCases.cases.filter((row) => row.deletedAt), workItems, activities, tasks, events, timers,
            thresholds: thresholdRow ? normalizeThresholds(thresholdRow) : DEFAULT_THRESHOLDS,
            heightConfig: normalizeHeightConfig(heightConfigRow),
            todoTemplate: Array.isArray(templateRow?.items) ? templateRow.items : DEFAULT_TODO_TEMPLATE,
            quotePresets: resolveQuotePresets(presetsRow),
            costCatalog: normalizeCostCatalog(costCatalogRow),
            customPricingHistory: resolvedCustomPricingHistory,
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

  /**
   * 刪除客戶時一併清除其關聯的行事曆活動與未完成提醒，避免日曆留下孤兒項目。
   * 內部成本紀錄：綁著仍存在的成交或報價的一律保留（成交不會跟著刪，成本利潤不能不見）。
   * 案件、報價、成交、工作、歷程、待辦、接待紀錄維持原狀不動（保守做法：不默默刪使用者資料）。
   */
  const cleanupClientLinks = useCallback(async (idSet) => {
    const set = idSet instanceof Set ? idSet : new Set(idSet);
    const [evs, tms, allPricing, deals, quotes] = await Promise.all([
      db.getAll('events'),
      db.getAll('timers'),
      db.getAll('pricingRecords').catch(() => []),
      db.getAll('deals').catch(() => null),
      db.getAll('quoteDrafts').catch(() => null),
    ]);
    // 讀不到成交或報價時寧可一筆都不刪
    const pricing = deals && quotes ? pricingRecordsToDropForClients(allPricing, set, {
      dealIds: new Set(deals.map((row) => row.id)), quoteIds: new Set(quotes.map((row) => row.id)),
    }) : [];
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
    for (const record of pricing) {
      await db.delete('pricingRecords', record.id);
      dispatch({ type: 'DELETE_PRICING_RECORD', id: record.id });
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

  /**
   * 將暫名客戶的所有關聯資料改掛到正式客戶；同一個 id 時則只刷新顯示名稱。
   * 以 clientId 為真正關聯鍵，避免改姓名後產生第二位客戶或遺失案件歷程。
   */
  const reassignClientRecords = useCallback(async (sourceId, targetClient) => {
    if (!sourceId || !targetClient?.id) return;
    const now = new Date().toISOString();
    const id = targetClient.id;
    const name = targetClient.name;
    // 只列出要改的欄位；值都一樣的資料不重寫（一般儲存客戶時 sourceId === targetId，
    // 若整批重寫會蓋上新的 _ts，讓這台的舊資料在同步時蓋掉別台較新的修改）
    const mappings = [
      ['cases', 'UPSERT_CASE', { clientId: id, clientName: name }],
      ['workItems', 'UPSERT_WORK_ITEM', { clientId: id, clientName: name }],
      ['activities', 'UPSERT_ACTIVITY', { clientId: id, clientName: name }],
      ['tasks', 'UPSERT_TASK', { clientId: id }],
      ['events', 'UPSERT_EVENT', { clientId: id }],
      ['timers', 'UPSERT_TIMER', { clientId: id, clientName: name }],
      ['pricingRecords', 'UPSERT_PRICING_RECORD', { clientId: id }],
      ['quoteDrafts', 'UPSERT_QUOTE_DRAFT', { clientId: id, customerName: name }],
      ['deals', 'UPSERT_DEAL', { clientId: id, clientName: name }],
      ['receptionSessions', 'UPSERT_RECEPTION_SESSION', { clientId: id, displayName: name, pendingCustomerDetails: !!targetClient.pendingCustomerDetails }],
    ];
    for (const [storeName, actionType, fields] of mappings) {
      const rows = await db.getAll(storeName).catch(() => []);
      for (const row of rows) {
        if (row.clientId !== sourceId) continue;
        const diff = changedPatch(row, fields);
        if (!diff) continue;
        const next = { ...row, ...diff, updatedAt: now };
        await db.put(storeName, next);
        dispatch({ type: actionType, payload: next });
      }
    }
    if (sourceId !== targetClient.id) {
      // 照片只存本機、刪了救不回 → 改掛到正式客戶，不刪除。
      // 改掛失敗就丟出錯誤、暫不刪除原客戶，讓照片仍有主人（之後可再合併一次）。
      await db.reassignPhotos(sourceId, targetClient.id);
      clientsRef.current = clientsRef.current.filter((row) => row.id !== sourceId);
      await db.delete('clients', sourceId);
      dispatch({ type: 'DELETE_CLIENT', id: sourceId });
    }
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
    const now = new Date().toISOString();
    let full = { createdAt: now, ...deal, updatedAt: now };
    if (full.caseArchivedAt) {
      dispatch({ type: 'UPSERT_DEAL', payload: full });
      await db.put('deals', full);
      return full;
    }
    const allCases = (await db.getAll('cases').catch(() => [])).filter((row) => !row.deletedAt);
    const quote = full.quoteId ? await db.get('quoteDrafts', full.quoteId).catch(() => null) : null;
    const existingDeal = await db.get('deals', full.id).catch(() => null);
    const caseType = inferCaseType(quote);
    const candidates = allCases.filter((row) => row.clientId && row.clientId === (full.clientId || quote?.clientId)
      && row.type === caseType && row.status !== 'completed');
    const linked = allCases.find((row) => row.id === full.caseId || row.id === quote?.caseId
      || row.dealId === full.id || (full.quoteId && (row.quoteIds || []).includes(full.quoteId)))
      || (candidates.length === 1 ? candidates[0] : null);
    // 已存在的成交重新儲存時，找不到案件也不再另外長出新案件（案件已完成後再改成交，會冒出重複的「購車案件」）。
    if (!linked && existingDeal) {
      dispatch({ type: 'UPSERT_DEAL', payload: full });
      await db.put('deals', full);
      return full;
    }
    const caseRow = advanceCasePipeline({
      ...(linked || {}),
      id: linked?.id || `case:deal:${full.id}`,
      clientId: full.clientId || quote?.clientId || linked?.clientId || null,
      clientName: full.clientName || quote?.customerName || linked?.clientName || '未命名客戶',
      type: linked?.type || inferCaseType(quote),
      title: full.model || quote?.model || linked?.title || '購車案件',
      status: linked?.status || 'active', dealId: full.id,
      quoteIds: [...new Set([...(linked?.quoteIds || []), full.quoteId].filter(Boolean))],
      source: linked?.source || 'deal', createdAt: linked?.createdAt || full.createdAt || now, updatedAt: now,
    }, 'won', now, { allowBackward: false });
    full = { ...full, caseId: caseRow.id };
    dispatch({ type: 'UPSERT_DEAL', payload: full });
    await db.put('deals', full);
    dispatch({ type: 'UPSERT_CASE', payload: caseRow });
    await db.put('cases', caseRow);
    return full;
  }, []);

  const deleteDeal = useCallback(async (id) => {
    dispatch({ type: 'DELETE_DEAL', id });
    await db.delete('deals', id);
    await db.delete('pricingRecords', `deal:${id}`).catch(() => {});
    dispatch({ type: 'DELETE_PRICING_RECORD', id: `deal:${id}` });
    const linkedCases = (await db.getAll('cases').catch(() => [])).filter((row) => row.dealId === id);
    for (const row of linkedCases) {
      const next = { ...row, dealId: null, updatedAt: new Date().toISOString() };
      dispatch({ type: 'UPSERT_CASE', payload: next });
      await db.put('cases', next);
    }
  }, []);

  const saveDealFields = useCallback(async (fields) => {
    dispatch({ type: 'SET_DEAL_FIELDS', payload: fields });
    await overwriteStore('dealFields', fields);
  }, [overwriteStore]);

  const savePricingRecord = useCallback(async (record) => {
    dispatch({ type: 'UPSERT_PRICING_RECORD', payload: record });
    await db.put('pricingRecords', record);
    return record;
  }, []);

  const confirmQuoteDeal = useCallback(async (quoteId) => {
    const quote = await db.get('quoteDrafts', quoteId);
    if (!quote || quote.archivedAt || !quote.clientId || !quote.caseId) throw new Error('請先將報價連結至客戶案件，才可確認成交。');
    const caseItem = await db.get('cases', quote.caseId);
    if (!caseItem || caseItem.deletedAt || caseItem.clientId !== quote.clientId) throw new Error('報價的客戶案件連結不正確，請先核對。');
    const existingDeals = await db.getAll('deals');
    const priorDeal = findDealForCase(existingDeals, caseItem);
    if (priorDeal?.quoteId && priorDeal.quoteId !== quoteId) throw new Error('此案件已指定另一張成交報價，不能重複建立。');
    if (priorDeal?.quoteId === quoteId) throw new Error('這張報價已經是成交版本，不需要重複確認。');
    const timestamp = new Date().toISOString();
    const dealId = priorDeal?.id || `deal:quote:${quoteId}`;
    const deal = {
      ...(priorDeal || {}),
      id: dealId, quoteId, caseId: caseItem.id, clientId: quote.clientId,
      clientName: quote.customerName || caseItem.clientName, model: quote.model || caseItem.title,
      amount: priorDeal ? priorDeal.amount : Number(quote.total) || 0,
      date: priorDeal?.date || today(), confirmedAt: priorDeal?.confirmedAt || priorDeal?.createdAt || timestamp,
      pricingNeedsReview: Boolean(priorDeal),
      quoteSnapshot: structuredClone(quote),
      stockItems: stockItemsFromQuote(quote, state.quotePresets?.addons || []),
    };
    const sourcePricing = await db.get('pricingRecords', `quote:${quoteId}`).catch(() => null);
    const previousDealPricing = priorDeal ? await db.get('pricingRecords', `deal:${dealId}`).catch(() => null) : null;
    const pricing = buildPricingRecord({ quote, costCatalog: state.costCatalog, existing: sourcePricing || previousDealPricing, kind: 'deal', dealId });
    await saveDeal(deal);
    const dealPricing = priorDeal && previousDealPricing
      ? { ...previousDealPricing, quoteId, updatedAt: timestamp }
      : { ...pricing, id: `deal:${dealId}`, quoteId, dealId, kind: 'deal', clientId: quote.clientId,
        saleTotal: Number(deal.amount) || 0, profit: priorDeal ? null : pricing.profit,
        costComplete: priorDeal ? false : pricing.costComplete,
        createdAt: timestamp, updatedAt: timestamp };
    dispatch({ type: 'UPSERT_PRICING_RECORD', payload: dealPricing });
    await db.put('pricingRecords', dealPricing);
    return deal;
  }, [saveDeal, state.quotePresets, state.costCatalog]);

  const deletePricingRecord = useCallback(async (id) => {
    dispatch({ type: 'DELETE_PRICING_RECORD', id });
    await db.delete('pricingRecords', id);
  }, []);

  // ── 報價管理工作區 ───────────────────────────────────────────────────────
  const saveQuoteDraft = useCallback(async (quote) => {
    const now = new Date().toISOString();
    const draft = { ...quote, createdAt: quote.createdAt || now, updatedAt: now };
    const allCases = await db.getAll('cases').catch(() => []);
    const allQuotes = await db.getAll('quoteDrafts').catch(() => []);
    // 歸屬決策在 utils/quotes.js（純函式、有測試）：沒客戶不建案件；歸入既有案件不改標題；舊空殼案件移除。
    const existingQuote = allQuotes.find((row) => row.id === draft.id) || null;
    let plan = planQuoteCaseLink({ quote: draft, cases: allCases, quotes: allQuotes, now, isExisting: Boolean(existingQuote) });
    if (plan.deleteCaseIds.length) {
      const [workItems, activities, tasks, deals, events] = await Promise.all(
        ['workItems', 'activities', 'tasks', 'deals', 'events'].map((store) => db.getAll(store).catch(() => [])));
      const referencedCaseIds = collectReferencedCaseIds(workItems, activities, tasks, deals, events);
      plan = planQuoteCaseLink({ quote: draft, cases: allCases, quotes: allQuotes, referencedCaseIds, now, isExisting: Boolean(existingQuote) });
    }
    const full = plan.quote;
    const caseRow = plan.caseRow ? advanceCasePipeline(plan.caseRow, 'new', now, { allowBackward: false }) : null;
    dispatch({ type: 'UPSERT_QUOTE_DRAFT', payload: full });
    await db.put('quoteDrafts', full);
    if (plan.previousCase) {
      dispatch({ type: 'UPSERT_CASE', payload: plan.previousCase });
      await db.put('cases', plan.previousCase);
    }
    if (caseRow) {
      dispatch({ type: 'UPSERT_CASE', payload: caseRow });
      await db.put('cases', caseRow);
    }
    for (const id of plan.deleteCaseIds) {
      dispatch({ type: 'DELETE_CASE', id });
      casesRef.current = casesRef.current.filter((row) => row.id !== id);
      await db.delete('cases', id);
    }
    return full;
  }, []);

  const deleteQuoteDraft = useCallback(async (id) => {
    dispatch({ type: 'DELETE_QUOTE_DRAFT', id });
    await db.delete('quoteDrafts', id);
    await db.delete('pricingRecords', `quote:${id}`).catch(() => {});
    dispatch({ type: 'DELETE_PRICING_RECORD', id: `quote:${id}` });
    const linkedCases = (await db.getAll('cases').catch(() => [])).filter((row) => (row.quoteIds || []).includes(id));
    for (const row of linkedCases) {
      const next = { ...row, quoteIds: (row.quoteIds || []).filter((quoteId) => quoteId !== id), updatedAt: new Date().toISOString() };
      dispatch({ type: 'UPSERT_CASE', payload: next });
      await db.put('cases', next);
    }
    const linkedClients = clientsRef.current.filter((client) =>
      (client.quotes || []).some((quote) => quote.id === id)
      || (client.log || []).some((entry) => entry.quoteId === id));
    for (const client of linkedClients) {
      const next = {
        ...client,
        log: (client.log || []).filter((entry) => entry.quoteId !== id),
      };
      delete next.quotes;
      await saveClient(next);
    }
  }, [saveClient]);

  /** 報價回收筒：只隱藏、不刪除報價、成本、客戶或案件關聯，可隨時恢復。 */
  const archiveQuoteDraft = useCallback(async (id) => {
    const current = await db.get('quoteDrafts', id).catch(() => null);
    if (!current) throw new Error('找不到要放入回收筒的報價。');
    const now = new Date().toISOString();
    const archived = { ...current, archivedAt: now, updatedAt: now };
    dispatch({ type: 'UPSERT_QUOTE_DRAFT', payload: archived });
    await db.put('quoteDrafts', archived);
    return archived;
  }, []);

  const restoreQuoteDraft = useCallback(async (id) => {
    const current = await db.get('quoteDrafts', id).catch(() => null);
    if (!current?.archivedAt) throw new Error('找不到可恢復的報價。');
    const { archivedAt, ...rest } = current;
    const restored = { ...rest, updatedAt: new Date().toISOString() };
    dispatch({ type: 'UPSERT_QUOTE_DRAFT', payload: restored });
    await db.put('quoteDrafts', restored);
    return restored;
  }, []);

  // ── 客戶接待（匿名開始、每次操作自動儲存）──────────────────────────────
  const saveReceptionSession = useCallback(async (session) => {
    const now = new Date().toISOString();
    const full = { ...session, createdAt: session.createdAt || now, updatedAt: now };
    dispatch({ type: 'UPSERT_RECEPTION_SESSION', payload: full });
    await db.put('receptionSessions', full);
    return full;
  }, []);

  const deleteReceptionSession = useCallback(async (id) => {
    dispatch({ type: 'DELETE_RECEPTION_SESSION', id });
    await db.delete('receptionSessions', id);
  }, []);

  // ── 廠商名冊（成交後施工指派用）────────────────────────────────────────
  const saveSupplier = useCallback(async (supplier) => {
    const now = new Date().toISOString();
    const full = { active: true, createdAt: now, ...supplier, updatedAt: now };
    dispatch({ type: 'UPSERT_SUPPLIER', payload: full });
    await db.put('suppliers', full);
    return full;
  }, []);

  const deleteSupplier = useCallback(async (id) => {
    dispatch({ type: 'DELETE_SUPPLIER', id });
    await db.delete('suppliers', id);
  }, []);

  // ── 客戶案件與行動工作台 ────────────────────────────────────────────────
  const saveCase = useCallback(async (item) => {
    const now = new Date().toISOString();
    const previous = casesRef.current.find((row) => row.id === item.id);
    let caseNumber = previous?.caseNumber;
    if (!Number.isInteger(Number(caseNumber)) || Number(caseNumber) < FIRST_CASE_NUMBER) {
      caseNumber = caseNumberNextRef.current;
      caseNumberNextRef.current += 1;
      await db.put('settings', { key: 'caseNumberSequence', nextNumber: caseNumberNextRef.current });
    }
    const full = { status: 'active', type: 'purchase', createdAt: previous?.createdAt || now, ...item, caseNumber: Number(caseNumber), updatedAt: now };
    casesRef.current = [...casesRef.current.filter((row) => row.id !== full.id), full];
    dispatch({ type: 'UPSERT_CASE', payload: full });
    await db.put('cases', full);
    return full;
  }, []);

  const deleteCase = useCallback(async (id) => {
    const current = casesRef.current.find((row) => row.id === id);
    if (!current) return null;
    const now = new Date().toISOString();
    const linkedDeals = (await db.getAll('deals').catch(() => [])).filter((row) => row.caseId === id || current.dealId === row.id);
    const linkedQuotes = (await db.getAll('quoteDrafts').catch(() => [])).filter((row) => row.caseId === id || (current.quoteIds || []).includes(row.id));

    for (const row of linkedDeals) {
      const next = { ...row, caseId: id, caseArchivedAt: now, updatedAt: now };
      dispatch({ type: 'UPSERT_DEAL', payload: next });
      await db.put('deals', next);
    }
    for (const row of linkedQuotes) {
      const next = { ...row, caseId: id, caseArchivedAt: now, updatedAt: now };
      dispatch({ type: 'UPSERT_QUOTE_DRAFT', payload: next });
      await db.put('quoteDrafts', next);
    }

    const archived = { ...current, deletedAt: now, updatedAt: now };
    await db.put('cases', archived);
    casesRef.current = casesRef.current.filter((row) => row.id !== id);
    dispatch({ type: 'ARCHIVE_CASE', payload: archived });
    return archived;
  }, []);

  const restoreCase = useCallback(async (id) => {
    const archived = await db.get('cases', id).catch(() => null);
    if (!archived?.deletedAt) throw new Error('找不到可恢復的案件。');
    const now = new Date().toISOString();
    const linkedDeals = (await db.getAll('deals').catch(() => [])).filter((row) => row.caseId === id || archived.dealId === row.id);
    const linkedQuotes = (await db.getAll('quoteDrafts').catch(() => [])).filter((row) => row.caseId === id || (archived.quoteIds || []).includes(row.id));
    for (const row of linkedDeals) {
      const { caseArchivedAt, ...restDeal } = row;
      const next = { ...restDeal, caseId: id, updatedAt: now };
      dispatch({ type: 'UPSERT_DEAL', payload: next });
      await db.put('deals', next);
    }
    for (const row of linkedQuotes) {
      const { caseArchivedAt, ...restQuote } = row;
      const next = { ...restQuote, caseId: id, updatedAt: now };
      dispatch({ type: 'UPSERT_QUOTE_DRAFT', payload: next });
      await db.put('quoteDrafts', next);
    }
    const { deletedAt, ...rest } = archived;
    const restored = { ...rest, updatedAt: now };
    await db.put('cases', restored);
    casesRef.current = [...casesRef.current.filter((row) => row.id !== id), restored];
    dispatch({ type: 'RESTORE_CASE', payload: restored });
    return restored;
  }, []);

  const saveWorkItem = useCallback(async (item) => {
    const now = new Date().toISOString();
    const full = { state: 'todo', createdAt: now, ...item, updatedAt: now };
    dispatch({ type: 'UPSERT_WORK_ITEM', payload: full });
    await db.put('workItems', full);
    return full;
  }, []);

  const deleteWorkItem = useCallback(async (id) => {
    dispatch({ type: 'DELETE_WORK_ITEM', id });
    await db.delete('workItems', id);
  }, []);

  const saveActivity = useCallback(async (item) => {
    const now = new Date().toISOString();
    const full = { date: today(), createdAt: now, ...item, updatedAt: now };
    dispatch({ type: 'UPSERT_ACTIVITY', payload: full });
    await db.put('activities', full);
    return full;
  }, []);

  const deleteActivity = useCallback(async (id) => {
    dispatch({ type: 'DELETE_ACTIVITY', id });
    await db.delete('activities', id);
  }, []);

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

  // ── 報價選單（車體配件 / 補助折抵，設定頁可編輯）────────────────────────
  const saveQuotePresets = useCallback(async (presets) => {
    dispatch({ type: 'SET_QUOTE_PRESETS', payload: presets });
    await db.put('settings', { key: 'quotePresets', ...presets }).catch(() => {});
  }, []);

  const saveCostCatalog = useCallback(async (catalog) => {
    const normalized = normalizeCostCatalog(catalog);
    dispatch({ type: 'SET_COST_CATALOG', payload: normalized });
    await db.put('settings', normalized);
    return normalized;
  }, []);

  const saveCustomPricingHistory = useCallback(async (entries) => {
    const normalized = normalizeCustomItemHistory(entries);
    dispatch({ type: 'SET_CUSTOM_PRICING_HISTORY', payload: normalized });
    await db.put('settings', {
      key: 'customPricingHistory', entries: normalized, legacyMigratedAt: new Date().toISOString(),
    });
    return normalized;
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

  const saveHeightConfig = useCallback(async (value) => {
    const normalized = normalizeHeightConfig(value);
    await db.put('settings', normalized).catch(() => {});
    dispatch({ type: 'SET_HEIGHT_CONFIG', payload: normalized });
    return normalized;
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

  /**
   * 確認交車（施工流程最後一步）：一次完成交車該有的所有紀錄。
   * 可重複執行不會重複建立（提醒、紀錄、活動都有去重），最後才寫成交與案件狀態，
   * 所以中途失敗時再按一次即可補完。
   */
  const confirmDelivery = useCallback(async ({ dealId, date = today() }) => {
    const deal = await db.get('deals', dealId);
    if (!deal) throw new Error('找不到這筆成交，無法確認交車。');
    const allCases = (await db.getAll('cases').catch(() => [])).filter((row) => !row.deletedAt);
    const caseItem = allCases.find((row) => row.id === deal.caseId || row.dealId === deal.id) || null;
    const client = clientsRef.current.find((row) => row.id === deal.clientId) || null;
    const pricing = await db.get('pricingRecords', `deal:${deal.id}`).catch(() => null);
    const isPurchase = caseItem ? caseItem.type !== 'modification' : (pricing?.lines || []).some((line) => line.kind === 'vehicle');
    const stamp = new Date().toISOString();

    // 1) 交車後不再自動建立任何回訪或年度提醒（使用者決定，2026-11-12）；需要時在案件手動加待辦。
    const createdTimers = [];

    // 2) 收掉成交前的自動待辦（標記完成，不刪除）
    if (caseItem) {
      const [workItems, tasks] = await Promise.all([db.getAll('workItems').catch(() => []), db.getAll('tasks').catch(() => [])]);
      const toClose = selectPreSaleItemsToClose({ caseId: caseItem.id, deal, workItems, tasks, clients: clientsRef.current });
      for (const row of workItems.filter((item) => toClose.workItems.includes(item.id))) {
        const next = { ...row, state: 'done', completedAt: stamp, autoClosedBy: 'delivery', updatedAt: stamp };
        await db.put('workItems', next);
        dispatch({ type: 'UPSERT_WORK_ITEM', payload: next });
      }
      for (const row of tasks.filter((item) => toClose.tasks.includes(item.id))) {
        const next = { ...row, done: true, doneAt: stamp, autoClosedBy: 'delivery' };
        await db.put('tasks', next);
        dispatch({ type: 'UPSERT_TASK', payload: next });
      }
      for (const clientId of new Set(toClose.clientTodos.map((row) => row.clientId))) {
        const ids = new Set(toClose.clientTodos.filter((row) => row.clientId === clientId).map((row) => row.todoId));
        await updateClient(clientId, (c) => ({ ...c, todos: (c.todos || []).map((todo) => ids.has(todo.id) ? { ...todo, done: true, doneAt: stamp } : todo) }));
      }
    }

    // 3) 客戶：交車紀錄、階段改「售後」、清掉舊的追蹤日與預計交車日
    if (client) {
      const logId = `log:delivery:${deal.id}`;
      const afterSales = state.stages.find((item) => item.name === '售後');
      await updateClient(client.id, (c) => ({
        ...c, lastContact: date, missedCalls: 0,
        log: (c.log || []).some((entry) => entry.id === logId) ? c.log
          : [...(c.log || []), { id: logId, date, type: 'delivery', text: '交車' }],
        ...(afterSales ? { stageId: afterSales.id } : {}),
        nextDate: '', deliveryDate: '',
      }));
    }
    const activity = {
      id: `activity:delivery:${deal.id}`, clientId: deal.clientId || null, caseId: caseItem?.id || deal.caseId || null,
      type: 'delivery', text: `確認交車${isPurchase ? `並認列 ${dayjs(date).format('YYYY 年 M 月')}薪資` : ''}`, date, createdAt: stamp, updatedAt: stamp,
    };
    await db.put('activities', activity);
    dispatch({ type: 'UPSERT_ACTIVITY', payload: activity });

    // 4) 最後才寫成交與案件狀態（畫面上的「已交車」以這兩筆為準）
    const flow = planDeliveryCompletion(normalizeDeliveryWorkflowSafe(deal), stamp);
    const nextDeal = {
      ...deal, deliveryWorkflow: flow.workflow, deliveryWorkflowUpdatedAt: stamp,
      deliveredAt: deal.deliveredAt || date,
      ...(isPurchase ? { commissionRecognizedAt: deal.commissionRecognizedAt || date } : {}),
      updatedAt: stamp,
    };
    await db.put('deals', nextDeal);
    dispatch({ type: 'UPSERT_DEAL', payload: nextDeal });
    let nextCase = null;
    if (caseItem) {
      nextCase = {
        ...advanceCasePipeline(caseItem, 'completed', stamp), dealId: deal.id, status: 'completed',
        nextFollowUpDate: '', followUpPlanMode: null, completedAt: caseItem.completedAt || stamp, updatedAt: stamp,
      };
      casesRef.current = [...casesRef.current.filter((row) => row.id !== nextCase.id), nextCase];
      await db.put('cases', nextCase);
      dispatch({ type: 'UPSERT_CASE', payload: nextCase });
    }
    return { deal: nextDeal, caseItem: nextCase, createdTimers, skipped: flow.skipped };
  }, [updateClient, state.stages]);

  // ── Full reload (after import) ────────────────────────────────────────────
  const reloadAll = useCallback(async () => {
    const [clients, cats, stages, customFields, deals, dealFields, pricingRecords, quoteDrafts, receptionSessions, suppliers, cases, workItems, activities, tasks, events, timers, thresholdRow, templateRow, presetsRow, costCatalogRow, customPricingHistoryRow, industriesRow, heightConfigRow, caseNumberSequenceRow] = await Promise.all([
      db.getAll('clients'),
      db.getAll('cats'),
      db.getAll('stages'),
      db.getAll('customFields'),
      db.getAll('deals'),
      db.getAll('dealFields'),
      db.getAll('pricingRecords'),
      db.getAll('quoteDrafts'),
      db.getAll('receptionSessions'),
      db.getAll('suppliers'),
      db.getAll('cases'),
      db.getAll('workItems'),
      db.getAll('activities'),
      db.getAll('tasks'),
      db.getAll('events'),
      db.getAll('timers'),
      db.get('settings', 'crmThresholds').catch(() => null),
      db.get('settings', 'todoTemplate').catch(() => null),
      db.get('settings', 'quotePresets').catch(() => null),
      db.get('settings', 'costCatalog').catch(() => null),
      db.get('settings', 'customPricingHistory').catch(() => null),
      db.get('settings', 'industries').catch(() => null),
      db.get('settings', 'heightConfig').catch(() => null),
      db.get('settings', 'caseNumberSequence').catch(() => null),
    ]);
    const storedCustomPricingHistory = normalizeCustomItemHistory(customPricingHistoryRow?.entries);
    const resolvedCustomPricingHistory = customPricingHistoryRow?.legacyMigratedAt
      ? storedCustomPricingHistory : collectCustomItemHistory([
        { id: 'central-custom-pricing', customItemHistory: storedCustomPricingHistory },
        ...pricingRecords,
      ]);
    const canonical = await migrateLegacyQuotes(clients, quoteDrafts);
    const caseSeeds = buildLegacyCaseSeeds({ deals, quotes: canonical.quoteDrafts, clients: canonical.clients, existingCases: cases });
    for (const item of caseSeeds) await db.put('cases', item);
    const numberedCases = assignCaseNumbers([...cases, ...caseSeeds], caseNumberSequenceRow?.nextNumber);
    const changedCaseIds = new Set(numberedCases.changedIds);
    for (const item of numberedCases.cases) if (changedCaseIds.has(item.id)) await db.put('cases', item);
    caseNumberNextRef.current = numberedCases.nextNumber;
    const visibleCases = numberedCases.cases.filter((row) => !row.deletedAt);
    casesRef.current = visibleCases;
    await persistStartupMigrations({
      customPricingHistoryRow, resolvedCustomPricingHistory, caseNumberSequenceRow, nextNumber: numberedCases.nextNumber,
    });
    dispatch({
      type: 'RELOAD_ALL',
      payload: {
        clients: canonical.clients,
        cats: cats.length > 0 ? cats : DEFAULT_CATS,
        stages: stages.length > 0 ? stages : DEFAULT_STAGES,
        customFields,
        deals,
        dealFields: dealFields.length > 0 ? dealFields : DEFAULT_DEAL_FIELDS,
        pricingRecords,
        quoteDrafts: canonical.quoteDrafts,
        receptionSessions,
        suppliers,
        cases: visibleCases,
        deletedCases: numberedCases.cases.filter((row) => row.deletedAt),
        workItems,
        activities,
        tasks,
        events,
        timers,
        thresholds: thresholdRow ? normalizeThresholds(thresholdRow) : DEFAULT_THRESHOLDS,
        heightConfig: normalizeHeightConfig(heightConfigRow),
        todoTemplate: Array.isArray(templateRow?.items) ? templateRow.items : DEFAULT_TODO_TEMPLATE,
        quotePresets: resolveQuotePresets(presetsRow),
        costCatalog: normalizeCostCatalog(costCatalogRow),
        customPricingHistory: resolvedCustomPricingHistory,
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
    reassignClientRecords,
    saveCats,
    saveStages,
    saveCustomFields,
    saveDeal,
    confirmQuoteDeal,
    deleteDeal,
    saveDealFields,
    savePricingRecord,
    deletePricingRecord,
    saveQuoteDraft,
    deleteQuoteDraft,
    archiveQuoteDraft,
    restoreQuoteDraft,
    saveReceptionSession,
    deleteReceptionSession,
    saveSupplier,
    deleteSupplier,
    saveCase,
    deleteCase,
    restoreCase,
    saveWorkItem,
    deleteWorkItem,
    saveActivity,
    deleteActivity,
    saveTask,
    deleteTask,
    saveEvent,
    deleteEvent,
    saveTodoTemplate,
    saveQuotePresets,
    saveCostCatalog,
    saveCustomPricingHistory,
    saveIndustries,
    saveThresholds,
    saveHeightConfig,
    saveTimer,
    deleteTimer,
    confirmDelivery,
    reloadAll,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
