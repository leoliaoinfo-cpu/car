const ITEMS = [
  { key: 'calendar', icon: '📅', title: '行事曆' },
  { key: 'catalog', icon: '📖', title: '產品型錄' },
  { key: 'operations', icon: '🗂️', title: '營運管理' },
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
            <span className="mt-1 block text-[11px] text-ink-3">開啟完整頁面 →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
