/** Resources owned by one FAST page visit. The runner never changes document-wide globals. */
export function createFastCheckHost(root: HTMLElement, base: string, onExit: () => void, onRestart: () => void) {
  let disposed = false;
  const requests = new AbortController();
  const timers = new Set<number>();
  const frames = new Set<number>();
  const streams = new Set<MediaStream>();
  const models = new Set<{ close(): void }>();
  const resource = (path: string) => new URL(path, base).href;

  return {
    get disposed() { return disposed; },
    resource,
    // Preserve the copied runner's element IDs, but restrict lookups and overlays to this page.
    document: {
      body: root,
      getElementById: (id: string) => root.querySelector<HTMLElement>(`[id="${id}"]`),
      querySelector: (selector: string) => root.querySelector(selector),
      createElement: (tag: string) => root.ownerDocument.createElement(tag),
    },
    fetch: (path: string, options: RequestInit = {}) => {
      if (disposed) return Promise.reject(new DOMException("FAST page closed", "AbortError"));
      return globalThis.fetch(resource(path), { ...options, signal: requests.signal });
    },
    async getUserMedia(constraints: MediaStreamConstraints) {
      if (disposed) throw new DOMException("FAST page closed", "AbortError");
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (disposed) {
        stream.getTracks().forEach(track => track.stop());
        throw new DOMException("FAST page closed", "AbortError");
      }
      streams.add(stream);
      return stream;
    },
    ownModel<T extends { close(): void }>(model: T): T {
      if (disposed) model.close();
      else models.add(model);
      return model;
    },
    setTimeout(callback: () => void, delay: number) {
      if (disposed) return 0;
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (!disposed) callback();
      }, delay);
      timers.add(id);
      return id;
    },
    clearTimeout(id: number) { window.clearTimeout(id); timers.delete(id); },
    requestAnimationFrame(callback: FrameRequestCallback) {
      if (disposed) return 0;
      const id = window.requestAnimationFrame(time => {
        frames.delete(id);
        if (!disposed) callback(time);
      });
      frames.add(id);
      return id;
    },
    cancelAnimationFrame(id: number) { window.cancelAnimationFrame(id); frames.delete(id); },
    onMessage(data: { type: string }) { if (!disposed && data.type === "exit") onExit(); },
    onRestart() { if (!disposed) onRestart(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      requests.abort();
      timers.forEach(id => window.clearTimeout(id));
      frames.forEach(id => window.cancelAnimationFrame(id));
      streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      models.forEach(model => { try { model.close(); } catch { /* Already closed by the runner. */ } });
      timers.clear(); frames.clear(); streams.clear(); models.clear();
    },
  };
}
