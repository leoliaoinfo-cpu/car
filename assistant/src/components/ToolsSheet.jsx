const TOOLS = [
  { key: 'performance', icon: '💰', title: '業績與成本', note: '需數字密碼', primary: true },
  { key: 'height', icon: '📏', title: '車高試算', note: '箱體／帆布高度' },
  { key: 'catalog', icon: '📖', title: '產品型錄', note: '原廠圖文' },
  { key: 'specs', icon: '🚚', title: 'K2500 規格', note: '車型、售價、載重' },
  { key: 'suppliers', icon: '🏭', title: '廠商名冊', note: '合作廠商聯絡方式' },
];

export default function ToolsSheet({ onClose, onAction }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center lg:justify-center" role="dialog" aria-modal="true" aria-label="工具">
      <button type="button" className="absolute inset-0 bg-black/35 backdrop-blur-sm" onClick={onClose} aria-label="關閉" />
      <section className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl lg:rounded-2xl bg-s1 border border-bdr p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-panel anim-slide-up">
        <div className="mx-auto w-12 h-1 rounded-full bg-bdr lg:hidden" />
        <div className="flex items-center justify-between mt-3 lg:mt-0">
          <h2 className="text-xl font-bold text-ink">🧰 工具</h2>
          <button type="button" onClick={onClose} className="btn-ghost w-11 h-11 px-0 text-xl" aria-label="關閉">×</button>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          {TOOLS.map((item) => (
            <button key={item.key} type="button" onClick={() => onAction(item.key)}
              className={`card min-h-24 p-3 text-left active:scale-[0.98] transition-transform ${item.primary ? 'col-span-2 border-accent/50' : ''}`}>
              <span className="text-2xl">{item.icon}</span>
              <strong className="block text-ink mt-1">{item.title}</strong>
              <span className="block text-[11px] text-ink-3 mt-0.5">{item.note}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
