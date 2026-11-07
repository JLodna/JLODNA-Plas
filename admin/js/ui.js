import { esc } from '/js/utils.js';
export function modal(html) {
  const m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.innerHTML = `<div>${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); }); document.body.append(m);
  const onKey = (e) => { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', onKey); } }; document.addEventListener('keydown', onKey);
  return m;
}
export const confirmBox = (msg) => new Promise((res) => {
  const m = modal(`<p>${esc(msg)}</p><div class="row"><button class="btn danger" id="y">Confirmer</button><button class="btn ghost" id="n">Annuler</button></div>`);
  m.querySelector('#y').onclick = () => { m.remove(); res(true); }; m.querySelector('#n').onclick = () => { m.remove(); res(false); };
});
export const table = (cols, rows) => `<div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${cols.length}" class="muted">Aucune donnée.</td></tr>`}</tbody></table></div>`;
export const csv = (v) => v;
