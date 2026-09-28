export default function Header({ tab, setTab, onSettings }) {
  const tabs = [
    { key: 'today', icon: '☀️', label: '今日工作', active: 'bg-copper/15 text-copper ring-1 ring-copper/25' },
    { key: 'reception', icon: '🤝', label: '客戶接待', active: 'bg-teal/15 text-teal ring-1 ring-teal/25' },
    { key: 'calendar', icon: '📅', label: '行事曆', active: 'bg-violet/15 text-violet ring-1 ring-violet/25' },
    { key: 'crm', icon: '👥', label: '客戶追蹤', active: 'bg-sage/15 text-sage ring-1 ring-sage/25' },
    { key: 'quotes', icon: '🧾', label: '報價單', active: 'bg-gold/15 text-gold ring-1 ring-gold/25' },
    { key: 'catalog', icon: '📖', label: '型錄', active: 'bg-accent/10 text-accent ring-1 ring-accent/25' },
  ];

  return (
    <header className="hidden md:flex items-center bg-s1 border-b border-bdr px-4 h-14 sticky top-0 z-30 shadow-card">
      <span className="font-bold text-accent mr-6 text-base tracking-tight">🚛 業務系統</span>
      <nav className="flex gap-1 flex-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? t.active
                : 'text-ink-2 hover:bg-s3 hover:text-ink'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      <button
        onClick={onSettings}
        className="btn-ghost gap-1.5 text-sm"
        title="設定"
      >
        ⚙️ 設定
      </button>
    </header>
  );
}
