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
  const nextClients = clients.map((client) => {
    for (const legacy of client.quotes || []) {
      if (!legacy?.id || byId.has(legacy.id)) continue;
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
    return next;
  });

  return { clients: nextClients, quoteDrafts: [...byId.values()], migrated };
}

export function quotesForClient(quoteDrafts = [], clientId) {
  if (!clientId) return [];
  return quoteDrafts
    .filter((quote) => quote.clientId === clientId)
    .sort((a, b) => (b.updatedAt || b.date || '').localeCompare(a.updatedAt || a.date || ''));
}
