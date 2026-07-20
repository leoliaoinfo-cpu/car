import { useState, Component } from 'react';
import { useApp } from './context';
import Header from './components/Header';
import TodayPage from './components/today/TodayPage';
import CalendarPage from './components/calendar/CalendarPage';
import CrmPage from './components/crm/CrmPage';
import DealsPage from './components/deals/DealsPage';
import SettingsPanel from './components/SettingsPanel';
import ProductCatalog from './components/catalog/ProductCatalog';
import TimerModal from './components/TimerModal';

// ── Error Boundary — 任何子元件炸掉都能顯示有意義的訊息 ──────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err) {
    return { error: err };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-bg p-8 font-sans">
          <h2 className="text-danger font-bold text-lg mb-3">⚠️ 發生錯誤，請重新整理頁面</h2>
          <pre className="bg-danger/10 text-ink-2 p-4 rounded-lg text-xs overflow-x-auto">
            {String(this.state.error)}
            {'\n'}
            {this.state.error?.stack}
          </pre>
          <p className="text-ink-2 text-sm mt-3">
            若持續出現，請按 F12 → Console 截圖後回報。
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-5 py-2 bg-accent text-on-accent rounded-lg cursor-pointer border-none"
          >
            重試
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main App ──────────────────────────────────────────────────────────────────
function AppInner() {
  const { loading, dbUnavailable, dbBlocked } = useApp();
  const [tab, setTab] = useState('today');
  const [showSettings, setShowSettings] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false); // 手機浮動按鈕開啟的覆蓋層
  const [showDeals, setShowDeals] = useState(false); // 業績表（從設定經密碼解鎖後開啟）
  const [crmFocusId, setCrmFocusId] = useState(null);

  function openClient(id) {
    setCrmFocusId(id);
    setTab('crm');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="text-center">
          <div
            className="w-12 h-12 rounded-full border-4 border-s3 border-t-accent mx-auto mb-4"
            style={{ animation: 'spin 0.8s linear infinite' }}
          />
          <p className="text-ink-3 text-sm">載入中…</p>
          {dbBlocked && (
            <p className="text-danger text-xs mt-3 max-w-xs">
              偵測到另一個分頁正在使用舊版資料庫，請關閉那個分頁（或本系統的其他分頁）後即可自動繼續。
            </p>
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      {/* DB 不可用提示（隱私模式 / file:// 限制等真正的存取錯誤）*/}
      {dbUnavailable && (
        <div className="bg-danger/10 border-b border-danger/30 px-4 py-1.5 text-xs text-danger">
          ⚠️ 無法存取瀏覽器儲存空間，目前的變動<strong>不會被保存</strong>。
          若使用無痕/私密瀏覽請改用一般模式；一般模式下仍出現請截圖回報。
        </div>
      )}

      <Header tab={tab} setTab={setTab} onSettings={() => setShowSettings(true)} />

      <main className="pb-20 md:pb-0">
        <div className="anim-fade-in" key={tab}>
          {tab === 'today' && <TodayPage onOpenClient={openClient} />}
          {tab === 'calendar' && <CalendarPage onOpenClient={openClient} />}
          {tab === 'crm' && (
            <CrmPage focusId={crmFocusId} onFocusConsumed={() => setCrmFocusId(null)} />
          )}
          {tab === 'catalog' && <ProductCatalog />}
        </div>
      </main>

      {/* 手機：型錄浮動按鈕（右下角，不擋底部導覽） */}
      <button
        onClick={() => setShowCatalog(true)}
        className="md:hidden fixed right-4 bottom-28 z-40 w-14 h-14 rounded-full bg-accent text-on-accent shadow-panel flex flex-col items-center justify-center active:scale-95 transition-transform"
        title="產品型錄"
      >
        <span className="text-xl leading-none">📖</span>
        <span className="text-[9px] font-medium mt-0.5">型錄</span>
      </button>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-s1 border-t border-bdr flex z-30 pb-safe">
        {[
          { key: 'today', icon: '☀️', label: '今日' },
          { key: 'calendar', icon: '📅', label: '行事曆' },
          { key: 'crm', icon: '👥', label: '客戶' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-colors ${
              tab === item.key ? 'text-accent' : 'text-ink-3'
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
        <button
          onClick={() => setShowSettings(true)}
          className="flex-1 flex flex-col items-center py-2.5 gap-0.5 text-ink-3"
        >
          <span className="text-lg leading-none">⚙️</span>
          <span className="text-[10px] font-medium">設定</span>
        </button>
      </nav>

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onOpenDeals={() => { setShowSettings(false); setShowDeals(true); }}
        />
      )}
      {showCatalog && <ProductCatalog onClose={() => setShowCatalog(false)} />}

      {/* 業績表：從設定解鎖後全螢幕開啟（不放主導覽，避免給客人看到） */}
      {showDeals && (
        <div className="fixed inset-0 z-50 bg-bg overflow-y-auto anim-fade-in">
          <div className="sticky top-0 z-10 flex items-center justify-between bg-s1 border-b border-bdr px-4 h-14">
            <span className="font-bold text-accent text-base">📈 業績表</span>
            <button onClick={() => setShowDeals(false)} className="btn-ghost gap-1.5 text-sm">✕ 關閉</button>
          </div>
          <DealsPage onOpenClient={(id) => { setShowDeals(false); openClient(id); }} />
        </div>
      )}
      <TimerModal />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
