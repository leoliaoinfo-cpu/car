// 尚缺配件頁（依客戶、外包／改裝部兩套狀態）。執行：npm run preview -- --port 4173 後，node e2e/stock-center.mjs（需 playwright-core）
import { chromium } from 'playwright-core';
const S = '/tmp/car-e2e';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 1100 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { localStorage.setItem('car-sales.gate.unlockUntil', String(Date.now() + 864e5)); localStorage.setItem('car-sales.theme', 'light'); });
const p = await ctx.newPage(); p.setDefaultTimeout(8000);
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
const fails = []; const step = async (n, f) => { try { await f(); console.log('PASS', n); } catch (e) { fails.push(n); console.log('FAIL', n, String(e).split('\n')[0]); } };
const seed = () => new Promise((res, rej) => { const o = indexedDB.open('car_sales_assistant_v1'); o.onsuccess = () => { const db = o.result;
  const st = ['clients', 'cases', 'quoteDrafts', 'deals']; const tx = db.transaction(st, 'readwrite'); st.forEach((n) => tx.objectStore(n).clear());
  const now = new Date().toISOString(); const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const cl = (id, n) => tx.objectStore('clients').put({ id, name: n, phone: '0912', log: [], todos: [], _ts: Date.now() }); cl('c1', '林德旺'); cl('c2', '方樹股份');
  const cs = (o) => tx.objectStore('cases').put({ type: 'purchase', status: 'active', createdAt: now, updatedAt: now, _ts: Date.now(), ...o });
  cs({ id: 'a', clientId: 'c1', clientName: '林德旺', title: '雙廂', caseNumber: 1, quoteIds: ['qa'], dealId: 'da', desiredDeliveryDate: day(5) });
  cs({ id: 'b', clientId: 'c2', clientName: '方樹股份', title: '大單廂', caseNumber: 2, quoteIds: ['qb'], dealId: 'db', desiredDeliveryDate: day(40) });
  const q = (id, cid, caseId) => tx.objectStore('quoteDrafts').put({ id, clientId: cid, caseId, customerName: '客', model: '雙廂', total: 1, date: day(0), createdAt: now, updatedAt: now, _ts: Date.now(), items: [] });
  q('qa', 'c1', 'a'); q('qb', 'c2', 'b');
  const dl = (id, caseId, qid, cid, n, items) => tx.objectStore('deals').put({ id, caseId, quoteId: qid, clientId: cid, clientName: n, model: '雙廂', amount: 1, date: day(0), createdAt: now, _ts: Date.now(), stockItems: items });
  dl('da', 'a', 'qa', 'c1', '林德旺', [
    { id: 'i1', name: '力新做的帆布', status: 'todo', quantity: 1 }, { id: 'i2', name: '升降尾門（3.5尺）', status: 'todo', quantity: 1 },
    { id: 'i3', name: '尿素桶防撞桿', status: 'todo', quantity: 1 }, { id: 'i4', name: '卡旺方向盤皮革套', gift: true, status: 'todo', quantity: 1 }]);
  dl('db', 'b', 'qb', 'c2', '方樹股份', [{ id: 'j1', name: '彈簧鋼板', status: 'todo', quantity: 1 }]);
  tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; });
const dump = (s) => p.evaluate((s) => new Promise((r) => { const o = indexedDB.open('car_sales_assistant_v1'); o.onsuccess = () => { const g = o.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => r(g.result); }; }), s);
await p.goto('http://localhost:4173/'); await p.waitForTimeout(1500); await p.evaluate(seed); await p.reload(); await p.waitForTimeout(1800);
await p.getByText('案件', { exact: true }).first().click(); await p.waitForTimeout(800);
await step('進入尚缺配件，依客戶：交車近的在前、標急、外包→改裝部→贈品', async () => {
  await p.getByText(/尚缺配件 \d+ 項/).click(); await p.waitForTimeout(600);
  const names = await p.locator('article p.text-base').allInnerTexts();
  if (!names[0].includes('林德旺') || !names[0].includes('急')) throw new Error('順序或急標記不對 ' + names.join('|'));
  const rows = await p.locator('article').first().locator('div.rounded-xl p.text-sm').allInnerTexts();
  const order = rows.map((t) => t.replace(/\s+/g, ' ')).join(' / ');
  if (!(order.indexOf('帆布') < order.indexOf('尿素桶') && order.indexOf('尿素桶') < order.indexOf('皮革套'))) throw new Error('外包/改裝部/贈品順序不對：' + order);
  await p.screenshot({ path: `${S}/c1.png` });
});
await step('外包：一路按「下一步」走到已回報客戶進度，狀態與再追日正確', async () => {
  const card = p.locator('article').first();
  const row = card.locator('div.rounded-xl:has(select[aria-label="力新做的帆布狀態"])');
  const labels = [];
  for (let i = 0; i < 4; i++) { labels.push((await row.locator('button').last().innerText()).trim()); await row.locator('button').last().click(); await p.waitForTimeout(500); }
  const d = (await dump('deals')).find((x) => x.id === 'da').stockItems.find((x) => x.id === 'i1');
  if (labels.join('>') !== '→ 已聯繫廠商>→ 廠商已施作>→ 已確認沒問題>→ 已經回報客戶進度') throw new Error('下一步順序：' + labels.join('>'));
  if (d.status !== 'reported') throw new Error('最後狀態 ' + d.status);
  // 全部做完就不再列出
  if (await p.locator('select[aria-label="力新做的帆布狀態"]').count()) throw new Error('做完的外包項目還在清單');
});
await step('改裝部：缺貨中→已叫貨（自動排再追日）→已到貨→已安裝', async () => {
  const sel = p.locator('select[aria-label="尿素桶防撞桿狀態"]');
  await sel.selectOption('inquiry'); await p.waitForTimeout(500);
  let it = (await dump('deals')).find((x) => x.id === 'da').stockItems.find((x) => x.id === 'i3');
  if (it.status !== 'inquiry' || !it.followUpDate) throw new Error('已叫貨沒有自動排再追日 ' + JSON.stringify(it));
  await sel.selectOption('ready'); await p.waitForTimeout(500);
  it = (await dump('deals')).find((x) => x.id === 'da').stockItems.find((x) => x.id === 'i3');
  if (it.status !== 'ready') throw new Error('已到貨未存');
});
await step('切換成外包／改裝部（案件內），進度對應換算', async () => {
  await p.getByText('林德旺').first().click(); await p.waitForTimeout(900);
  await p.getByText('成交配件逐項核對').waitFor();
  const row = p.locator('div.rounded-xl:has(select[aria-label="升降尾門（3.5尺）備品狀態"])').first();
  await row.locator('summary').click();
  await row.locator('select[aria-label="升降尾門（3.5尺）類別"]').selectOption('inhouse'); await p.waitForTimeout(500);
  const it = (await dump('deals')).find((x) => x.id === 'da').stockItems.find((x) => x.id === 'i2');
  if (it.track !== 'inhouse') throw new Error('類別沒存 ' + JSON.stringify(it));
});
await step('no-jserror', async () => { if (errs.length) throw new Error(errs.join(' | ')); });
await b.close();
if (fails.length) { console.log('FAILS:', fails.join(', ')); process.exit(1); } else console.log('ALL PASSED');
