// 上傳的照片 / 名片在存進 IndexedDB 前先壓縮，避免佔用大量空間、造成記憶體爆滿。
// 縮到最長邊 maxDim、輸出 JPEG（有透明需求的極少，統一 JPEG 最省），回傳 Blob。
export async function compressImage(file, { maxDim = 1600, quality = 0.72 } = {}) {
  const img = await loadImageFromFile(file);
  try {
    const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return { blob: blob || file, w, h };
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('圖片載入失敗')); };
    img.src = URL.createObjectURL(file);
  });
}

/** 位元組轉人類可讀（KB / MB） */
export function formatBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
