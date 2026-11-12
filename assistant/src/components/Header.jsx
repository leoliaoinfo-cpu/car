export const MAIN_TABS = [
  { key: 'work', icon: '✓', label: '今天', active: 'bg-copper/15 text-copper ring-1 ring-copper/25', mobile: 'text-copper bg-copper/10' },
  { key: 'cases', icon: '📁', label: '案件', active: 'bg-teal/15 text-teal ring-1 ring-teal/25', mobile: 'text-teal bg-teal/10' },
  { key: 'quotes', icon: '🧾', label: '報價', active: 'bg-gold/15 text-gold ring-1 ring-gold/25', mobile: 'text-gold bg-gold/10' },
  { key: 'crm', icon: '👥', label: '客戶', active: 'bg-sage/15 text-sage ring-1 ring-sage/25', mobile: 'text-sage bg-sage/10' },
];

function ActionButtons({ tab, setTab, onOpenCaseSearch, onOpenTools }) {
  const base = 'min-h-11 min-w-11 rounded-lg px-2.5 text-sm font-semibold hover:bg-s3 flex items-center justify-center gap-1';
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={onOpenCaseSearch} className={`${base} text-teal`} title="搜尋案件" aria-label="搜尋案件">🔎<span className="hidden lg:inline text-xs">搜尋</span></button>
      <button type="button" onClick={onOpenTools} className={`${base} text-ink-2`} title="工具" aria-label="工具">🧰<span className="hidden lg:inline text-xs">工具</span></button>
      <button type="button" onClick={() => setTab('settings')} className={`${base} ${tab === 'settings' ? 'bg-accent/15 text-accent' : 'text-ink-2'}`} title="設定" aria-label="設定">⚙️<span className="hidden lg:inline text-xs">設定</span></button>
    </div>
  );
}

export default function Header({ tab, setTab, onOpenCaseSearch, onOpenTools }) {
  const actions = <ActionButtons tab={tab} setTab={setTab} onOpenCaseSearch={onOpenCaseSearch} onOpenTools={onOpenTools} />;
  return (
    <>
      {/* 手機：頂部細列，右上固定三顆 */}
      <header className="lg:hidden flex items-center justify-between bg-s1 border-b border-bdr pl-4 pr-2 h-12 sticky top-0 z-30">
        <span className="font-bold text-accent text-sm tracking-tight">🚛 業務系統</span>
        {actions}
      </header>
      <header className="hidden lg:flex items-center bg-s1 border-b border-bdr px-3 h-14 sticky top-0 z-30 shadow-card">
        <span className="font-bold text-accent mr-3 text-sm tracking-tight shrink-0">🚛 業務系統</span>
        <nav className="flex gap-0.5 flex-1 min-w-0">
          {MAIN_TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t.key ? t.active : 'text-ink-2 hover:bg-s3 hover:text-ink'}`}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>
        {actions}
      </header>
    </>
  );
}
