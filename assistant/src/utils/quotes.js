/**
 * 報價唯一來源：quoteDrafts。
 * 舊版本曾把完整報價再複製進 client.quotes，容易造成兩份資料分岔。
 */
export function canonicalizeQuotes(clients = [], quoteDrafts = []) {
  const byId = new Map();
  for (const quote of quoteDrafts) {
    if (quote?.id) byId.set(quote.id, quote);
  }

  let migrated = false;
  // 只回報「真的變動」的資料，呼叫端只需寫回這些（不要整批重寫、重蓋 _ts）
  const changedClientIds = [];
  const addedQuoteIds = [];
  const nextClients = clients.map((client) => {
    for (const legacy of client.quotes || []) {
      if (!legacy?.id || byId.has(legacy.id)) continue;
      addedQuoteIds.push(legacy.id);
      byId.set(legacy.id, {
        ...legacy,
        clientId: legacy.clientId || client.id,
        customerName: legacy.customerName || client.name || '',
        customerPhone: legacy.customerPhone || client.phone || '',
        createdAt: legacy.createdAt || `${legacy.date || '1970-01-01'}T00:00:00.000Z`,
        updatedAt: legacy.updatedAt || legacy.createdAt || `${legacy.date || '1970-01-01'}T00:00:00.000Z`,
      });
      migrated = true;
    }
    if (!Object.prototype.hasOwnProperty.call(client, 'quotes')) return client;
    const next = { ...client };
    delete next.quotes;
    migrated = true;
    changedClientIds.push(client.id);
    return next;
  });

  return { clients: nextClients, quoteDrafts: [...byId.values()], migrated, changedClientIds, addedQuoteIds };
}

export function quotesForClient(quoteDrafts = [], clientId) {
  if (!clientId) return [];
  return quoteDrafts
    .filter((quote) => quote.clientId === clientId && !quote.archivedAt)
    .sort((a, b) => (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || ''));
}

export const UNASSIGNED_QUOTE_WARNING_DAYS = 30;
export const LINKED_QUOTE_STALE_DAYS = 90;

/** 報價年齡固定從建立日計算；修改內容不會把天數歸零。 */
export function getQuoteAgeDays(quote, now = new Date()) {
  const raw = quote?.createdAt || (quote?.date ? `${quote.date}T00:00:00` : '') || quote?.updatedAt;
  const startedAt = new Date(raw);
  const current = now instanceof Date ? now : new Date(now);
  if (!raw || Number.isNaN(startedAt.getTime()) || Number.isNaN(current.getTime())) return null;
  const elapsed = Math.max(0, current.getTime() - startedAt.getTime());
  return Math.floor(elapsed / 86400000) + 1;
}

export function getQuoteAttention(quote, now = new Date()) {
  const ageDays = getQuoteAgeDays(quote, now);
  const linked = Boolean(quote?.clientId);
  return {
    ageDays,
    linked,
    unassignedOverdue: !linked && ageDays != null && ageDays > UNASSIGNED_QUOTE_WARNING_DAYS,
    linkedStale: linked && ageDays != null && ageDays > LINKED_QUOTE_STALE_DAYS,
  };
}

// ── 報價 ↔ 案件歸屬 ───────────────────────────────────────────────────────
// 自動產生的案件只會有這些欄位；出現其他有值欄位（追蹤日、備註、急件…）就代表使用者動過，一律保留。
const AUTO_CASE_KEYS = new Set([
  'id', 'clientId', 'clientName', 'type', 'title', 'status', 'dealId', 'quoteIds', 'source',
  'createdAt', 'updatedAt', 'pipelineStage', 'pipelineStageUpdatedAt', 'pipelineStageHistory', 'caseNumber', '_ts',
]);

function isEmptyValue(value) {
  return value == null || value === '' || value === false || (Array.isArray(value) && value.length === 0);
}

function quoteCaseType(quote) {
  return quote?.excludeVehiclePrice ? 'modification' : 'purchase';
}

/** 案件是否被工作、紀錄、待辦、成交等使用者資料引用（傳入的任一陣列有 caseId 指向它）。 */
export function collectReferencedCaseIds(...lists) {
  const ids = new Set();
  for (const list of lists) for (const row of list || []) if (row?.caseId) ids.add(row.caseId);
  return ids;
}

/**
 * 「空殼案件」：舊版替沒有客戶的報價自動長出來的「未命名客戶」案件。
 * 只有同時符合下列條件才算，可以安全移除（報價本身不受影響）：
 * 系統自動 id／來源、沒有客戶與成交、仍是進行中、沒有任何使用者填寫的欄位、
 * 沒被工作／紀錄／待辦／成交引用，且裡面的報價都沒有客戶或已歸到別的案件。
 */
export function isGhostQuoteCase(caseItem, { quotes = [], referencedCaseIds = new Set() } = {}) {
  if (!caseItem || caseItem.deletedAt) return false;
  if (!String(caseItem.id || '').startsWith('case:quote:')) return false;
  if (!['legacy-quote', 'quote'].includes(caseItem.source)) return false;
  if (caseItem.clientId || caseItem.dealId) return false;
  if (caseItem.status && caseItem.status !== 'active') return false;
  if (referencedCaseIds.has(caseItem.id)) return false;
  for (const [key, value] of Object.entries(caseItem)) {
    if (!AUTO_CASE_KEYS.has(key) && !isEmptyValue(value)) return false;
  }
  const quoteMap = new Map(quotes.map((row) => [row.id, row]));
  return (caseItem.quoteIds || []).every((id) => {
    const quote = quoteMap.get(id);
    return !quote || !quote.clientId || (quote.caseId && quote.caseId !== caseItem.id);
  });
}

export function findGhostQuoteCases({ cases = [], quotes = [], referencedCaseIds = new Set() } = {}) {
  return cases.filter((row) => isGhostQuoteCase(row, { quotes, referencedCaseIds })).map((row) => row.id);
}

/**
 * 儲存報價時決定它歸在哪個案件（純函式，context.saveQuoteDraft 照結果寫入）。
 * - 沒有客戶的報價不建立案件。
 * - 有客戶：依序用指定案件（須同客戶）→ 原本所在的同客戶案件 → 該客戶唯一一筆同類型進行中案件 →
 *   原本的空殼案件（認領）→ 新建。
 * - 歸入既有客戶案件時不改它的標題／類型／客戶名稱。
 * - 報價離開的舊案件若因此變成空殼就列入刪除；有使用者資料的一律保留。
 * 回傳 { quote, caseRow, previousCase, deleteCaseIds }。
 */
export function planQuoteCaseLink({ quote, cases = [], quotes = [], referencedCaseIds = new Set(), now = new Date().toISOString() }) {
  const live = cases.filter((row) => !row.deletedAt);
  const type = quoteCaseType(quote);
  const previous = live.find((row) => (row.quoteIds || []).includes(quote.id)) || null;
  const otherQuotes = quotes.filter((row) => row.id !== quote.id);
  const result = { quote: { ...quote }, caseRow: null, previousCase: null, deleteCaseIds: [] };

  if (quote.caseArchivedAt) return result;

  if (quote.clientId) {
    const byId = quote.caseId ? live.find((row) => row.id === quote.caseId) : null;
    const candidates = live.filter((row) => row.clientId === quote.clientId && row.type === type && row.status !== 'completed');
    const linked = (byId && byId.clientId === quote.clientId ? byId : null)
      || (previous && previous.clientId === quote.clientId ? previous : null)
      || (candidates.length === 1 ? candidates[0] : null)
      || (previous && !previous.clientId ? previous : null);
    const ownedByClient = Boolean(linked?.clientId);
    const fallbackTitle = type === 'modification' ? '改裝報價' : '購車報價';
    result.caseRow = {
      ...(linked || {}),
      id: linked?.id || `case:quote:${quote.id}`,
      clientId: quote.clientId,
      clientName: (ownedByClient && linked.clientName) || quote.customerName || linked?.clientName || '未命名客戶',
      type: (ownedByClient && linked.type) || type,
      title: ownedByClient ? (linked.title || quote.model || fallbackTitle) : (quote.model || linked?.title || fallbackTitle),
      status: linked?.status || 'active',
      dealId: linked?.dealId || null,
      quoteIds: [...new Set([...(linked?.quoteIds || []), quote.id])],
      source: linked?.source || 'quote',
      createdAt: linked?.createdAt || quote.createdAt || now,
      updatedAt: now,
    };
    result.quote.caseId = result.caseRow.id;
  }

  if (previous && previous.id !== result.caseRow?.id) {
    const remaining = { ...previous, quoteIds: (previous.quoteIds || []).filter((id) => id !== quote.id), updatedAt: now };
    if (isGhostQuoteCase(remaining, { quotes: [...otherQuotes, result.quote], referencedCaseIds })) {
      result.deleteCaseIds.push(previous.id);
      if (!quote.clientId) result.quote.caseId = null;
    } else if (quote.clientId) {
      result.previousCase = remaining;
    } else {
      result.quote.caseId = previous.id; // 沒客戶但舊案件有使用者資料：保持原狀，不拆開
    }
  } else if (!quote.clientId) {
    result.quote.caseId = null;
  }
  return result;
}
