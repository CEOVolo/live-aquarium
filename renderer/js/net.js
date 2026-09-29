/** WebSocket link to the Director with automatic reconnect. */
export class Net {
  constructor({ role = 'renderer', token = '', onMessage, onStatus }) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // With ADMIN_TOKEN set, only a renderer that passes it counts as the stream for /healthz.
    this.url = `${proto}://${location.host}/ws?role=${role}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    this.onMessage = onMessage;
    this.onStatus = onStatus ?? (() => {});
    this.retry = 0;
    this.ws = null;
    this.connected = false;
  }

  connect() {
    if (location.protocol === 'file:') {
      this.onStatus('offline');
      return;
    }
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.onStatus('offline');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.onStatus('online');
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      this.onStatus(was ? 'reconnecting' : 'offline');
      const delay = Math.min(10000, 800 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }
}
