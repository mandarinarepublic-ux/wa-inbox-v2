// notif.js — Avisos de mensajes nuevos para WA-Inbox
// Muestra:
//   (1) un contador en la pestaña del navegador (solo cuando NO estás mirando la app),
//   (2) un punto rojo sobre el ícono (favicon),
//   (3) un badge/* en el ícono de la app si está instalada (siempre que haya pendientes).
// Se limpia solo cuando vuelves a la app.

let baseTitle = typeof document !== 'undefined' ? document.title : '';
let baseFavicon = null;
let pendientes = 0;

function getFaviconLink() {
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

function resetFavicon() {
  if (baseFavicon) getFaviconLink().href = baseFavicon;
}

// Dibuja un punto rojo (con número si cabe) sobre el ícono actual
function favConPunto(count) {
  const link = getFaviconLink();
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const pintarPunto = () => {
    const r = size * 0.3;
    ctx.beginPath();
    ctx.arc(size - r, r, r, 0, Math.PI * 2);
    ctx.fillStyle = "#e02424";
    ctx.fill();
    if (count > 0 && count < 100) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${r}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(count), size - r, r + 1);
    }
    link.href = canvas.toDataURL("image/png");
  };

  if (baseFavicon) {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, size, size); pintarPunto(); };
    img.onerror = pintarPunto;
    img.src = baseFavicon;
  } else {
    pintarPunto();
  }
}

function render() {
  const oculto = document.visibilityState === "hidden";
  // Contador en la pestaña + punto en el favicon: solo si NO estás viendo la app
  if (pendientes > 0 && oculto) {
    document.title = `(${pendientes}) ${baseTitle}`;
    favConPunto(pendientes);
  } else {
    document.title = baseTitle;
    resetFavicon();
  }
  // Badge en el ícono de la app: refleja siempre los pendientes
  if ("setAppBadge" in navigator) {
    if (pendientes > 0) navigator.setAppBadge(pendientes).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }
}

// === Notificaciones del navegador (alerta de leads 🔥 calientes cerca de las 24h) ===
// "Push" mientras la app está ABIERTA o en 2º plano (usa la Notification API, sin
// servidor VAPID). Push con la app totalmente cerrada = fase 2 (service worker + web-push).
let permisoPedido = false;
export function pedirPermisoNotif() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default' && !permisoPedido) {
    permisoPedido = true;
    Notification.requestPermission().catch(() => {});
  }
}
export function notificar(titulo, cuerpo, tag) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try { new Notification(titulo, { body: cuerpo, tag: tag || undefined, renotify: false }); } catch (e) {}
}

// === Función que vas a usar ===
// Pásale cuántos mensajes sin leer hay. Pon 0 para limpiar.
export function actualizarNoLeidos(n) {
  if (typeof window === 'undefined') return;
  pendientes = n || 0;
  render();
}

// Inicialización automática al importar — solo en browser
if (typeof window !== 'undefined') {
  (function init() {
    baseFavicon = getFaviconLink().href || null;
    const alVolver = () => { pendientes = 0; render(); };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") alVolver();
      else render();
    });
    window.addEventListener("focus", alVolver);
  })();
}
