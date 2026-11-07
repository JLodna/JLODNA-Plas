// Charge JLodni sur les pages de la boutique, sans bloquer le rendu (après le chargement, en temps libre).
// Utilisation : dans js/layout.js, à la fin de initLayout() ->  import('./jlodni-loader.js');
import { sb } from './supabase.js';

if (!location.pathname.startsWith('/admin')) {
  window.JLODNI_CONFIG = Object.assign(
    {
      loginUrl: '/login', // confirmé par layout.js / login.js : ta vraie page de connexion client
      getAccessToken: async () => {
        if (!sb) return null;
        const { data } = await sb.auth.getSession();
        return (data && data.session && data.session.access_token) || null;
      },
      // Même appel que les boutons « Ajouter au panier » de la boutique (products.js -> bindAddButtons)
      addToCart: async ({ variantId, productId, quantity, max }) => {
        const { addItem } = await import('./cart.js');
        await addItem(variantId, productId, quantity, max || 99);
      },
      offsetBottom: 16, // augmente cette valeur si le widget gêne un bouton de navigation mobile
    },
    window.JLODNI_CONFIG || {}
  );
  const load = () => {
    const s = document.createElement('script');
    s.src = '/jlodni/widget.js';
    s.defer = true;
    document.head.appendChild(s);
  };
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 4000 });
  else setTimeout(load, 2000);
}
