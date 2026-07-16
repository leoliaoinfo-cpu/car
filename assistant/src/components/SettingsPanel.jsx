import { useState, useRef } from 'react';
import { db, downloadJSON } from '../db';
import { useApp } from '../context';
import { CAT_COLORS, FIELD_COLORS, FIELD_COLOR_NAMES, generateId } from '../utils/crm';

const HELP_CARDS = [
  { icon: '☀️', title: '今日工作', desc: '一眼看完今日/逾期追蹤、到期提醒與即將簽約客戶，點擊可直接開啟客戶。' },
  { icon: '📅', title: '行事曆', desc: '月曆總覽追蹤、提醒與成交事件；點日期看當天清單，點事件直接跳到該客戶。' },
  { icon: '🌙', title: '莫蘭迪主題', desc: '低彩度藍灰色調，預設深色，可在設定右上角切換深/淺色，選擇會記在此裝置。' },
  { icon: '🎉', title: '紀念日提醒', desc: '日期型自訂欄位可設每年/一次性/連續N年提醒，到期出現在今日工作（依欄位分組）與行事曆。' },
  { icon: '🧾', title: '商用車報價器', desc: '一鍵帶入車體配備與補助折抵（選單可自訂），貸款試算月付金並對比每月營收算出淨賺；存檔後可隨時編輯。' },
  { icon: '🏢', title: '公司戶/轉介紹', desc: '客戶分個人/公司戶（統編）、產業標籤、多聯絡人；轉介紹記錄誰介紹誰與介紹金。' },
  { icon: '📋', title: '中央待辦', desc: '今日工作頁直接新增/勾銷雜事待辦；各客戶簽約前待辦也集中在「客戶待辦」區逐一處理。範本可在「待辦範本」編輯。' },
  { icon: '📊', title: '本日成果', desc: '自動統計今天記錄的聯繫、報價、試乘、下訂、交車數量與金額，不需手動填寫日報。' },
  { icon: '👥', title: '客戶追蹤 CRM', desc: '管理所有客戶聯繫狀態、分類、意願度與追蹤日期。' },
  { icon: '🚛', title: '業務進度記錄', desc: '在客戶詳情記錄 LINE 摘要、報價、看車試乘、貸款補件、下訂、交車、售後回訪；記錄交車會自動建立 3/7/30 天回訪提醒。' },
  { icon: '📌', title: '即將簽約', desc: '置頂重點客戶，可寫重點備註並管理簽約前待辦清單。' },
  { icon: '📈', title: '業績表', desc: '客戶成交後按「成交歸檔」帶入當月業績，單月細項與成交總表自動加總成交金額、保險金額、收入等（欄位可自訂）。' },
  { icon: '💡', title: '客戶狀態', desc: '🟢追蹤中 / 🟡待聯繫（到期）/ 🟠久未聯繫 / 🔴冷掉了。天數門檻可在「追蹤規則」調整（預設 180 / 365 天）。' },
  { icon: '⏰', title: '計時提醒', desc: '可在客戶詳情頁設定提醒，到期後強制彈出 Modal 確認。' },
  { icon: '💾', title: '備份與還原', desc: '下載 JSON 備份所有資料，或上傳 JSON 檔案進行還原。超過 7 天未備份會在今日工作頁提醒。' },
  { icon: '📦', title: '舊版資料匯入', desc: '支援匯入舊版格式 { _v:1, crm, jnl, sal } 的 JSON 備份。' },
];

const SECTION_KEYS = ['backup', 'cats', 'stages', 'fields', 'dealFields', 'template', 'quoteMenu', 'rules', 'help'];
const SECTION_LABELS = {
  backup: '💾 備份還原',
  cats: '🏷 客戶分類',
  stages: '📶 業務進度',
  fields: '✏️ 自訂欄位',
  dealFields: '🏆 業績欄位',
  template: '📋 待辦範本',
  quoteMenu: '🚚 報價選單',
  rules: '⏱ 追蹤規則',
  help: '📖 使用說明',
};

// 檢查備份格式並產生摘要；格式不對會 throw
function summarizeBackup(data) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('無法辨識的備份格式');
  }
  if (data._v === 1) {
    if (!data.crm && !data.jnl && !data.sal) throw new Error('舊版備份缺少 crm / jnl / sal 資料');
    return {
      version: 'v1（舊版）',
      clients: data.crm?.clients?.length ?? 0,
      journal: Array.isArray(data.jnl) ? data.jnl.length : Object.keys(data.jnl || {}).length,
      salary: Array.isArray(data.sal) ? data.sal.length : Object.keys(data.sal || {}).length,
      timers: 0,
    };
  }
  if (data._v === 2 && Array.isArray(data.clients)) {
    return {
      version: 'v2',
      exportedAt: data.exportedAt,
      clients: data.clients.length,
      deals: (data.deals || []).length,
      journal: (data.journalEntries || []).length + (data.archivedJournal || []).length,
      salary: (data.salaryMonths || []).length,
      timers: (data.timers || []).length,
    };
  }
  throw new Error('無法辨識的備份格式（僅支援本系統匯出的 JSON）');
}

export default function SettingsPanel({ onClose }) {
  const {
    cats, stages, customFields, dealFields, thresholds, todoTemplate, quotePresets,
    saveCats, saveStages, saveCustomFields, saveDealFields, saveThresholds,
    saveTodoTemplate, saveQuotePresets, reloadAll,
  } = useApp();
  const [activeSection, setActiveSection] = useState('backup');
  const [status, setStatus] = useState('');
  const [pendingImport, setPendingImport] = useState(null); // { data, summary }
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; }
  });

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('theme', next); } catch { /* 隱私模式忽略 */ }
    document.documentElement.classList.toggle('dark', next === 'dark');
  }
  const fileRef = useRef(null);
  const legacyRef = useRef(null);

  // ── Backup/Restore ──────────────────────────────────────────────────────
  async function handleExport() {
    try {
      await db.exportAndDownload();
      setStatus('✅ 備份下載成功');
    } catch (e) {
      setStatus('❌ 備份失敗：' + e.message);
    }
  }

  // 第一步：選檔後只檢查格式、顯示摘要，等使用者確認
  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const summary = summarizeBackup(data);
      setPendingImport({ data, summary });
      setStatus('');
    } catch (err) {
      setPendingImport(null);
      setStatus('❌ 無法讀取備份：' + err.message);
    }
    e.target.value = '';
  }

  // 第二步：確認後先自動下載目前資料備份，再覆蓋還原
  async function confirmImport() {
    if (!pendingImport) return;
    try {
      const current = await db.exportAll();
      downloadJSON(current, `pre-restore-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
      const { data } = pendingImport;
      if (data._v === 1) await db.importLegacy(data);
      else await db.importAll(data);
      await reloadAll();
      setPendingImport(null);
      setStatus('✅ 還原成功，已重新載入資料（原資料已自動下載備份）');
    } catch (err) {
      setStatus('❌ 還原失敗：' + err.message);
    }
  }

  async function handleLegacyImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await db.importLegacy(data);
      await reloadAll();
      setStatus('✅ 舊版資料匯入成功');
    } catch (err) {
      setStatus('❌ 舊版匯入失敗：' + err.message);
    }
    e.target.value = '';
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-s1 border-l border-bdr shadow-panel z-50 flex flex-col anim-slide-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bdr shrink-0">
          <h2 className="font-bold text-lg text-ink">⚙️ 設定</h2>
          <div className="flex items-center gap-1.5">
            <button onClick={toggleTheme} className="btn-outline text-xs" title="切換深/淺色主題">
              {theme === 'dark' ? '🌙 深色' : '☀️ 淺色'}
            </button>
            <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1">✕</button>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-0.5 px-3 py-2 border-b border-bdr overflow-x-auto shrink-0">
          {SECTION_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setActiveSection(k)}
              className={`flex-none text-xs px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
                activeSection === k ? 'bg-accent/10 text-accent' : 'text-ink-3 hover:bg-s3'
              }`}
            >
              {SECTION_LABELS[k]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ── Backup ── */}
          {activeSection === 'backup' && (
            <section className="space-y-4">
              <div className="card p-4 space-y-3">
                <h3 className="font-semibold text-ink">備份與還原</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleExport} className="btn-primary">⬇️ 下載備份 (.json)</button>
                  <button onClick={() => fileRef.current?.click()} className="btn-outline">⬆️ 上傳還原</button>
                  <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
                </div>
                <p className="text-xs text-ink-3">還原前會自動下載目前資料的備份，再覆蓋現有所有資料。</p>
                {pendingImport && (
                  <div className="bg-s2 border border-accent/30 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-medium text-ink">確認還原這份備份？</p>
                    <ul className="text-xs text-ink-2 space-y-0.5">
                      <li>格式：{pendingImport.summary.version}</li>
                      {pendingImport.summary.exportedAt && (
                        <li>匯出時間：{pendingImport.summary.exportedAt.slice(0, 16).replace('T', ' ')}</li>
                      )}
                      <li>客戶：{pendingImport.summary.clients} 筆</li>
                      <li>成交：{pendingImport.summary.deals || 0} 筆</li>
                      <li>提醒：{pendingImport.summary.timers} 筆</li>
                    </ul>
                    <p className="text-xs text-danger">⚠️ 還原會完整覆蓋目前資料（會先自動下載目前資料備份）</p>
                    <div className="flex gap-2">
                      <button onClick={confirmImport} className="btn-danger text-xs flex-1">確認還原</button>
                      <button onClick={() => setPendingImport(null)} className="btn-outline text-xs flex-1">取消</button>
                    </div>
                  </div>
                )}
                {status && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{status}</p>}
              </div>
              <div className="card p-4 space-y-3">
                <h3 className="font-semibold text-ink text-sm">舊版資料匯入（v1 格式）</h3>
                <button onClick={() => legacyRef.current?.click()} className="btn-outline text-sm">匯入舊版 JSON</button>
                <input ref={legacyRef} type="file" accept=".json" className="hidden" onChange={handleLegacyImport} />
                <p className="text-xs text-ink-3">支援格式：{'{ _v:1, crm, jnl, sal }'}</p>
              </div>
            </section>
          )}

          {/* ── Cats ── */}
          {activeSection === 'cats' && (
            <ListEditor
              title="客戶分類"
              items={cats}
              colors={CAT_COLORS}
              colorCount={7}
              onChange={saveCats}
            />
          )}

          {/* ── Stages ── */}
          {activeSection === 'stages' && (
            <ListEditor
              title="業務進度"
              items={stages}
              colors={CAT_COLORS}
              colorCount={7}
              onChange={saveStages}
            />
          )}

          {/* ── Custom Fields ── */}
          {activeSection === 'fields' && (
            <CustomFieldEditor
              fields={customFields}
              onChange={saveCustomFields}
            />
          )}

          {/* ── Deal fields ── */}
          {activeSection === 'dealFields' && (
            <div className="space-y-3">
              <p className="text-xs text-ink-3 px-1">
                成交歸檔時可填的金額欄位（例如保險金額、收入），業績表會逐欄自動加總。「成交金額」為內建欄位不需新增。
              </p>
              <ListEditor
                title="業績欄位"
                items={dealFields}
                colors={FIELD_COLORS}
                colorCount={FIELD_COLORS.length}
                onChange={saveDealFields}
                newLabel="新欄位"
              />
            </div>
          )}

          {/* ── Todo template ── */}
          {activeSection === 'template' && (
            <TodoTemplateEditor items={todoTemplate} onChange={saveTodoTemplate} />
          )}

          {/* ── Quote presets ── */}
          {activeSection === 'quoteMenu' && (
            <div className="space-y-5">
              <PresetEditor
                title="🚚 車體配備選單"
                desc="報價單一鍵帶入的車體/配件（框式、篷式、冷凍廂、尾門…），價格可改。"
                items={quotePresets.addons}
                newName="新配備"
                onChange={(addons) => saveQuotePresets({ ...quotePresets, addons })}
              />
              <PresetEditor
                title="🏛 補助折抵選單"
                desc="報價單一鍵帶入的折抵項（汰舊換新、貨物稅減免…），以負數扣抵總價。"
                items={quotePresets.subsidies}
                newName="新補助"
                amountKey="amount"
                onChange={(subsidies) => saveQuotePresets({ ...quotePresets, subsidies })}
              />
            </div>
          )}

          {/* ── Rules ── */}
          {activeSection === 'rules' && (
            <ThresholdEditor thresholds={thresholds} onSave={saveThresholds} />
          )}

          {/* ── Help ── */}
          {activeSection === 'help' && (
            <div className="space-y-3">
              {HELP_CARDS.map((c, i) => (
                <div key={i} className="card p-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5">{c.icon}</span>
                    <div>
                      <p className="font-medium text-sm text-ink">{c.title}</p>
                      <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">{c.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-center text-xs text-ink-3 py-2">汽車銷售業務系統 v2.2 • 純單機版</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── PresetEditor（報價選單：車體配備 / 補助折抵，名稱＋金額）──────────────────
function PresetEditor({ title, desc, items, newName, amountKey = 'price', onChange }) {
  function update(id, patch) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function remove(id) {
    onChange(items.filter((it) => it.id !== id));
  }
  function add() {
    onChange([...items, { id: generateId('preset'), name: newName, [amountKey]: 0 }]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-ink text-sm">{title}</h3>
          <p className="text-xs text-ink-3 mt-0.5">{desc}</p>
        </div>
        <button onClick={add} className="btn-primary text-xs shrink-0">+ 新增</button>
      </div>
      {items.length === 0 && <p className="text-center text-ink-3 text-sm py-4">尚無項目</p>}
      {items.map((it) => (
        <div key={it.id} className="card p-3 flex items-center gap-2">
          <input
            value={it.name}
            onChange={(e) => update(it.id, { name: e.target.value })}
            className="flex-1 text-sm min-w-0"
          />
          <input
            type="number" min="0"
            value={it[amountKey] ?? 0}
            onChange={(e) => update(it.id, { [amountKey]: Number(e.target.value) || 0 })}
            className="w-28 text-sm shrink-0"
          />
          <button onClick={() => remove(it.id)} className="text-danger/50 hover:text-danger text-sm shrink-0">✕</button>
        </div>
      ))}
    </div>
  );
}

// ── TodoTemplateEditor（交車待辦範本，客戶詳情一鍵套用）───────────────────────
function TodoTemplateEditor({ items, onChange }) {
  function updateItem(idx, text) {
    onChange(items.map((s, i) => (i === idx ? text : s)));
  }
  function removeItem(idx) {
    onChange(items.filter((_, i) => i !== idx));
  }
  function moveItem(idx, dir) {
    const next = [...items];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  }
  function addItem() {
    onChange([...items, '新待辦項目']);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-ink">待辦範本</h3>
          <p className="text-xs text-ink-3 mt-0.5">客戶詳情「套用交車待辦範本」帶入的項目，可自行增減修改。</p>
        </div>
        <button onClick={addItem} className="btn-primary text-xs">+ 新增</button>
      </div>
      {items.length === 0 && (
        <p className="text-center text-ink-3 text-sm py-6">尚無範本項目</p>
      )}
      {items.map((text, idx) => (
        <div key={idx} className="card p-3 flex items-center gap-2">
          <span className="text-ink-3 text-xs w-5 shrink-0">{idx + 1}.</span>
          <input
            value={text}
            onChange={(e) => updateItem(idx, e.target.value)}
            className="flex-1 text-sm min-w-0"
          />
          <button onClick={() => moveItem(idx, -1)} disabled={idx === 0}
            className="text-ink-3 hover:text-ink disabled:opacity-20 text-xs px-1">↑</button>
          <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1}
            className="text-ink-3 hover:text-ink disabled:opacity-20 text-xs px-1">↓</button>
          <button onClick={() => removeItem(idx)} className="text-danger/50 hover:text-danger text-sm ml-1">✕</button>
        </div>
      ))}
    </div>
  );
}

// ── ThresholdEditor（追蹤規則天數）────────────────────────────────────────────
function ThresholdEditor({ thresholds, onSave }) {
  const [coldDays, setColdDays] = useState(String(thresholds.coldDays));
  const [deadDays, setDeadDays] = useState(String(thresholds.deadDays));
  const [saved, setSaved] = useState('');

  async function commit() {
    const clean = await onSave({ coldDays, deadDays });
    // 回填清理後的值（例如冷掉天數被自動抬高到不低於久未聯繫天數）
    setColdDays(String(clean.coldDays));
    setDeadDays(String(clean.deadDays));
    setSaved(`✅ 已儲存：${clean.coldDays} 天未聯繫 → 久未聯繫；${clean.deadDays} 天 → 冷掉了`);
  }

  return (
    <div className="card p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-ink">追蹤規則</h3>
        <p className="text-xs text-ink-3 mt-1 leading-relaxed">
          超過天數未聯繫的客戶會標示警示色，並列入「冷掉了」篩選與今日工作的「久未聯繫」統計。
          從未聯繫過的客戶，以建檔日起算。
        </p>
      </div>

      <label className="flex items-center gap-3 text-sm text-ink-2">
        <span className="w-32 shrink-0">🟠 久未聯繫（天）</span>
        <input
          type="number" min="1" value={coldDays}
          onChange={(e) => setColdDays(e.target.value)}
          className="w-24 text-sm"
        />
      </label>

      <label className="flex items-center gap-3 text-sm text-ink-2">
        <span className="w-32 shrink-0">🔴 冷掉了（天）</span>
        <input
          type="number" min="1" value={deadDays}
          onChange={(e) => setDeadDays(e.target.value)}
          className="w-24 text-sm"
        />
      </label>

      <p className="text-xs text-ink-3">「冷掉了」天數不會低於「久未聯繫」天數，儲存時會自動修正。</p>

      <button onClick={commit} className="btn-primary text-sm">儲存規則</button>
      {saved && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{saved}</p>}
    </div>
  );
}

// ── ListEditor (shared for cats & stages) ────────────────────────────────────
function ListEditor({ title, items, colors, colorCount, onChange, newLabel = '新分類' }) {
  const sorted = [...items].sort((a, b) => a.order - b.order);

  function addItem() {
    const newItem = { id: generateId('item'), name: newLabel, colorIdx: 0, order: sorted.length };
    onChange([...items, newItem]);
  }

  function updateItem(id, patch) {
    onChange(items.map((it) => it.id === id ? { ...it, ...patch } : it));
  }

  function deleteItem(id) {
    onChange(items.filter((it) => it.id !== id));
  }

  function moveItem(id, dir) {
    const list = sorted.map((it) => ({ ...it }));
    const idx = list.findIndex((it) => it.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    [list[idx].order, list[swapIdx].order] = [list[swapIdx].order, list[idx].order];
    onChange(list);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink">{title}</h3>
        <button onClick={addItem} className="btn-primary text-xs">+ 新增</button>
      </div>
      {sorted.length === 0 && (
        <p className="text-center text-ink-3 text-sm py-6">尚無項目</p>
      )}
      {sorted.map((item, idx) => (
        <div key={item.id} className="card p-3 flex items-center gap-2">
          {/* Color picker */}
          <div className="relative">
            <div
              className="w-5 h-5 rounded-full border-2 border-white shadow cursor-pointer shrink-0"
              style={{ background: colors[item.colorIdx % colorCount] }}
            />
            <select
              value={item.colorIdx}
              onChange={(e) => updateItem(item.id, { colorIdx: Number(e.target.value) })}
              className="absolute inset-0 opacity-0 cursor-pointer w-full"
            >
              {Array.from({ length: colorCount }, (_, i) => (
                <option key={i} value={i}>色 {i + 1}</option>
              ))}
            </select>
          </div>

          <input
            value={item.name}
            onChange={(e) => updateItem(item.id, { name: e.target.value })}
            className="flex-1 text-sm"
          />

          {/* Order buttons */}
          <button onClick={() => moveItem(item.id, -1)} disabled={idx === 0}
            className="text-ink-3 hover:text-ink disabled:opacity-20 text-xs px-1">↑</button>
          <button onClick={() => moveItem(item.id, 1)} disabled={idx === sorted.length - 1}
            className="text-ink-3 hover:text-ink disabled:opacity-20 text-xs px-1">↓</button>

          <button onClick={() => deleteItem(item.id)} className="text-danger/50 hover:text-danger text-sm ml-1">✕</button>
        </div>
      ))}
    </div>
  );
}

// ── CustomFieldEditor ─────────────────────────────────────────────────────────
function CustomFieldEditor({ fields, onChange }) {
  function addField() {
    const newField = { id: generateId('field'), name: '新欄位', type: 'text', colorIdx: 0 };
    onChange([...fields, newField]);
  }

  function updateField(id, patch) {
    onChange(fields.map((f) => f.id === id ? { ...f, ...patch } : f));
  }

  function deleteField(id) {
    onChange(fields.filter((f) => f.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-ink">自訂欄位</h3>
          <p className="text-xs text-ink-3 mt-0.5">會顯示在每個客戶的詳情頁中</p>
        </div>
        <button onClick={addField} className="btn-primary text-xs">+ 新增</button>
      </div>

      {fields.length === 0 && (
        <p className="text-center text-ink-3 text-sm py-6">尚無自訂欄位</p>
      )}

      {fields.map((field) => (
        <div key={field.id} className="card p-3 space-y-2">
          <div className="flex items-center gap-2">
            {/* Color picker */}
            <div className="relative shrink-0">
              <div
                className="w-5 h-5 rounded-full border-2 border-white shadow cursor-pointer"
                style={{ background: FIELD_COLORS[field.colorIdx || 0] }}
              />
              <select
                value={field.colorIdx || 0}
                onChange={(e) => updateField(field.id, { colorIdx: Number(e.target.value) })}
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
              >
                {FIELD_COLORS.map((c, i) => (
                  <option key={i} value={i}>{FIELD_COLOR_NAMES[i]}</option>
                ))}
              </select>
            </div>
            <input
              value={field.name}
              onChange={(e) => updateField(field.id, { name: e.target.value })}
              placeholder="欄位名稱"
              className="flex-1 text-sm"
            />
            <select
              value={field.type || 'text'}
              onChange={(e) => updateField(field.id, { type: e.target.value })}
              className="text-xs py-1 w-20"
            >
              <option value="text">文字</option>
              <option value="number">數字</option>
              <option value="date">日期</option>
            </select>
            <button onClick={() => deleteField(field.id)} className="text-danger/50 hover:text-danger text-sm shrink-0">✕</button>
          </div>

          {/* 日期欄位的紀念日提醒設定（生日、交車週年…） */}
          {field.type === 'date' && (
            <div className="flex items-center gap-2 text-xs text-ink-2 pl-7 flex-wrap">
              <span className="shrink-0">🔔 提醒：</span>
              <select
                value={field.recur || 'none'}
                onChange={(e) => updateField(field.id, { recur: e.target.value })}
                className="text-xs py-1"
              >
                <option value="none">不提醒</option>
                <option value="yearly">每年重複</option>
                <option value="once">一次性</option>
                <option value="count">連續 N 年</option>
              </select>
              {field.recur === 'count' && (
                <label className="flex items-center gap-1">
                  共
                  <input
                    type="number" min="1"
                    value={field.recurCount || 1}
                    onChange={(e) => updateField(field.id, { recurCount: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-14 text-xs"
                  />
                  次
                </label>
              )}
              {field.recur && field.recur !== 'none' && (
                <span className="text-ink-3">到期日會出現在今日工作與行事曆</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
