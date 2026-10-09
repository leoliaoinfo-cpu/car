import { useState, Component } from 'react';
import { useApp } from './context';
import Header from './components/Header';
import TodayPage from './components/today/TodayPage';
import CalendarPage from './components/calendar/CalendarPage';
import CrmPage from './components/crm/CrmPage';
import OperationsPage from './components/deals/OperationsPage';
import SettingsPanel from './components/SettingsPanel';
import MorePage from './components/MorePage';
import ProductCatalog from './components/catalog/ProductCatalog';
import QuoteWorkspace from './components/quote/QuoteWorkspace';
import ReceptionPage from './components/reception/ReceptionPage';
import TimerModal from './components/TimerModal';
import WorkPage from './components/work/WorkPage';
import CasesPage from './components/cases/CasesPage';
import CaseQuickSearch from './components/cases/CaseQuickSearch';
import QuickCreateSheet from './components/QuickCreateSheet';
import { STORAGE_KEYS } from './storageKeys';

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
  const [tab, setTab] = useState('work');
  const [showCatalog, setShowCatalog] = useState(false); // 手機浮動按鈕開啟的覆蓋層
  const [crmFocusId, setCrmFocusId] = useState(null);
  const [receptionStartToken, setReceptionStartToken] = useState(null);
  const [quoteStartToken, setQuoteStartToken] = useState(null);
  const [quoteFocusId, setQuoteFocusId] = useState(null);
  const [quoteCaseContext, setQuoteCaseContext] = useState(null);
  const [clientStartToken, setClientStartToken] = useState(null);
  const [caseStartToken, setCaseStartToken] = useState(null);
  const [caseCreateClientId, setCaseCreateClientId] = useState(null);
  const [caseFocusId, setCaseFocusId] = useState(null);
  const [operationsFocusDealId, setOperationsFocusDealId] = useState(null);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [showCaseSearch, setShowCaseSearch] = useState(false);
  const [showIsolationNotice, setShowIsolationNotice] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.isolationNoticeDismissed) !== '1'; } catch { return true; }
  });

  function dismissIsolationNotice() {
    setShowIsolationNotice(false);
    try { localStorage.setItem(STORAGE_KEYS.isolationNoticeDismissed, '1'); } catch { /* noop */ }
  }

  function openClient(id) {
    setCrmFocusId(id);
    setTab('crm');
  }

  function openCase(id) {
    setCaseFocusId(id);
    setTab('cases');
  }

  function createCaseForClient(clientId) {
    setCaseCreateClientId(clientId || null);
    setCaseStartToken(Date.now());
    setTab('cases');
  }

  function openCaseQuote(caseItem, quoteId = null) {
    if (quoteId) setQuoteFocusId(quoteId);
    else setQuoteCaseContext({ token: Date.now(), caseId: caseItem.id, clientId: caseItem.clientId });
    setTab('quotes');
  }

  function openCaseOperations(dealId = null) {
    setOperationsFocusDealId(dealId);
    setTab('operations');
  }

  function quickCreate(action) {
    const token = Date.now();
    setShowQuickCreate(false);
    if (action === 'case') { setCaseCreateClientId(null); setCaseStartToken(token); setTab('cases'); }
    if (action === 'reception') { setReceptionStartToken(token); setTab('reception'); }
    if (action === 'quote') { setQuoteStartToken(token); setTab('quotes'); }
    if (action === 'client') { setClientStartToken(token); setTab('crm'); }
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
    <div className="app-shell min-h-screen bg-bg font-sans text-ink">
      {/* DB 不可用提示（隱私模式 / file:// 限制等真正的存取錯誤）*/}
      {dbUnavailable && (
        <div className="bg-danger/10 border-b border-danger/30 px-4 py-1.5 text-xs text-danger">
          ⚠️ 無法存取瀏覽器儲存空間，目前的變動<strong>不會被保存</strong>。
          若使用無痕/私密瀏覽請改用一般模式；一般模式下仍出現請截圖回報。
        </div>
      )}

      {showIsolationNotice && (
        <div className="bg-accent/10 border-b border-accent/30 px-4 py-2.5 text-xs text-ink-2 flex items-start gap-3">
          <div className="flex-1 leading-relaxed">
            <strong className="text-accent">✅ 汽車系統已改用獨立儲存空間。</strong>
            舊的共用資料沒有刪除。若此頁暫時沒有汽車資料，請到「設定 → 雲端同步」重新連線汽車系統專用的私人 repo。
          </div>
          <button onClick={() => setTab('settings')} className="btn-outline text-[11px] shrink-0">開啟設定</button>
          <button onClick={dismissIsolationNotice} className="text-ink-3 text-lg leading-none shrink-0" aria-label="關閉提示">×</button>
        </div>
      )}

      <Header tab={tab} setTab={setTab} onOpenCaseSearch={() => setShowCaseSearch(true)} />

      <main className="pb-20 lg:pb-0">
        <div className="anim-fade-in" key={tab}>
          {tab === 'work' && <WorkPage onOpenClient={openClient} onOpenCase={openCase} onQuickCreate={() => setShowQuickCreate(true)} />}
          {tab === 'cases' && <CasesPage focusId={caseFocusId} onFocusConsumed={() => setCaseFocusId(null)} startNewToken={caseStartToken} initialClientId={caseCreateClientId} onStartConsumed={() => setCaseStartToken(null)} onNewClosed={() => setCaseCreateClientId(null)} onOpenClient={openClient} onOpenQuote={openCaseQuote} onOpenOperations={openCaseOperations} />}
          {tab === 'today' && <TodayPage onOpenClient={openClient} onOpenSettings={() => setTab('settings')} onOpenReception={() => { setReceptionStartToken(Date.now()); setTab('reception'); }} />}
          {tab === 'reception' && <ReceptionPage startNewToken={receptionStartToken} onStartConsumed={() => setReceptionStartToken(null)} onOpenClient={openClient} onOpenQuotes={() => setTab('quotes')} onOpenCatalog={() => setShowCatalog(true)} />}
          {tab === 'calendar' && <CalendarPage onOpenClient={openClient} />}
          {tab === 'crm' && (
            <CrmPage focusId={crmFocusId} onFocusConsumed={() => setCrmFocusId(null)} startNewToken={clientStartToken} onStartConsumed={() => setClientStartToken(null)} onOpenCase={openCase} onCreateCase={createCaseForClient} />
          )}
          {tab === 'quotes' && <QuoteWorkspace onOpenClient={openClient} startNewToken={quoteStartToken} onStartConsumed={() => setQuoteStartToken(null)} focusId={quoteFocusId} onFocusConsumed={() => setQuoteFocusId(null)} caseContext={quoteCaseContext} onCaseContextConsumed={() => setQuoteCaseContext(null)} />}
          {tab === 'catalog' && <ProductCatalog />}
          {tab === 'operations' && <OperationsPage onBack={() => setTab('more')} onOpenClient={openClient} focusDealId={operationsFocusDealId} />}
          {tab === 'settings' && <SettingsPanel onClose={() => setTab('more')} />}
          {tab === 'more' && <MorePage onNavigate={setTab} />}
        </div>
      </main>

      {/* 手機全域新增：固定在單手可按範圍，所有主要流程共用。 */}
      {['work', 'cases', 'crm'].includes(tab) && <button
        onClick={() => setShowQuickCreate(true)}
        className="lg:hidden fixed right-4 bottom-24 z-40 w-14 h-14 rounded-full bg-accent text-on-accent shadow-panel flex items-center justify-center active:scale-95 transition-transform text-3xl font-light"
        title="快速新增"
      >
        ＋
      </button>}

      <button type="button" onClick={() => setShowCaseSearch(true)}
        className="lg:hidden fixed left-4 bottom-24 z-40 min-h-14 min-w-14 rounded-full border border-teal/40 bg-s1 text-teal shadow-panel flex items-center justify-center active:scale-95 transition-transform text-xl"
        title="快速搜尋案件" aria-label="快速搜尋案件">🔎</button>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-s1 border-t border-bdr flex z-30 pb-safe">
        {[
          { key: 'work', icon: '✓', label: '工作', active: 'text-copper bg-copper/10' },
          { key: 'cases', icon: '📁', label: '案件', active: 'text-teal bg-teal/10' },
          { key: 'crm', icon: '👥', label: '客戶', active: 'text-sage bg-sage/10' },
          { key: 'more', icon: '•••', label: '更多', active: 'text-violet bg-violet/10' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-colors ${
              (tab === item.key || (item.key === 'more' && ['today', 'reception', 'quotes', 'calendar', 'catalog', 'operations', 'settings'].includes(tab))) ? item.active : 'text-ink-3'
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </nav>
      {showQuickCreate && <QuickCreateSheet onClose={() => setShowQuickCreate(false)} onAction={quickCreate} />}
      {showCaseSearch && <CaseQuickSearch onClose={() => setShowCaseSearch(false)} onOpenCase={openCase} />}
      {showCatalog && <ProductCatalog onClose={() => setShowCatalog(false)} />}
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
