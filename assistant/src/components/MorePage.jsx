const ITEMS = [
  { key: 'reception', icon: '🤝', title: '客戶接待', note: '接待紀錄與需求整理' },
  { key: 'quotes', icon: '🧾', title: '報價管理', note: '建立、編輯與輸出報價' },
  { key: 'calendar', icon: '📅', title: '行事曆' },
  { key: 'catalog', icon: '📖', title: '產品型錄' },
  { key: 'operations', icon: '🗂️', title: '成交與施工管理', note: '成交、廠商、成本與交車流程' },
  { key: 'today', icon: '📋', title: '完整工作總覽', note: '原有提醒、行事曆與全部待辦' },
  { key: 'settings', icon: '⚙️', title: '系統設定' },
];

export default function MorePage({ onNavigate }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
      <div>
        <p className="text-xs tracking-[0.18em] text-ink-3">MORE</p>
        <h1 className="text-xl font-bold text-ink mt-1">更多功能</h1>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {ITEMS.map((item) => (
          <button key={item.key} type="button" onClick={() => onNavigate(item.key)}
            className="card min-h-28 p-4 text-left hover:border-accent/50 active:scale-[0.99] transition-all">
            <span className="text-2xl">{item.icon}</span>
            <span className="mt-3 block text-sm font-bold text-ink">{item.title}</span>
            <span className="mt-1 block text-[11px] text-ink-3">{item.note || '開啟完整頁面'} →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
