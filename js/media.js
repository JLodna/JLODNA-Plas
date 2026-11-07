// Validation de fichiers AVANT envoi : taille + signature réelle du fichier (pas seulement l'extension ni le type annoncé par le navigateur).
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf' };
const ascii = (b, from, to) => String.fromCharCode(...b.slice(from, to));

export async function sniffType(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'image/png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(b, 4, 8) === 'ftyp') return 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

// Retourne { error } ou { mime } (mime = type RÉEL détecté, à utiliser pour l'upload).
export async function checkFile(file, { types, maxMB }) {
  if (!file) return { error: 'Aucun fichier.' };
  if (file.size > maxMB * 1024 * 1024) return { error: `Fichier trop lourd (max ${maxMB} Mo).` };
  const mime = await sniffType(file);
  if (!mime || !types.includes(mime)) return { error: 'Format non autorisé.' };
  return { mime };
}
export const randomName = (mime) => `${crypto.randomUUID()}.${EXT[mime]}`;
