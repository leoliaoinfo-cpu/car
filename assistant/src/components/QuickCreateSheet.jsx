const ACTIONS = [
  { key: 'case', icon: '📁', title: '新增案件', note: '購車或改車' },
  { key: 'reception', icon: '🤝', title: '開始接待', note: '快速記錄需求' },
  { key: 'quote', icon: '🧾', title: '建立報價', note: '直接開新報價' },
  { key: 'client', icon: '👤', title: '新增客戶', note: '只建立基本資料' },
];

export default function QuickCreateSheet({ onClose, onAction }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center lg:justify-center" role="dialog" aria-modal="true" aria-label="快速新增">
      <button type="button" className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onClose} aria-label="關閉" />
      <section className="relative w-full max-w-lg rounded-t-3xl lg:rounded-2xl bg-s1 border border-bdr p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel anim-slide-up">
        <div className="mx-auto w-12 h-1 rounded-full bg-bdr lg:hidden" />
        <div className="flex items-center justify-between mt-3 lg:mt-0">
          <div><p className="text-[11px] tracking-[0.16em] text-accent font-bold">QUICK CREATE</p><h2 className="text-xl font-bold text-ink mt-1">要新增什麼？</h2></div>
          <button type="button" onClick={onClose} className="btn-ghost w-11 h-11 px-0 text-xl">×</button>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          {ACTIONS.map((item) => <button key={item.key} type="button" onClick={() => onAction(item.key)} className="card min-h-28 p-4 text-left active:scale-[0.98] transition-transform"><span className="text-2xl">{item.icon}</span><strong className="block text-ink mt-2">{item.title}</strong><span className="block text-[11px] text-ink-3 mt-1">{item.note}</span></button>)}
        </div>
      </section>
    </div>
  );
}
