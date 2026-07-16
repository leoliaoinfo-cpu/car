import { useState, Component } from 'react';
import { useApp } from './context';
import Header from './components/Header';
import TodayPage from './components/today/TodayPage';
import CalendarPage from './components/calendar/CalendarPage';
import CrmPage from './components/crm/CrmPage';
import DealsPage from './components/deals/DealsPage';
import SettingsPanel from './components/SettingsPanel';
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
  const { loading, dbUnavailable } = useApp();
  const [tab, setTab] = useState('today');
  const [showSettings, setShowSettings] = useState(false);
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
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      {/* DB 不可用提示（隱私模式 / file:// 限制）*/}
      {dbUnavailable && (
        <div className="bg-s2 border-b border-bdr px-4 py-1.5 text-xs text-ink-2">
          ⚠️ 儲存功能受限（瀏覽器安全設定）。資料不會被保存。建議改用
          <strong> http://localhost</strong> 方式開啟，或啟用 GitHub Pages。
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
          {tab === 'deals' && <DealsPage onOpenClient={openClient} />}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-s1 border-t border-bdr flex z-30 pb-safe">
        {[
          { key: 'today', icon: '☀️', label: '今日' },
          { key: 'calendar', icon: '📅', label: '行事曆' },
          { key: 'crm', icon: '👥', label: '客戶' },
          { key: 'deals', icon: '📈', label: '業績' },
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

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
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
