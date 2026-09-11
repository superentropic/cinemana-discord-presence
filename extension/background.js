// The extension service worker owns the loopback socket. Content scripts remain
// focused purely on extracting player state from Cinemana's isolated DOM.
const SOCKET_URL = 'ws://127.0.0.1:48321';
let socket = null;
let reconnectTimer = null;
let latestPayload = null;

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(SOCKET_URL);
    socket.onopen = () => { if (latestPayload) socket.send(latestPayload); };
    socket.onclose = () => {
      socket = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 3000);
    };
  } catch { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 3000); }
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'presence' || typeof message.payload !== 'object') return;
  latestPayload = JSON.stringify(message.payload);
  connect();
  if (socket?.readyState === WebSocket.OPEN) socket.send(latestPayload);
});
