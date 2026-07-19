// 業績表密碼：以 SHA-256 雜湊儲存（不存明文），僅供本地防止客人偷看業績。
// 不是高強度加密，但足以擋住隨手翻看的人。
export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
