// Registra o service worker só em produção (HTTPS e fora de localhost),
// para que o desenvolvimento local nunca sirva arquivos de cache.

const host = window.location.hostname;
const isLocal =
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host === '[::1]' ||
  host.endsWith('.local') ||
  /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host);

if ('serviceWorker' in navigator && window.location.protocol === 'https:' && !isLocal) {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' — o navegador sempre busca o sw.js na rede ao checar atualização.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {
      // Sem service worker o app continua funcionando normalmente, só não fica disponível offline.
    });
  });
}
