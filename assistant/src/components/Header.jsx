export default function Header({ tab, setTab }) {
  const tabs = [
    { key: 'work', icon: '✓', label: '工作台', active: 'bg-copper/15 text-copper ring-1 ring-copper/25' },
    { key: 'cases', icon: '📁', label: '客戶案件', active: 'bg-teal/15 text-teal ring-1 ring-teal/25' },
    { key: 'crm', icon: '👥', label: '客戶資料', active: 'bg-sage/15 text-sage ring-1 ring-sage/25' },
    { key: 'reception', icon: '🤝', label: '接待', active: 'bg-teal/15 text-teal ring-1 ring-teal/25' },
    { key: 'quotes', icon: '🧾', label: '報價', active: 'bg-gold/15 text-gold ring-1 ring-gold/25' },
    { key: 'catalog', icon: '📖', label: '型錄', active: 'bg-accent/10 text-accent ring-1 ring-accent/25' },
  ];

  return (
    <header className="hidden lg:flex items-center bg-s1 border-b border-bdr px-3 h-14 sticky top-0 z-30 shadow-card">
      <span className="font-bold text-accent mr-3 text-sm tracking-tight shrink-0">🚛 業務系統</span>
      <nav className="flex gap-0.5 flex-1 min-w-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
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
        onClick={() => setTab('operations')}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${tab === 'operations' ? 'bg-orange-500/15 text-orange-500' : 'text-ink-2 hover:bg-s3'}`}
        title="成交與施工管理"
      >
        🗂️ 成交與施工
      </button>
      <button
        onClick={() => setTab('settings')}
        className={`ml-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${tab === 'settings' ? 'bg-accent/15 text-accent' : 'text-ink-2 hover:bg-s3'}`}
        title="系統設定"
      >
        ⚙️ 設定
      </button>
    </header>
  );
}
