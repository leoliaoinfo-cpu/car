import { useState, useEffect } from 'react';
import { db } from '../db';
import { useApp } from '../context';
import { CAT_COLORS, FIELD_COLORS, FIELD_COLOR_NAMES, generateId, DEFAULT_QUOTE_PRESETS, DEFAULT_LOAN_TERMS, QUOTE_ADDON_CATS, renameAddonCategory, resolveLoanTerms } from '../utils/crm';
import {
  connectSync, stopSync, syncNow, isSyncEnabled, getSyncRepo,
  getSyncStatus, subscribeSyncStatus,
} from '../sync';
import {
  notifySupported, notifyPermission, requestNotifyPermission,
  showSystemNotification, registerPeriodicReminderCheck,
} from '../notify';
import { Field } from './ui';
import { STORAGE_KEYS } from '../storageKeys';

const HELP_CARDS = [
  { icon: '☀️', title: '今日工作', desc: '一眼看完今日/逾期追蹤、到期提醒與即將簽約客戶，點擊可直接開啟客戶。' },
  { icon: '📅', title: '行事曆', desc: '月曆總覽追蹤、提醒與成交事件；點日期看當天清單，點事件直接跳到該客戶。' },
  { icon: '🗓', title: '行事曆活動', desc: '點日曆任一天的「＋新增活動」記生日、紀念日或重要日子，可設每年重複、關聯客戶；到期當天會出現在今日工作與行事曆。客戶詳情也有「生日/重要日子」可直接記錄。' },
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
  { icon: '☁️', title: '雲端同步', desc: '第一次使用先到設定連線汽車系統專用的私人 GitHub repo；完成後可跨裝置同步文字資料。照片仍以 LINE 相簿分享。' },
];

const SECTION_KEYS = ['sync', 'backup', 'deals', 'notify', 'cats', 'stages', 'industries', 'fields', 'dealFields', 'template', 'quoteMenu', 'height', 'rules', 'help'];
const SECTION_LABELS = {
  deals: '📈 內部業績與成本',
  sync: '☁️ 雲端同步',
  backup: '💾 備份還原',
  notify: '🔔 通知',
  cats: '🏷 客戶分類',
  stages: '📶 業務進度',
  industries: '🏭 產業選項',
  fields: '✏️ 自訂欄位',
  dealFields: '🏆 業績欄位',
  template: '📋 待辦範本',
  quoteMenu: '🚚 報價選單',
  height: '📐 車高參數',
  rules: '⏱ 追蹤規則',
  help: '📖 使用說明',
};

export default function SettingsPanel({ onClose, onOpenDeals }) {
  const {
    cats, stages, customFields, dealFields, thresholds, todoTemplate, quotePresets, industries, heightConfig,
    saveCats, saveStages, saveCustomFields, saveDealFields, saveThresholds,
    saveTodoTemplate, saveQuotePresets, saveIndustries, saveHeightConfig, reloadAll,
  } = useApp();
  const [activeSection, setActiveSection] = useState('sync');
  const [fullscreen, setFullscreen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.theme) || 'dark'; } catch { return 'dark'; }
  });

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEYS.theme, next); } catch { /* 隱私模式忽略 */ }
    document.documentElement.classList.toggle('dark', next === 'dark');
  }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className={`safe-panel fixed inset-y-0 right-0 w-full bg-s1 border-l border-bdr shadow-panel z-50 flex flex-col ${fullscreen ? 'max-w-none' : 'max-w-md anim-slide-right'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bdr shrink-0">
          <h2 className="font-bold text-lg text-ink">⚙️ 設定</h2>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setFullscreen((value) => !value)}
              className="btn-outline text-xs" title={fullscreen ? '縮回側邊設定' : '全螢幕展開設定'}>
              {fullscreen ? '⤡ 縮回' : '⤢ 全螢幕'}
            </button>
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

        <div id="settings-scroll-panel" className={`flex-1 overflow-y-auto p-4 space-y-4 ${fullscreen ? 'px-4 sm:px-6 lg:px-8' : ''}`}>
          {/* ── 業績表入口 + 密碼 ── */}
          {activeSection === 'deals' && <DealsSection onOpenDeals={onOpenDeals} />}

          {/* ── Cloud sync ── */}
          {activeSection === 'sync' && <SyncSection reloadAll={reloadAll} />}

          {activeSection === 'backup' && <BackupSection reloadAll={reloadAll} />}

          {/* ── Notifications ── */}
          {activeSection === 'notify' && <NotifySection />}

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

          {/* ── Industries ── */}
          {activeSection === 'industries' && (
            <StringListEditor
              title="產業選項"
              desc="客戶資料「產業」下拉選單的選項（水電、物流…），決定推什麼車斗；客戶頁側欄可依產業篩選名單。"
              items={industries}
              newItemText="新產業"
              onChange={saveIndustries}
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
            <StringListEditor
              title="待辦範本"
              desc="客戶詳情「套用交車待辦範本」帶入的項目，可自行增減修改。"
              items={todoTemplate}
              newItemText="新待辦項目"
              onChange={saveTodoTemplate}
            />
          )}

          {/* ── Quote presets ── */}
          {activeSection === 'quoteMenu' && (
            <div className={`space-y-5 ${fullscreen ? 'max-w-7xl mx-auto' : ''}`}>
              <button type="button" onClick={() => document.getElementById('settings-addon-editor')?.scrollIntoView({ behavior: 'smooth' })}
                className="btn-outline text-xs">跳到配備分類管理 ↓</button>
              <LoanTermsEditor />
              <WatermarkEditor />
              <LoadCatalogButton onLoad={() => saveQuotePresets(DEFAULT_QUOTE_PRESETS)} />
              <PresetEditor
                title="🚙 車型與售價"
                desc="報價單「選車型帶入」下拉的車型與售價，選取即帶入車輛售價。"
                items={quotePresets.models || []}
                newName="新車型"
                onChange={(models) => saveQuotePresets({ ...quotePresets, models })}
              />
              <AddonPresetEditor
                items={quotePresets.addons || []}
                categoryOrder={quotePresets.addonCategories || QUOTE_ADDON_CATS}
                fullscreen={fullscreen}
                onChange={(addons, addonCategories) => saveQuotePresets({ ...quotePresets, addons, addonCategories: addonCategories || quotePresets.addonCategories })}
                onRenameCategory={(oldName, newName) => saveQuotePresets(renameAddonCategory(quotePresets, oldName, newName))}
                reservedCategoryNames={Object.keys(quotePresets.addonCategoryAliases || {})}
              />
              <PresetEditor
                title="優惠&折扣"
                desc="報價單一鍵帶入的優惠折扣，可設定活動折扣、補助或其他折抵；加入報價後會自總價扣除。"
                items={quotePresets.subsidies}
                newName="新優惠"
                amountKey="amount"
                onChange={(subsidies) => saveQuotePresets({ ...quotePresets, subsidies })}
              />
            </div>
          )}

          {activeSection === 'height' && (
            <HeightConfigEditor value={heightConfig} onSave={saveHeightConfig} />
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
              <p className="text-center text-xs text-ink-3 py-2">業務系統 v2.3</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── LoanTermsEditor（貸款期數與試算年利率）──────────────────────────────────
function LoanTermsEditor() {
  const [terms, setTerms] = useState(DEFAULT_LOAN_TERMS);
  useEffect(() => {
    db.get('settings', 'quoteLoan')
      .then((r) => setTerms(resolveLoanTerms(r?.terms)))
      .catch(() => {});
  }, []);
  function save(next) {
    const valid = next
      .map((term) => ({ months: Math.min(84, Math.max(1, Math.round(Number(term.months) || 1))), rate: Number(term.rate) || 0 }))
      .filter((term, index, list) => list.findIndex((row) => row.months === term.months) === index);
    setTerms(valid);
    db.put('settings', { key: 'quoteLoan', terms: valid, version: 'estimate-4.5-v2' }).catch(() => {});
  }
  const update = (i, patch) => save(terms.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const remove = (i) => save(terms.filter((_, idx) => idx !== i));
  const standardMonths = [12, 24, 36, 48, 60, 72, 84];
  const nextMonth = standardMonths.find((months) => !terms.some((term) => Number(term.months) === months));
  const add = () => { if (nextMonth) save([...terms, { months: nextMonth, rate: 4.5 }]); };

  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-semibold text-ink">🏦 貸款期數與年利率</h3>
      <p className="text-xs text-ink-3">
        預設以 4.5% 做客戶月付概算，最高 84 期；客戶畫面只顯示月付金。實際條件仍由金融機構依客戶條件核定。
      </p>
      <div className="space-y-1.5">
        {terms.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="number" min="1" max="84" value={t.months}
              onChange={(e) => update(i, { months: Math.min(84, Math.max(1, Number(e.target.value) || 1)) })}
              className="w-16 text-sm" />
            <span className="text-xs text-ink-3">期</span>
            <input type="number" min="0" step="0.01" value={t.rate}
              onChange={(e) => update(i, { rate: Number(e.target.value) })}
              className="w-20 text-sm" />
            <span className="text-xs text-ink-3">% 年利率</span>
            <button onClick={() => remove(i)} className="text-danger/50 hover:text-danger text-sm ml-auto">✕</button>
          </div>
        ))}
      </div>
      <button onClick={add} disabled={!nextMonth} className="btn-outline text-xs disabled:opacity-40">+ 新增期數</button>
    </div>
  );
}

// ── WatermarkEditor（報價單浮水印文字；留空不顯示）──────────────────────────
function WatermarkEditor() {
  const [text, setText] = useState('報價僅供參考');
  useEffect(() => {
    db.get('settings', 'quoteWatermark')
      .then((r) => { if (r) setText(r.text || ''); })
      .catch(() => {});
  }, []);
  function save(v) {
    setText(v);
    db.put('settings', { key: 'quoteWatermark', text: v }).catch(() => {});
  }
  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-semibold text-ink">💧 報價單浮水印</h3>
      <p className="text-xs text-ink-3">報價單背景淡淡鋪滿的文字（例如公司名、聯絡電話）。留空則不顯示浮水印。</p>
      <input value={text} onChange={(e) => save(e.target.value)}
        placeholder="例：卡旺彰化 04-7654321" className="w-full text-sm" />
    </div>
  );
}

// ── LoadCatalogButton（一鍵載入卡旺 2026 原廠車型與配備型錄）─────────────────
function LoadCatalogButton({ onLoad }) {
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <div className="card p-3 flex items-center gap-3">
        <span className="text-lg shrink-0">🚚</span>
        <p className="flex-1 text-xs text-ink-2">
          載入 <strong>Kia 彰化卡旺 2026</strong> 原廠車型與配備價格（8 車型 + 19 配備）。
        </p>
        <button onClick={() => setConfirm(true)} className="btn-primary text-xs shrink-0">載入原廠型錄</button>
      </div>
    );
  }
  return (
    <div className="card p-3 border-warn/40 space-y-2" style={{ borderColor: '#bf8a5e66' }}>
      <p className="text-xs text-ink-2">
        會以原廠型錄<strong>覆蓋</strong>目前的車型與配備選單（你自己新增的項目會被取代）。確定嗎？
      </p>
      <div className="flex gap-2">
        <button onClick={() => { onLoad(); setConfirm(false); }} className="btn-primary text-xs flex-1">確定載入</button>
        <button onClick={() => setConfirm(false)} className="btn-outline text-xs flex-1">取消</button>
      </div>
    </div>
  );
}

// ── AddonPresetEditor（配備分類直接沿用報價單的 cat 欄位）──────────────────
function AddonPresetEditor({ items, categoryOrder, fullscreen, onChange, onRenameCategory, reservedCategoryNames = [] }) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [addCategory, setAddCategory] = useState('配件');
  const [expanded, setExpanded] = useState({});
  const [newCategoryName, setNewCategoryName] = useState('');
  const [manageCategories, setManageCategories] = useState(false);
  const [customCategoryId, setCustomCategoryId] = useState(null);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState('');

  const grouped = new Map();
  for (const item of items) {
    const category = String(item.cat || '').trim() || '其他';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(item);
  }
  const categories = [...new Set([...(categoryOrder || QUOTE_ADDON_CATS), ...grouped.keys()])];
  const categoryOptions = categories;
  const selectedCategory = activeCategory;
  const selectedAddCategory = categoryOptions.includes(addCategory) ? addCategory : '配件';
  const visibleCategories = selectedCategory === 'all'
    ? categories
    : categories.filter((category) => category === selectedCategory);
  const allExpanded = visibleCategories.every((category) => expanded[category] === true);

  function update(id, patch) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function moveToCategory(id, category) {
    update(id, { cat: category });
    // 維持使用者目前正在整理的來源分類，不自動跳到目標分類。
  }

  function createCategory() {
    const name = newCategoryName.trim();
    if (!name || categories.includes(name) || reservedCategoryNames.includes(name)) return;
    onChange(items, [...categories, name]);
    setNewCategoryName('');
    setAddCategory(name);
  }

  function commitCategoryName() {
    const name = categoryNameDraft.trim();
    if (!editingCategory || !name || name === editingCategory
      || categories.includes(name) || reservedCategoryNames.includes(name)) return;
    onRenameCategory(editingCategory, name);
    if (activeCategory === editingCategory) setActiveCategory(name);
    if (addCategory === editingCategory) setAddCategory(name);
    setExpanded((current) => {
      const next = { ...current };
      if (Object.prototype.hasOwnProperty.call(next, editingCategory)) {
        next[name] = next[editingCategory];
        delete next[editingCategory];
      }
      return next;
    });
    setEditingCategory(null);
    setCategoryNameDraft('');
  }

  function shiftCategory(category, direction) {
    const index = categories.indexOf(category);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= categories.length) return;
    const next = [...categories];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(items, next);
  }

  function add(category = addCategory) {
    const target = categoryOptions.includes(category) ? category : '配件';
    onChange([...items, { id: generateId('preset'), cat: target, name: '新配備', price: 0, pendingPrice: false }]);
    setAddCategory(target);
    setActiveCategory(target);
    setExpanded((current) => ({ ...current, [target]: true }));
  }

  function saveCustomCategory(id) {
    const category = customCategoryName.trim();
    if (!category || reservedCategoryNames.includes(category)) return;
    onChange(items.map((item) => item.id === id ? { ...item, cat: category } : item),
      categories.includes(category) ? categories : [...categories, category]);
    setCustomCategoryId(null);
    setCustomCategoryName('');
  }

  return (
    <section id="settings-addon-editor" className="space-y-3">
      <div>
        <h3 className="font-semibold text-ink text-sm">🚚 選購配備選單</h3>
        <p className="text-xs text-ink-3 mt-0.5">按分類管理配備；調整分類會同步到客戶與獨立報價。尚未取得廠商價格時可標記待報價。</p>
      </div>

      <div className="card p-3 space-y-3 bg-s2/60">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">配備分類</p>
            <p className="text-[11px] text-ink-3">選分類整理配備；移動項目後留在目前分類。</p>
          </div>
          <span className="text-[11px] text-ink-3 shrink-0">{categories.length} 類・{items.length} 項</span>
        </div>
        <div className={`grid gap-1.5 ${fullscreen ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3'}`} aria-label="配備分類篩選">
          <button type="button" onClick={() => setActiveCategory('all')}
            className={`text-xs rounded-lg border px-2.5 py-2 flex items-center justify-between gap-1 min-w-0 ${selectedCategory === 'all' ? 'bg-accent text-on-accent border-accent' : 'bg-s1 border-bdr text-ink-2'}`}>
            <span className="truncate">全部分類</span><span className="shrink-0 font-semibold">{items.length}</span>
          </button>
          {categories.map((category) => (
            <button key={category} type="button" onClick={() => { setActiveCategory(category); setAddCategory(category); setExpanded((current) => ({ ...current, [category]: true })); }}
              className={`text-xs rounded-lg border px-2.5 py-2 flex items-center justify-between gap-1 min-w-0 ${selectedCategory === category ? 'bg-accent text-on-accent border-accent' : 'bg-s1 border-bdr text-ink-2'}`}>
              <span className="truncate">{category}</span><span className="shrink-0 font-semibold">{grouped.get(category)?.length || 0}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setExpanded(Object.fromEntries(categories.map((category) => [category, !allExpanded])))}
            className="btn-outline text-xs">{allExpanded ? '全部收合' : '全部展開'}</button>
          <button type="button" onClick={() => setManageCategories((value) => !value)} className="btn-outline text-xs">
            {manageCategories ? '完成分類管理' : '＋ 新增／改名／排序分類'}
          </button>
        </div>
        {manageCategories && (
          <div className="rounded-lg border border-bdr bg-s1 p-2.5 space-y-2">
            <div className="flex gap-2">
              <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') createCategory(); }}
                placeholder="新增產品分類名稱" aria-label="新增產品分類名稱" className="text-xs flex-1 min-w-0" />
              <button type="button" onClick={createCategory} disabled={!newCategoryName.trim() || categories.includes(newCategoryName.trim()) || reservedCategoryNames.includes(newCategoryName.trim())}
                className="btn-primary text-xs shrink-0">新增分類</button>
            </div>
            <p className="text-[10px] text-ink-3">分類名稱與順序會同步到客戶及獨立報價；改名會連同分類內配件一起更新，舊報價的確認紀錄仍保留。</p>
            {reservedCategoryNames.includes(newCategoryName.trim()) && <p className="text-[10px] text-warn">這是曾用過的分類名稱，請換個名字，避免舊報價混淆。</p>}
            <div className={`grid gap-1.5 ${fullscreen ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`}>
              {categories.map((category, index) => (
                <div key={category} className="flex items-center gap-1 rounded-lg border border-bdr px-2 py-1.5 text-xs">
                  <span className="text-ink-3 w-5">{index + 1}.</span>
                  {editingCategory === category ? (
                    <input value={categoryNameDraft} onChange={(event) => setCategoryNameDraft(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') commitCategoryName(); if (event.key === 'Escape') setEditingCategory(null); }}
                      aria-label={`${category}新分類名稱`} className="flex-1 min-w-0 text-xs" />
                  ) : <span className="flex-1 truncate text-ink">{category}</span>}
                  <span className="text-ink-3">{grouped.get(category)?.length || 0}</span>
                  {editingCategory === category ? (
                    <>
                      <button type="button" onClick={commitCategoryName}
                        disabled={!categoryNameDraft.trim() || categoryNameDraft.trim() === category || categories.includes(categoryNameDraft.trim()) || reservedCategoryNames.includes(categoryNameDraft.trim())}
                        aria-label={`儲存${category}分類名稱`} className="px-1 text-accent disabled:opacity-30">儲存</button>
                      <button type="button" onClick={() => setEditingCategory(null)} aria-label={`取消編輯${category}分類名稱`} className="px-1 text-ink-3">取消</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => { setEditingCategory(category); setCategoryNameDraft(category); }}
                      aria-label={`編輯${category}分類名稱`} className="px-1 text-accent">改名</button>
                  )}
                  <button type="button" onClick={() => shiftCategory(category, -1)} disabled={index === 0}
                    aria-label={`${category}往前`} className="px-1 text-accent disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => shiftCategory(category, 1)} disabled={index === categories.length - 1}
                    aria-label={`${category}往後`} className="px-1 text-accent disabled:opacity-30">↓</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-bdr/60 pt-3">
          <span className="text-xs text-ink-3">新增至</span>
          <select value={selectedAddCategory} onChange={(event) => setAddCategory(event.target.value)}
            aria-label="新配備分類" className="text-xs flex-1 min-w-[120px] max-w-[210px]">
            {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <button type="button" onClick={() => add()} className="btn-primary text-xs shrink-0">＋ 新增配備</button>
        </div>
      </div>

      {items.length === 0 && <p className="text-center text-ink-3 text-sm py-4">尚無配備，請先選分類再新增。</p>}
      {visibleCategories.map((category, index) => {
        const list = grouped.get(category) || [];
        const isExpanded = expanded[category] ?? (selectedCategory !== 'all' || index === 0);
        return (
          <div key={category} className="card overflow-hidden border-l-4 border-l-accent/60">
            <div className="flex items-center gap-2 bg-s2/70 px-3 py-2.5">
              <button type="button" onClick={() => setExpanded((current) => ({ ...current, [category]: !isExpanded }))}
                aria-expanded={isExpanded} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                <span className="text-accent text-xs">{isExpanded ? '▼' : '▶'}</span>
                <span className="font-semibold text-sm text-ink truncate">{category}</span>
                <span className="text-[11px] text-ink-3 shrink-0">{list.length} 項</span>
              </button>
              <button type="button" onClick={() => add(category)} className="btn-outline text-[11px] shrink-0">＋ 在此新增</button>
            </div>
            {isExpanded && (
              <div className={`p-2.5 ${fullscreen ? 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-2' : 'space-y-2'}`}>
                {list.length === 0 && <p className="text-xs text-ink-3 p-2">這個分類目前沒有配備，可在此新增或從其他分類移入。</p>}
                {list.map((item) => (
                  <div key={item.id} className="rounded-xl border border-bdr bg-s1 p-2.5 space-y-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_105px] gap-2">
                      <input value={item.name} onChange={(event) => update(item.id, { name: event.target.value })}
                        aria-label={`${item.name}名稱`} className="text-sm min-w-0" />
                      <input type="number" min="0" value={item.price ?? 0}
                        onChange={(event) => update(item.id, { price: Number(event.target.value) || 0 })}
                        disabled={item.pendingPrice} aria-label={`${item.name}金額`} className="text-sm w-full disabled:opacity-40" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-ink-3">分類</span>
                      <select value={category} onChange={(event) => moveToCategory(item.id, event.target.value)}
                        aria-label={`${item.name}分類`} className="text-xs flex-1 min-w-[115px] max-w-[200px]">
                        {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                      <button type="button" onClick={() => { setCustomCategoryId(item.id); setCustomCategoryName(''); }}
                        className="text-[11px] text-accent shrink-0">＋ 自訂分類</button>
                      <button type="button" onClick={() => update(item.id, { pendingPrice: !item.pendingPrice })}
                        aria-label={`${item.name}價格狀態`}
                        className={`text-[10px] rounded-full border px-2 py-1 shrink-0 ${item.pendingPrice ? 'border-warn text-warn bg-warn/10' : 'border-bdr text-ink-3'}`}>
                        {item.pendingPrice ? '待報價' : '固定價'}
                      </button>
                      <button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}
                        aria-label={`刪除${item.name}`} className="text-danger/60 hover:text-danger text-sm shrink-0">✕</button>
                    </div>
                    {customCategoryId === item.id && (
                      <div className="flex items-center gap-2 rounded-lg bg-s2 p-2">
                        <input value={customCategoryName} onChange={(event) => setCustomCategoryName(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Enter') saveCustomCategory(item.id); }}
                          placeholder="輸入新分類名稱" aria-label="新分類名稱" className="text-xs flex-1 min-w-0" />
                        <button type="button" onClick={() => saveCustomCategory(item.id)} disabled={!customCategoryName.trim() || reservedCategoryNames.includes(customCategoryName.trim())}
                          className="btn-primary text-[11px] shrink-0">套用分類</button>
                        <button type="button" onClick={() => setCustomCategoryId(null)} className="text-xs text-ink-3 shrink-0">取消</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ── PresetEditor（車型與補助折抵，名稱＋金額）───────────────────────────────
function PresetEditor({ title, desc, items, newName, amountKey = 'price', allowPending = false, onChange }) {
  function update(id, patch) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function remove(id) {
    onChange(items.filter((it) => it.id !== id));
  }
  function add() {
    onChange([...items, { id: generateId('preset'), name: newName, [amountKey]: 0, ...(allowPending ? { pendingPrice: false } : {}) }]);
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
      {items.length > 0 && (
        <div className="flex items-center gap-2 px-3 text-[11px] font-medium text-ink-3">
          <span className="flex-1">名稱</span>
          <span className="w-28 shrink-0">金額（元）</span>
          <span className="w-4 shrink-0" />
        </div>
      )}
      {items.map((it) => (
        <div key={it.id} className="card p-3 flex flex-wrap items-center gap-2">
          <input
            value={it.name}
            onChange={(e) => update(it.id, { name: e.target.value })}
            className="flex-1 text-sm min-w-0"
          />
          <input
            type="number" min="0"
            value={it[amountKey] ?? 0}
            onChange={(e) => update(it.id, { [amountKey]: Number(e.target.value) || 0 })}
            disabled={allowPending && it.pendingPrice}
            className="w-28 text-sm shrink-0 disabled:opacity-40"
          />
          {allowPending && (
            <button type="button" onClick={() => update(it.id, { pendingPrice: !it.pendingPrice })}
              className={`text-[10px] rounded-full border px-2 py-1 shrink-0 ${it.pendingPrice ? 'border-warn text-warn bg-warn/10' : 'border-bdr text-ink-3'}`}>
              {it.pendingPrice ? '待報價' : '固定價'}
            </button>
          )}
          <button onClick={() => remove(it.id)} className="text-danger/50 hover:text-danger text-sm shrink-0">✕</button>
        </div>
      ))}
    </div>
  );
}

// ── TodoTemplateEditor（交車待辦範本，客戶詳情一鍵套用）───────────────────────
/** 純文字清單編輯器（待辦範本、產業選項共用）：增刪改與上下排序 */
function StringListEditor({ title, desc, items, newItemText, onChange }) {
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
    onChange([...items, newItemText]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="text-xs text-ink-3 mt-0.5">{desc}</p>
        </div>
        <button onClick={addItem} className="btn-primary text-xs shrink-0">+ 新增</button>
      </div>
      {items.length === 0 && (
        <p className="text-center text-ink-3 text-sm py-6">尚無項目</p>
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

function HeightConfigEditor({ value, onSave }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState('');
  useEffect(() => setDraft(value), [value]);
  const fields = [
    ['bedHeight2wdCm', 'K2500 2WD 貨斗離地', '77'],
    ['bedHeight4wdCm', 'K2500 4WD 貨斗離地', '85.5'],
    ['shockLiftCm', '改避震升高量', '5'],
    ['leafLiftCm', '加葉片升高量', '2'],
    ['generalControlCm', '一般規劃控制總高', '270'],
    ['basementReserveCm', '地下室預設安全預留', '10'],
    ['nearLimitCm', '接近限制警示範圍', '5'],
  ];
  const canvasFields = [
    ['canvasRaisedCm', '標準加高（斗上高度）'],
    ['canvasStandardCm', '標準高（斗上高度）'],
    ['canvasLoweredCm', '標準降低（斗上高度）'],
  ];
  const set = (key, next) => { setDraft((current) => ({ ...current, [key]: next })); setSaved(''); };
  async function commit() {
    const clean = await onSave(draft);
    setDraft(clean);
    setSaved('✅ 車高參數已儲存，接待中的計算會立即套用。');
  }
  return <div className="space-y-4">
    <div className="rounded-2xl border border-warn/30 bg-warn/10 p-4 text-sm text-ink-2 space-y-2">
      <h3 className="font-bold text-ink">📐 車高／帆布參數</h3>
      <p>270 cm 是目前業務規劃控制值，不直接等同每台車的合法保證值。小型車全高仍須依行照車寬、實車最高點、合法車身廠與監理檢驗確認。</p>
    </div>
    <div className="card p-4 grid sm:grid-cols-2 gap-3">
      {fields.map(([key, label, placeholder]) => <label key={key} className="space-y-1"><span className="text-xs text-ink-3">{label}（cm）</span><input type="number" inputMode="decimal" min="0" value={draft?.[key] ?? ''} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} className="w-full" /></label>)}
    </div>
    <div className="card p-4 space-y-3">
      <div><h3 className="font-semibold">帆布常用規格</h3><p className="text-xs text-ink-3 mt-1">尚未取得公司固定尺寸可留空；留空時案件會保持「待確認」，不會誤判可施工。</p></div>
      <div className="grid sm:grid-cols-3 gap-3">{canvasFields.map(([key, label]) => <label key={key} className="space-y-1"><span className="text-xs text-ink-3">{label}</span><input type="number" inputMode="decimal" min="0" value={draft?.[key] ?? ''} placeholder="待設定" onChange={(e) => set(key, e.target.value)} className="w-full" /></label>)}</div>
    </div>
    {saved && <p className="text-sm text-ok">{saved}</p>}
    <button type="button" onClick={commit} className="btn-primary w-full min-h-11">儲存車高參數</button>
  </div>;
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

function BackupSection({ reloadAll }) {
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [restoreData, setRestoreData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { db.getLastBackupAt().then(setLastBackupAt).catch(() => {}); }, []);

  async function downloadBackup() {
    setBusy(true);
    setMessage('');
    try {
      await db.exportAndDownload();
      const now = new Date().toISOString();
      setLastBackupAt(now);
      setMessage('✅ 備份檔已下載，請保留在電腦、雲端硬碟或手機檔案中。');
    } catch (error) {
      setMessage(`❌ 備份失敗：${error?.message || '請稍後再試'}`);
    } finally { setBusy(false); }
  }

  async function readBackupFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage('');
    setConfirmReplace(false);
    try {
      const data = JSON.parse(await file.text());
      const valid = data?._v === 1 || ['clients', 'quoteDrafts', 'settings'].some((key) => Array.isArray(data?.[key]));
      if (!valid) throw new Error('不是本系統的備份格式');
      setRestoreData(data);
      setFileName(file.name);
    } catch (error) {
      setRestoreData(null);
      setFileName('');
      setMessage(`❌ 無法讀取：${error?.message || '檔案格式錯誤'}`);
    }
  }

  async function restore(mode) {
    if (!restoreData) return;
    setBusy(true);
    setMessage('');
    try {
      if (restoreData._v === 1) await db.importLegacy(restoreData);
      else if (mode === 'replace') await db.importAll(restoreData);
      else await db.mergeImport(restoreData);
      await reloadAll?.();
      setRestoreData(null);
      setFileName('');
      setConfirmReplace(false);
      setMessage(mode === 'replace' ? '✅ 已用備份檔完整還原。' : '✅ 已合併備份；現有資料未清除。');
    } catch (error) {
      setMessage(`❌ 還原失敗：${error?.message || '請確認檔案後再試'}`);
    } finally { setBusy(false); }
  }

  const backupAge = lastBackupAt ? Math.floor((Date.now() - Date.parse(lastBackupAt)) / 86400000) : null;
  return (
    <section className="space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-ink">💾 下載完整文字資料備份</h3>
          <p className="text-xs text-ink-3 mt-1">包含客戶、報價、成本、成交、待辦與設定；照片仍只存在原裝置。</p>
        </div>
        <div className={`rounded-lg px-3 py-2 text-xs ${backupAge == null || backupAge >= 7 ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok'}`}>
          {backupAge == null ? '尚未下載過備份，建議現在先備份。' : `上次備份：${lastBackupAt.slice(0, 16).replace('T', ' ')}（${backupAge} 天前）`}
        </div>
        <button type="button" onClick={downloadBackup} disabled={busy} className="btn-primary w-full disabled:opacity-40">
          {busy ? '處理中…' : '⬇️ 下載備份 JSON'}
        </button>
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-ink">📥 從備份檔還原</h3>
          <p className="text-xs text-ink-3 mt-1">先選檔案，再選擇安全合併或完整覆蓋。</p>
        </div>
        <label className="btn-outline w-full text-center cursor-pointer">
          選擇備份 JSON
          <input type="file" accept="application/json,.json" onChange={readBackupFile} className="hidden" />
        </label>
        {restoreData && (
          <div className="rounded-lg border border-bdr bg-s2 p-3 space-y-3">
            <p className="text-xs text-ink-2 break-all">已讀取：{fileName}</p>
            <button type="button" onClick={() => restore('merge')} disabled={busy} className="btn-primary w-full">安全合併（建議）</button>
            {!confirmReplace ? (
              <button type="button" onClick={() => setConfirmReplace(true)} className="btn-outline w-full text-danger">完整覆蓋目前資料</button>
            ) : (
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 space-y-2">
                <p className="text-xs text-danger">完整覆蓋會以備份檔取代目前文字資料。請先確認已下載現在的備份。</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setConfirmReplace(false)} className="btn-outline">取消</button>
                  <button type="button" onClick={() => restore('replace')} disabled={busy} className="btn-danger">確認覆蓋</button>
                </div>
              </div>
            )}
          </div>
        )}
        {message && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{message}</p>}
      </div>
    </section>
  );
}

// ── 📈 業績表入口 + 密碼保護 ──────────────────────────────────────────────────
// 業績表已從主導覽移除，只能從這裡輸入固定通關答案進入，避免給客人看到。
function DealsSection({ onOpenDeals }) {
  const [unlock, setUnlock] = useState('');
  const [err, setErr] = useState('');

  function tryOpen() {
    setErr('');
    if (unlock.trim() === '東平') { setUnlock(''); onOpenDeals(); }
    else setErr('密碼錯誤，請重新輸入');
  }

  return (
    <section>
      <div className="card p-4 space-y-3 border border-warn/30">
        <h3 className="font-semibold text-ink">📈 開啟內部業績與成本</h3>
        <p className="text-xs text-ink-3">業績、成本設定、報價試算與單車利潤都只從這裡進入；報價畫面不提供成本入口。</p>
        <div className="space-y-2">
          <Field label="輸入密碼解鎖">
            <input type="text" inputMode="text" lang="zh-Hant" value={unlock}
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => setUnlock(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) tryOpen(); }}
              style={{ WebkitTextSecurity: 'disc' }}
              placeholder="請輸入兩個中文字" className="w-full" />
          </Field>
          <p className="text-[11px] text-warn">提示：就讀的國小（兩個字）</p>
          {err && <p className="text-danger text-xs">{err}</p>}
          <button onClick={tryOpen} disabled={!unlock} className="btn-primary w-full disabled:opacity-40">🔓 解鎖並開啟內部業績與成本</button>
        </div>
      </div>
    </section>
  );
}

// ── ☁️ 雲端同步（GitHub 私人 repo）──────────────────────────────────────────
function SyncSection({ reloadAll }) {
  const [enabled, setEnabled] = useState(isSyncEnabled());
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  const [token, setToken] = useState('');
  const [repoName, setRepoName] = useState('car-sales-data');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => subscribeSyncStatus(setSyncStatus), []);

  async function handleConnect() {
    if (!token.trim()) { setMsg('❌ 請先貼上金鑰'); return; }
    setBusy(true);
    setMsg('');
    try {
      const repo = await connectSync(token, repoName);
      setEnabled(true);
      setToken('');
      setMsg(`✅ 已連線 ${repo}，同步已啟動`);
      // 首次同步完成後刷新畫面（讓另一台裝置的資料立刻出現）
      setTimeout(() => reloadAll?.(), 3000);
    } catch (e) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleStop() {
    stopSync();
    setEnabled(false);
    setConfirmStop(false);
    setMsg('已中斷同步（雲端與本機資料都保留，重新連線即可續用）');
  }

  const stateLabel = {
    off: '未啟用', idle: '待命', syncing: '同步中…', ok: '✅ 已同步', error: '❌ 發生錯誤',
  }[syncStatus.state] || syncStatus.state;

  return (
    <section className="space-y-4">
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-ink">☁️ 手機 ↔ 電腦全自動同步</h3>
        <p className="text-xs text-ink-3 leading-relaxed">
          用你自己的 GitHub 私人儲存庫當免費雲端：任何一台裝置改了資料，幾秒內自動上傳，
          其他裝置開啟或切回頁面時自動下載合併。兩邊同時改也會逐筆以「較新的為準」合併，
          刪除的資料不會復活。金鑰只存在此裝置，不會上傳。
        </p>

        {enabled ? (
          <div className="space-y-3">
            <div className="bg-s2 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-ink-3">儲存庫</span><span className="text-ink font-mono text-xs">{getSyncRepo()}</span></div>
              <div className="flex justify-between"><span className="text-ink-3">狀態</span><span className="text-ink">{stateLabel}</span></div>
              {syncStatus.lastSyncAt && (
                <div className="flex justify-between"><span className="text-ink-3">上次同步</span>
                  <span className="text-ink">{syncStatus.lastSyncAt.slice(0, 16).replace('T', ' ')}</span></div>
              )}
              {syncStatus.error && <p className="text-xs text-danger">{syncStatus.error}</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => syncNow()} className="btn-primary text-sm" disabled={syncStatus.state === 'syncing'}>
                🔄 立即同步
              </button>
              {confirmStop ? (
                <span className="flex gap-1.5">
                  <button onClick={handleStop} className="btn-danger text-sm">確認中斷</button>
                  <button onClick={() => setConfirmStop(false)} className="btn-outline text-sm">取消</button>
                </span>
              ) : (
                <button onClick={() => setConfirmStop(true)} className="btn-outline text-sm">中斷同步</button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="GitHub 金鑰（github_pat_ 開頭）" required>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="github_pat_…"
                className="w-full text-sm font-mono"
                autoComplete="off"
              />
            </Field>
            <Field label="私人儲存庫名稱">
              <input
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                className="w-full text-sm font-mono"
              />
            </Field>
            <button onClick={handleConnect} disabled={busy} className="btn-primary w-full">
              {busy ? '連線中…' : '🔗 啟用同步'}
            </button>
          </div>
        )}
        {msg && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{msg}</p>}
      </div>

      {!enabled && (
        <div className="card p-4 space-y-2 text-xs text-ink-2 leading-relaxed">
          <h3 className="font-semibold text-ink text-sm">📝 一次性設定教學（約 3 分鐘）</h3>
          <p className="font-medium text-ink">步驟 1：建立私人儲存庫（只需做一次）</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>登入 <span className="font-mono">github.com</span> → 右上角「＋」→「New repository」</li>
            <li>Repository name 輸入 <span className="font-mono text-accent">car-sales-data</span>（汽車系統專用，勿與其他系統共用）</li>
            <li>選 <strong className="text-danger">Private（私人）</strong> → 按「Create repository」</li>
          </ol>
          <p className="font-medium text-ink pt-1">步驟 2：產生金鑰（只需做一次）</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>GitHub 右上角頭像 → Settings → 最下面「Developer settings」</li>
            <li>「Personal access tokens」→「Fine-grained tokens」→「Generate new token」</li>
            <li>Token name 隨意填（例：sync）；Expiration 選最長</li>
            <li>Repository access 選「Only select repositories」→ 勾 <span className="font-mono">car-sales-data</span></li>
            <li>Permissions → Repository permissions → <strong>Contents</strong> 改成「Read and write」</li>
            <li>按「Generate token」→ 複製整串金鑰（github_pat_ 開頭）</li>
          </ol>
          <p className="font-medium text-ink pt-1">步驟 3：每台裝置貼上同一把金鑰</p>
          <p>把金鑰貼到上面欄位按「啟用同步」。手機、電腦都做這一步，之後就全自動，不用再管。</p>
        </div>
      )}
    </section>
  );
}

// ── 🔔 系統通知 ───────────────────────────────────────────────────────────────
function NotifySection() {
  const [perm, setPerm] = useState(notifyPermission());
  const [msg, setMsg] = useState('');
  const installed = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  async function handleEnable() {
    const res = await requestNotifyPermission();
    setPerm(res);
    if (res === 'granted') {
      await registerPeriodicReminderCheck();
      setMsg('✅ 已開啟通知，計時提醒到期時會跳系統通知');
    } else if (res === 'denied') {
      setMsg('❌ 被拒絕了——請到瀏覽器的網站設定把「通知」改成允許後，回來再按一次');
    }
  }

  async function handleTest() {
    const ok = await showSystemNotification('測試通知：看得到這則就代表設定成功 ✅');
    setMsg(ok ? '已送出測試通知（看手機/電腦右上角）' : '無法顯示通知，請先按上面的「開啟通知」');
  }

  const permLabel = {
    granted: '✅ 已開啟', denied: '❌ 已被拒絕（要去瀏覽器設定解除）',
    default: '尚未開啟', unsupported: '此瀏覽器不支援',
  }[perm];

  return (
    <section className="space-y-4">
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-ink">🔔 到期提醒系統通知</h3>
        <p className="text-xs text-ink-3 leading-relaxed">
          計時提醒到期時，直接跳手機/電腦的系統通知（只顯示數量，不會外洩客戶資料）。
        </p>
        <div className="bg-s2 rounded-lg p-3 text-sm flex justify-between">
          <span className="text-ink-3">通知權限</span>
          <span className="text-ink">{permLabel}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {perm !== 'granted' && notifySupported() && (
            <button onClick={handleEnable} className="btn-primary text-sm">🔔 開啟通知</button>
          )}
          {perm === 'granted' && (
            <button onClick={handleTest} className="btn-outline text-sm">發送測試通知</button>
          )}
        </div>
        {msg && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{msg}</p>}
      </div>

      <div className="card p-4 space-y-2 text-xs text-ink-2 leading-relaxed">
        <h3 className="font-semibold text-ink text-sm">📲 建議先「加入主畫面」變成 App</h3>
        {installed ? (
          <p className="text-ok">✅ 你已經用主畫面 App 模式開啟了</p>
        ) : isIOS ? (
          <ol className="list-decimal pl-4 space-y-1">
            <li>用 Safari 開啟本系統</li>
            <li>點下方中間的「分享」按鈕（□↑）</li>
            <li>往下找「加入主畫面」→ 新增</li>
            <li>之後從主畫面的 🚚 圖示開啟（iPhone 要用這個模式才能收通知）</li>
          </ol>
        ) : (
          <ol className="list-decimal pl-4 space-y-1">
            <li>用 Chrome 開啟本系統</li>
            <li>右上角「⋮」選單 → 「加入主畫面」或「安裝應用程式」</li>
            <li>之後從主畫面的 🚚 圖示開啟，全螢幕、離線也能用</li>
          </ol>
        )}
        <p className="text-ink-3 pt-1">
          通知在「App 開著或掛在背景」時最可靠；完全關閉 App 後能否通知，依手機系統而定
          （Android 安裝後支援背景檢查；iPhone 限制較多）。
        </p>
      </div>
    </section>
  );
}
