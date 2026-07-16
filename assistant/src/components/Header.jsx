export default function Header({ tab, setTab, onSettings }) {
  const tabs = [
    { key: 'today', icon: '☀️', label: '今日工作' },
    { key: 'calendar', icon: '📅', label: '行事曆' },
    { key: 'crm', icon: '👥', label: '客戶追蹤' },
    { key: 'deals', icon: '📈', label: '業績表' },
  ];

  return (
    <header className="hidden md:flex items-center bg-s1 border-b border-bdr px-4 h-14 sticky top-0 z-30 shadow-card">
      <span className="font-bold text-accent mr-6 text-base tracking-tight">🚛 汽車銷售業務系統</span>
      <nav className="flex gap-1 flex-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-accent/10 text-accent'
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
