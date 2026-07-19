import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 產品型錄：直接展示公司原廠行銷型錄圖片（車型、配件、報價），方便當場給客戶看。
 * 圖片放在 public/catalog/，由 manifest.json 決定順序與分類標題；
 * 縮圖 lazy-load、Service Worker 快取（斷網也能開）。
 *
 * - 傳入 onClose → 以全螢幕覆蓋層呈現（手機浮動按鈕、報價單入口）
 * - 不傳 onClose → 內嵌成頁面（電腦版「型錄」分頁）
 */
export default function ProductCatalog({ onClose }) {
  const [items, setItems] = useState(null); // null=載入中, []=失敗/空
  const [lightbox, setLightbox] = useState(null); // 放大檢視的 index

  useEffect(() => {
    let alive = true;
    fetch('catalog/manifest.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (alive) setItems(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  const total = items?.length || 0;
  const go = useCallback((dir) => {
    setLightbox((i) => (i == null ? i : (i + dir + total) % total));
  }, [total]);

  // 手勢換頁：單指左右滑動切上一張／下一張（雙指縮放不觸發）
  const touchRef = useRef(null);
  const onTouchStart = (e) => {
    if (e.touches.length !== 1) { touchRef.current = null; return; }
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };
  const onTouchEnd = (e) => {
    const s = touchRef.current;
    touchRef.current = null;
    if (!s || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    // 水平位移夠大、且明顯比垂直大、時間不太久 → 換頁
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - s.t < 700) {
      go(dx < 0 ? 1 : -1);
    }
  };

  // 放大檢視時：← → 切換、Esc 關閉
  useEffect(() => {
    if (lightbox == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, go]);

  const gallery = (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-bold text-lg text-ink flex items-center gap-2">📖 產品型錄</h2>
          <p className="text-xs text-ink-3 mt-0.5">KIA 卡旺 2026 車型與配件 · 點圖片可放大展示給客戶</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1" title="關閉">✕</button>
        )}
      </div>

      {items == null ? (
        <div className="py-16 text-center text-ink-3 text-sm">
          <div className="w-8 h-8 rounded-full border-4 border-s3 border-t-accent mx-auto mb-3"
            style={{ animation: 'spin 0.8s linear infinite' }} />
          載入型錄中…
        </div>
      ) : total === 0 ? (
        <div className="py-16 text-center text-ink-3 text-sm">尚未提供型錄圖片</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((it, idx) => (
            <button key={it.slug} onClick={() => setLightbox(idx)}
              className="group text-left bg-s1 rounded-xl border border-bdr overflow-hidden shadow-card hover:shadow-panel transition-shadow">
              <div className="relative bg-s3" style={{ aspectRatio: '3 / 4' }}>
                <img src={`catalog/${it.slug}.jpg`} alt={it.label} loading="lazy" decoding="async"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
              </div>
              <div className="px-2.5 py-2 flex items-center gap-1.5">
                <span className="text-[10px] text-ink-3 font-mono shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                <span className="text-xs font-medium text-ink truncate">{it.label}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {onClose ? (
        <div className="fixed inset-0 z-50 bg-bg overflow-y-auto p-4 pb-20 md:p-6 anim-fade-in">
          {gallery}
        </div>
      ) : (
        <div className="p-4 md:p-6">{gallery}</div>
      )}

      {/* 放大檢視（lightbox） */}
      {lightbox != null && items && items[lightbox] && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col anim-fade-in"
          onClick={() => setLightbox(null)}
          onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="flex items-center justify-between px-4 py-3 text-white shrink-0">
            <span className="text-sm font-medium">
              {items[lightbox].label}
              <span className="text-white/50 ml-2 text-xs">{lightbox + 1} / {total}</span>
            </span>
            <button onClick={() => setLightbox(null)}
              className="text-white/80 hover:text-white text-2xl leading-none px-2">✕</button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-auto px-2 pb-4 min-h-0">
            <img src={`catalog/${items[lightbox].slug}.jpg`} alt={items[lightbox].label}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              style={{ touchAction: 'pinch-zoom' }} />
          </div>
          {/* 左右切換 + 底部頁數圓點（手機可直接左右滑動換頁） */}
          {total > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); go(-1); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl flex items-center justify-center backdrop-blur">‹</button>
              <button onClick={(e) => { e.stopPropagation(); go(1); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl flex items-center justify-center backdrop-blur">›</button>
              <div className="shrink-0 flex items-center justify-center gap-1.5 pb-4 pt-1 flex-wrap px-4">
                {items.map((it, i) => (
                  <button key={it.slug} onClick={(e) => { e.stopPropagation(); setLightbox(i); }}
                    aria-label={it.label}
                    className={`h-1.5 rounded-full transition-all ${i === lightbox ? 'w-5 bg-white' : 'w-1.5 bg-white/40'}`} />
                ))}
              </div>
              <p className="shrink-0 text-center text-white/40 text-[11px] pb-3 md:hidden">← 滑動換頁 →</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
