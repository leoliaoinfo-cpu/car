// 手機端完整流程：確認成交報價→逐案配件核對→中央點貨→工作頁提醒；含舊成交（僅 case.dealId 關聯）不被覆蓋。
// 執行：npm run preview -- --port 4173 後，mkdir -p /tmp/car-e2e && node e2e/stock-flow.mjs（需 playwright-core）
import { chromium } from 'playwright-core';
const S='/tmp/car-e2e';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage(); p.setDefaultTimeout(8000);
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
const fails=[]; const step=async(n,f)=>{try{await f();console.log('PASS',n);}catch(e){fails.push(n);console.log('FAIL',n,String(e).split('\n')[0]);}};
const DB='car_sales_assistant_v1';
const seed=()=>new Promise((res,rej)=>{const o=indexedDB.open('car_sales_assistant_v1');o.onsuccess=()=>{const db=o.result;
 const st=['clients','cases','quoteDrafts','deals','pricingRecords'].filter(n=>db.objectStoreNames.contains(n));
 const tx=db.transaction(st,'readwrite'); st.forEach(n=>tx.objectStore(n).clear());
 const d=(n)=>new Date(Date.now()+n*864e5).toISOString().slice(0,10); const now=new Date().toISOString();
 const cl=(id,name)=>tx.objectStore('clients').put({id,name,phone:'0912000'+id.length,catId:'cat-1',stageId:'stage-3',log:[],todos:[],createdAt:d(-5),_ts:Date.now()});
 cl('c1','測試新客'); cl('c2','舊成交客');
 const cs=(o)=>tx.objectStore('cases').put({type:'purchase',status:'active',createdAt:now,updatedAt:now,_ts:Date.now(),...o});
 cs({id:'cA',clientId:'c1',clientName:'測試新客',title:'KIA 單廂',caseNumber:1,quoteIds:['qA'],desiredDeliveryDate:d(3)});
 cs({id:'cB',clientId:'c2',clientName:'舊成交客',title:'KIA 雙廂',caseNumber:2,quoteIds:['qB'],dealId:'dOld',desiredDeliveryDate:d(20)});
 const q=(id,cid,caseId,name,items,total)=>tx.objectStore('quoteDrafts').put({id,clientId:cid,caseId,customerName:name,model:'KIA 卡旺',total,date:d(0),items,createdAt:now,updatedAt:now,_ts:Date.now()});
 q('qA','c1','cA','測試新客',[{id:'v',kind:'vehicle',name:'車輛售價',price:800000},{id:'a1',kind:'addon',name:'韓版後照鏡',price:0,gift:true,note:'黑色'},{id:'a2',kind:'addon',name:'客製帆布',price:20000,pending:true},{id:'f',kind:'other',name:'文件費',price:300}],820300);
 q('qB','c2','cB','舊成交客',[{id:'v',kind:'vehicle',name:'車輛售價',price:900000},{id:'b1',kind:'addon',name:'電動尾門',price:30000}],930000);
 tx.objectStore('deals').put({id:'dOld',clientId:'c2',clientName:'舊成交客',model:'KIA 雙廂',amount:900000,cost:845000,profit:55000,date:d(-10),createdAt:now,_ts:Date.now()});
 tx.oncomplete=()=>{db.close();res();};tx.onerror=()=>rej(tx.error);};o.onerror=()=>rej(o.error);});
const dump=(store)=>p.evaluate(({store})=>new Promise(r=>{const o=indexedDB.open('car_sales_assistant_v1');o.onsuccess=()=>{const db=o.result;const g=db.transaction(store).objectStore(store).getAll();g.onsuccess=()=>{db.close();r(g.result);};};}),{store});

await p.goto('http://localhost:4173/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1500);
await p.evaluate(seed); await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(1500);
await p.screenshot({path:`${S}/s0.png`});

const goQuotes=async()=>{await p.locator('nav').getByText('報價',{exact:true}).click();await p.waitForTimeout(700);};
await goQuotes();
await step('報價列表顯示兩張報價', async()=>{await p.locator('text=測試新客').first().waitFor();await p.locator('text=舊成交客').first().waitFor();await p.screenshot({path:`${S}/s2.png`,fullPage:true});});

await step('新案件：確認此報價成交（無警告彈窗異常）', async()=>{
  const card=p.locator('div:has(> div:has-text("測試新客"))').filter({has:p.locator('button:has-text("確認此報價成交")')}).first();
  await p.locator('button:has-text("確認此報價成交")').first().click();
  await p.locator('text=確認這張報價成交？').waitFor();
  await p.locator('text=仍有 1 項待廠商確認').waitFor();
  await p.screenshot({path:`${S}/s3.png`});
  await p.locator('button:has-text("確認成交")').last().click();
  await p.waitForTimeout(800);
  const deals=await dump('deals'); const d=deals.find(x=>x.quoteId==='qA');
  if(!d) throw new Error('沒建立成交');
  if(d.amount!==820300) throw new Error('成交價錯 '+d.amount);
  const names=d.stockItems.map(x=>x.name+':'+x.status).join('|');
  if(names!=='韓版後照鏡:todo|客製帆布:inquiry') throw new Error('核對表錯 '+names);
});

await step('舊成交案件：核對成交報價 → 原成交價/成本保留、不新增重複成交', async()=>{
  await p.locator('button:has-text("核對成交報價")').first().click();
  await p.locator('text=核對既有成交的報價').waitFor();
  await p.locator('text=既有成交價 NT$ 900,000 將保留').waitFor();
  await p.locator('button:has-text("確認成交")').last().click();
  await p.waitForTimeout(800);
  const deals=await dump('deals');
  if(deals.some(x=>x.id==='deal:quote:qB')) throw new Error('錯誤：另建了重複成交');
  const d=deals.find(x=>x.id==='dOld');
  if(d.quoteId!=='qB') throw new Error('舊成交未連結報價');
  if(d.amount!==900000||d.cost!==845000||d.profit!==55000) throw new Error('原價/成本被改 '+JSON.stringify([d.amount,d.cost,d.profit]));
  if(!d.pricingNeedsReview) throw new Error('未標記需核對');
  if(deals.length!==2) throw new Error('成交筆數應為2，實際'+deals.length);
});

// 案件頁：手機操作核對表
await p.locator('nav').getByText('案件',{exact:true}).click(); await p.waitForTimeout(700);
await step('案件列表顯示尚缺配件＋交車將近', async()=>{
  await p.locator('text=尚缺 2 項配件・交車將近').first().waitFor();
  await p.screenshot({path:`${S}/s4.png`,fullPage:true});
});
await step('中央點貨彙總尚缺配件', async()=>{
  await p.locator('text=中央配件點貨').click(); await p.waitForTimeout(500);
  await p.locator('text=韓版後照鏡').first().waitFor(); await p.locator('text=客製帆布').first().waitFor();
  await p.screenshot({path:`${S}/s5.png`,fullPage:true});
  await p.locator('text=返回案件列表').click();
});
await step('工作頁出現「交車將近，尚缺 2 項配件」提醒（核對前）', async()=>{
  await p.locator('nav').getByText('今天',{exact:true}).click(); await p.waitForTimeout(800);
  await p.locator('text=交車將近，尚缺 2 項配件').first().waitFor();
  await p.screenshot({path:`${S}/s8.png`,fullPage:true});
  await p.locator('nav').getByText('案件',{exact:true}).click(); await p.waitForTimeout(500);
});
await step('開案件→逐項核對：設再追日、標已備妥、警示解除', async()=>{
  await p.locator('text=測試新客').first().click(); await p.waitForTimeout(600);
  await p.locator('text=成交配件逐項核對').waitFor();
  await p.locator('text=尚缺 2 項').first().waitFor();
  await p.locator('text=待廠商確認，請設定再追日期').waitFor();
  const row=(n)=>p.locator('div.rounded-xl:has(> div p:has-text("'+n+'"))').first();
  // 客製帆布：打開折疊→設再追日
  // 再追日已直接露出，不必展開
  const fu=new Date(Date.now()+2*864e5).toISOString().slice(0,10);
  await p.locator('input[aria-label="客製帆布再追日期"]').fill(fu); await p.waitForTimeout(600);
  let d=(await dump('deals')).find(x=>x.quoteId==='qA');
  if(d.stockItems.find(x=>x.name==='客製帆布').followUpDate!==fu) throw new Error('再追日未存');
  await p.locator('text=待廠商確認，請設定再追日期').waitFor({state:'detached'});
  await p.screenshot({path:`${S}/s6.png`,fullPage:true});
  // 後照鏡：一鍵標已備妥；帆布改狀態為已備妥
  await row('韓版後照鏡').locator('button:has-text("備妥")').first().click(); await p.waitForTimeout(500);
  await p.locator('select[aria-label="客製帆布備品狀態"]').selectOption('ready'); await p.waitForTimeout(600);
  d=(await dump('deals')).find(x=>x.quoteId==='qA');
  if(!d.stockItems.every(x=>x.status==='ready')) throw new Error('未全部備妥 '+JSON.stringify(d.stockItems.map(x=>x.status)));
  await p.locator('text=已全部核對').first().waitFor();
  await p.screenshot({path:`${S}/s7.png`,fullPage:true});
});
await step('全部備妥後工作清單不再有該案件缺貨警示', async()=>{
  await p.locator('button:text-is("←")').last().click(); await p.waitForTimeout(400);
  await p.locator('nav').getByText('今天',{exact:true}).click(); await p.waitForTimeout(800);
  if(await p.locator('text=交車將近').count()) throw new Error('交車將近警示仍在');
  if(await p.locator('text=尚缺 2 項配件').count()) throw new Error('警示仍在');
  if(await p.locator('text=尚缺 1 項配件').count()) throw new Error('警示仍在(1)');
});
if(errs.length){fails.push('jserr');console.log('JSERR',errs[0]);}else console.log('PASS no-jserror');
await b.close(); console.log(fails.length?'FAILS: '+fails.join(', '):'ALL PASSED'); process.exit(fails.length?1:0);
