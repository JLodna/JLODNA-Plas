// QR code généré dans le navigateur (bibliothèque MIT qrcode-generator, hébergée dans /js/vendor : aucune requête externe, aucune donnée envoyée).
export const qrAvailable = () => typeof window.qrcode === 'function';
export function qrCanvas(text, px = 320) {
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), quiet = 4, cell = Math.max(2, Math.floor(px / (n + quiet * 2)));
  const size = cell * (n + quiet * 2);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
  c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'QR code du profil');
  return c;
}
