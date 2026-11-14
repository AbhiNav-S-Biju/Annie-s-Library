// Full-screen page reader with a realistic page-flip (StPageFlip) or an instant-turn fallback.
// Page source interface: { count, aspect?, load(i, {width, hi}) -> url|Promise<url>, release?(i) }
import { CONFIG } from './config.js';
import * as store from './storage.js';
import { icons } from './icons.js';
import { pushOverlay } from './overlay.js';
import { loadPageFlip } from './vendor.js';

const R = CONFIG.reader;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const flipEnabled = () => {
  const s = store.getSettings();
  return s.flip === undefined || s.flip === null ? !reducedMotion() : !!s.flip;
};

let active = null;
export function isReaderOpen() { return !!active; }

/**
 * @param {object} o
 * @param {object} o.book       Normalised book ({key,title,...}).
 * @param {Promise<object>|object} o.source  Page source (may be a promise; reader shows a loader meanwhile).
 * @param {(book, page) => string} [o.reportUrl]
 * @param {string} [o.externalUrl]
 * @param {() => void} [o.onClose]
 */
export function openReader(o) {
  if (active) active.destroy();
  active = new Reader(o);
  window.__mlibReader = active; // for debugging in the console
  return active;
}

class Reader {
  constructor({ book, source, reportUrl, externalUrl, onClose }) {
    this.book = book;
    this.reportUrl = reportUrl;
    this.externalUrl = externalUrl;
    this.onClose = onClose;
    this.page = 0;
    this.count = 0;
    this.loaded = new Map(); // page -> {url, hi}
    this.zoom = { s: 1, x: 0, y: 0 };
    this.listeners = [];
    this.buildDom();
    this.closeViaHistory = pushOverlay(() => this.destroy());
    this.enterFullscreen(); // must run inside the user gesture that opened us
    this.requestWakeLock();
    this.showBars();
    Promise.all([Promise.resolve(source), flipEnabled() ? loadPageFlip().catch(() => null) : null])
      .then(([src]) => { if (!this.dead) this.start(src); })
      .catch((e) => { if (!this.dead) this.fail(e); });
  }

  // ---------- DOM ----------
  buildDom() {
    const el = document.createElement('div');
    el.className = 'reader';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', this.book.title);
    el.innerHTML = `
      <div class="r-stage"><div class="r-zoom"><div class="r-host"></div></div></div>
      <div class="r-status"><div class="spinner"></div><p>പുസ്തകം തുറക്കുന്നു… Opening book</p></div>
      <header class="r-bar r-top">
        <button class="icon-btn r-back" aria-label="Close reader">${icons.back}</button>
        <div class="r-title"><span class="r-name"></span><span class="r-count" aria-live="polite"></span></div>
        <button class="icon-btn r-bm" aria-label="Bookmark this page" aria-pressed="false">${icons.bookmark}</button>
        <button class="icon-btn r-more" aria-label="Reader options" aria-expanded="false">${icons.more}</button>
      </header>
      <footer class="r-bar r-bottom">
        <span class="r-slider-label" aria-hidden="true"></span>
        <input class="r-slider" type="range" min="1" max="1" value="1" aria-label="Go to page">
      </footer>
      <div class="r-menu" hidden>
        <label class="switch-row"><span>Page-turn animation<small>ഏട് മറിക്കൽ</small></span>
          <input type="checkbox" class="r-flip-toggle" role="switch"></label>
        <div class="r-bookmarks"></div>
        <a class="menu-link r-report" target="_blank" rel="noopener">${icons.flag}<span>Report bad scan</span></a>
        <a class="menu-link r-ext" target="_blank" rel="noopener">${icons.external}<span>Open on archive.org</span></a>
      </div>
      <div class="r-toast" role="status" hidden></div>`;
    this.el = el;
    this.stage = el.querySelector('.r-stage');
    this.zoomEl = el.querySelector('.r-zoom');
    this.host = el.querySelector('.r-host');
    this.statusEl = el.querySelector('.r-status');
    this.countEl = el.querySelector('.r-count');
    this.slider = el.querySelector('.r-slider');
    this.sliderLabel = el.querySelector('.r-slider-label');
    this.menu = el.querySelector('.r-menu');
    this.bmBtn = el.querySelector('.r-bm');
    el.querySelector('.r-name').textContent = this.book.title;
    const ext = el.querySelector('.r-ext');
    if (this.externalUrl) ext.href = this.externalUrl; else ext.remove();
    document.body.appendChild(el);
    document.documentElement.classList.add('reader-open');

    el.querySelector('.r-back').addEventListener('click', () => this.close());
    this.bmBtn.addEventListener('click', () => this.toggleBookmark());
    el.querySelector('.r-more').addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(); });
    const flipToggle = el.querySelector('.r-flip-toggle');
    flipToggle.checked = flipEnabled();
    flipToggle.addEventListener('change', async () => {
      store.setSetting('flip', flipToggle.checked);
      if (flipToggle.checked) await loadPageFlip().catch(() => this.toast('Could not load the page-flip library; using instant turns.'));
      this.rebuildEngine(true);
    });
    this.slider.addEventListener('input', () => {
      this.sliderLabel.textContent = this.slider.value;
      this.sliderLabel.classList.add('on');
      const pct = (this.slider.value - 1) / Math.max(1, this.count - 1);
      this.sliderLabel.style.setProperty('--pct', pct);
      this.keepBars();
    });
    this.slider.addEventListener('change', () => {
      this.sliderLabel.classList.remove('on');
      this.goTo(+this.slider.value - 1, false);
    });
    this.menu.addEventListener('click', (e) => e.stopPropagation());
    ['pointerdown', 'focusin'].forEach((t) => el.querySelectorAll('.r-bar').forEach((b) => b.addEventListener(t, () => this.keepBars())));
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  // ---------- lifecycle ----------
  start(src) {
    this.src = src;
    this.count = src.count;
    const saved = store.getProgress(this.book.key);
    const startAt = saved && saved.page > 0 && saved.page < this.count ? saved.page : 0;
    this.page = startAt;
    this.slider.max = String(this.count);
    if (!store.shelfEntry(this.book.key)?.status) store.setStatus(this.book, 'reading');

    // Build immediately with the best-known aspect; correct it once a real page has been measured.
    const aspectKey = 'aspect:' + this.book.key;
    this.aspect = src.aspect || store.get(aspectKey) || 0.68;
    this.statusEl.hidden = true;
    this.rebuildEngine(false);
    this.installGestures();
    if (startAt > 0) this.toast(`Resumed at page ${startAt + 1}`, 'Start over', () => this.goTo(0, false));
    if (!src.aspect) {
      this.measureAspect(Math.min(startAt + 1, this.count - 1)).then((a) => {
        if (this.dead || !a) return;
        store.set(aspectKey, a);
        if (Math.abs(a - this.aspect) / this.aspect > 0.04) { this.aspect = a; this.rebuildEngine(true); }
      });
    }
  }

  async measureAspect(i) {
    try {
      const url = await this.src.load(i, { width: this.pageWidthPx() });
      const img = new Image();
      img.decoding = 'async';
      img.src = url; // same URL the page <img> uses, so the browser shares the download
      await img.decode();
      if (img.naturalWidth && img.naturalHeight) {
        const a = img.naturalWidth / img.naturalHeight;
        if (a > 0.35 && a < 1.6) return a; // ignore odd covers / fold-outs
      }
    } catch { /* fall through */ }
    return null;
  }

  fail(e) {
    this.statusEl.hidden = false;
    this.statusEl.innerHTML = `<div class="state-icon">${icons.book}</div>
      <p><strong>Couldn't open this book.</strong></p><p class="muted">${escapeHtml(e?.message || String(e))}</p>
      <div class="row"><button class="btn r-retry">${icons.retry}<span>Try again</span></button>
      <button class="btn ghost r-close2">Close</button></div>`;
    this.statusEl.querySelector('.r-close2').onclick = () => this.close();
    this.statusEl.querySelector('.r-retry').onclick = () => location.reload();
  }

  close() { this.closeViaHistory(); }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.saveProgress();
    this.engine?.destroy();
    for (const [i, e] of this.loaded) this.src?.release?.(i, e.url);
    this.src?.destroy?.();
    this.loaded.clear();
    this.listeners.forEach((off) => off());
    clearTimeout(this.barsTimer);
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* ignore */ }
    try { this.wakeLock?.release(); } catch { /* ignore */ }
    this.el.remove();
    document.documentElement.classList.remove('reader-open');
    if (active === this) active = null;
    this.onClose?.();
  }

  enterFullscreen() {
    try {
      if (document.fullscreenEnabled && !document.fullscreenElement && matchMedia('(pointer: coarse)').matches) {
        this.el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }
    } catch { /* the fixed 100dvh overlay is the fallback */ }
  }

  async requestWakeLock() {
    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  }

  // ---------- layout / engine ----------
  isSpread() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    return w > h * 1.1 && w >= 560;
  }

  pageWidthPx(hi = false) {
    const cssW = this.isSpread() ? this.stage.clientWidth / 2 : this.stage.clientWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const want = cssW * dpr * (hi ? 2.2 : 1);
    const cap = hi ? R.maxPageWidthPx * 2 : R.maxPageWidthPx;
    return Math.max(400, Math.min(cap, Math.ceil(want / 200) * 200));
  }

  rebuildEngine(keepPage) {
    const page = keepPage ? this.page : this.page;
    this.engine?.destroy();
    for (const [i, e] of this.loaded) this.src.release?.(i, e.url);
    this.loaded.clear();
    this.resetZoom(false);
    this.spread = this.isSpread();
    this.reqWidth = this.pageWidthPx();
    this.pageEls = [];
    const make = (i) => this.makePageEl(i);
    const opts = { count: this.count, aspect: this.aspect, start: page, spread: this.spread, make, onTurn: (p) => this.onTurn(p) };
    this.engine = flipEnabled() && window.St?.PageFlip ? new FlipEngine(this.host, opts) : new SimpleEngine(this.host, opts);
    this.onTurn(this.engine.current());
  }

  makePageEl(i) {
    let el = this.pageEls[i];
    if (el) return el;
    el = document.createElement('div');
    el.className = 'r-page';
    el.dataset.i = i;
    el.innerHTML = `<img alt="Page ${i + 1}" decoding="async" draggable="false"><span class="r-pnum">${i + 1}</span>`;
    const img = el.firstChild;
    img.addEventListener('load', () => el.classList.add('loaded'));
    img.addEventListener('error', () => { if (img.getAttribute('src')) { el.classList.add('error'); this.loaded.delete(i); } });
    this.pageEls[i] = el;
    return el;
  }

  onTurn(p) {
    this.page = Math.max(0, Math.min(this.count - 1, p));
    const shown = this.engine?.visible() || [this.page];
    const a = shown[0] + 1, b = shown[shown.length - 1] + 1;
    this.countEl.textContent = a === b ? `Page ${a} of ${this.count}` : `Pages ${a}–${b} of ${this.count}`;
    this.slider.value = String(a);
    this.updateBookmarkBtn();
    this.updateWindow();
    this.saveProgress();
    this.updateReportLink();
    if (this.zoom.s > 1) this.resetZoom(true);
  }

  saveProgress() {
    if (!this.count) return;
    store.setProgress(this.book.key, this.page, this.count);
    if (this.page >= this.count - 2 && store.shelfEntry(this.book.key)?.status === 'reading') store.setStatus(this.book, 'finished');
  }

  /** Keep pages [cur-keepBehind, cur+ahead] loaded; release everything else. */
  updateWindow() {
    const shown = this.engine.visible();
    const lo = shown[0] - R.keepBehind - (this.spread ? 1 : 0);
    const hi = shown[shown.length - 1] + R.preloadAhead + (this.spread ? 1 : 0);
    for (const [i] of this.loaded) {
      if (i < lo || i > hi) this.unloadPage(i);
    }
    // current first, then ahead, then behind
    const order = [...shown];
    for (let i = shown[shown.length - 1] + 1; i <= hi; i++) order.push(i);
    for (let i = shown[0] - 1; i >= lo; i--) order.push(i);
    for (const i of order) if (i >= 0 && i < this.count) this.loadPage(i, false);
  }

  async loadPage(i, hi) {
    const el = this.pageEls[i];
    const cur = this.loaded.get(i);
    if (cur?.pending && (!hi || cur.hiPending)) return; // already on its way
    if (cur?.url && (cur.hi || !hi) && el?.querySelector('img').getAttribute('src')) return;
    this.loaded.set(i, { ...(cur || {}), url: cur?.url || null, pending: true, hiPending: !!hi });
    try {
      const url = cur?.url && !hi ? cur.url : await this.src.load(i, { width: hi ? this.pageWidthPx(true) : this.reqWidth, hi });
      if (this.dead || !this.loaded.has(i)) { if (url !== cur?.url) this.src.release?.(i, url); return; }
      const old = this.loaded.get(i)?.url;
      this.loaded.set(i, { url, hi });
      const node = this.pageEls[i];
      if (!node) return;
      node.classList.remove('error');
      const img = node.querySelector('img');
      if (hi && img.complete && img.naturalWidth) {
        // swap to hi-res only once it's decoded, so the page never flashes blank
        const pre = new Image();
        pre.src = url;
        pre.decode().then(() => {
          if (this.loaded.get(i)?.url !== url) return;
          img.src = url;
          if (old && old !== url) this.src.release?.(i, old);
        }).catch(() => {});
      } else if (img.getAttribute('src') !== url) {
        img.src = url;
      }
    } catch {
      this.pageEls[i]?.classList.add('error');
      this.loaded.delete(i);
    }
  }

  unloadPage(i) {
    const e = this.loaded.get(i);
    this.loaded.delete(i);
    const el = this.pageEls[i];
    if (el) {
      const img = el.querySelector('img');
      img.removeAttribute('src');
      el.classList.remove('loaded', 'error');
    }
    this.src.release?.(i, e?.url);
  }

  next() { if (!this.engine?.busy()) this.engine?.next(); }
  prev() { if (!this.engine?.busy()) this.engine?.prev(); }
  goTo(i, animate) { this.engine?.go(Math.max(0, Math.min(this.count - 1, i)), animate); }

  // ---------- bars, menu, toast ----------
  showBars() {
    this.el.classList.add('bars');
    this.keepBars();
  }
  keepBars() {
    clearTimeout(this.barsTimer);
    this.barsTimer = setTimeout(() => {
      if (this.menu.hidden && !this.el.contains(document.activeElement?.closest?.('.r-bar') || null)) this.hideBars();
      else this.keepBars();
    }, R.autoHideMs);
  }
  hideBars() { this.el.classList.remove('bars'); this.closeMenu(); }
  toggleBars() { this.el.classList.contains('bars') ? this.hideBars() : this.showBars(); }

  toggleMenu() {
    if (this.menu.hidden) {
      this.renderBookmarks();
      this.updateReportLink();
      this.menu.hidden = false;
      this.el.querySelector('.r-more').setAttribute('aria-expanded', 'true');
      this.keepBars();
    } else this.closeMenu();
  }
  closeMenu() {
    this.menu.hidden = true;
    this.el.querySelector('.r-more').setAttribute('aria-expanded', 'false');
  }

  toast(msg, actionLabel, action) {
    const t = this.el.querySelector('.r-toast');
    t.innerHTML = `<span>${escapeHtml(msg)}</span>`;
    if (actionLabel) {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = actionLabel;
      b.onclick = () => { action(); t.hidden = true; };
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  // ---------- bookmarks / report ----------
  updateBookmarkBtn() {
    const marks = store.shelfEntry(this.book.key)?.bookmarks || [];
    const on = marks.includes(this.page);
    this.bmBtn.innerHTML = on ? icons.bookmarkFilled : icons.bookmark;
    this.bmBtn.setAttribute('aria-pressed', String(on));
  }
  toggleBookmark() {
    const added = store.toggleBookmark(this.book, this.page);
    this.updateBookmarkBtn();
    this.toast(added ? `Bookmarked page ${this.page + 1}` : 'Bookmark removed');
    this.keepBars();
  }
  renderBookmarks() {
    const box = this.el.querySelector('.r-bookmarks');
    const marks = store.shelfEntry(this.book.key)?.bookmarks || [];
    box.innerHTML = marks.length
      ? `<p class="menu-h">Bookmarks</p><div class="chips">${marks.map((p) => `<button class="chip" data-p="${p}">p. ${p + 1}</button>`).join('')}</div>`
      : '<p class="menu-h muted">No bookmarks yet</p>';
    box.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { this.closeMenu(); this.goTo(+b.dataset.p, false); }));
  }
  updateReportLink() {
    const a = this.el.querySelector('.r-report');
    if (!a) return;
    if (this.reportUrl) a.href = this.reportUrl(this.book, this.page); else a.remove();
  }

  // ---------- zoom ----------
  applyZoom(animate) {
    const { s, x, y } = this.zoom;
    this.zoomEl.classList.toggle('animate', !!animate && !reducedMotion());
    this.zoomEl.style.transform = s === 1 ? '' : `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    this.el.classList.toggle('zoomed', s > 1);
  }
  clampZoom() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight, z = this.zoom;
    z.s = Math.max(1, Math.min(5, z.s));
    z.x = Math.min(0, Math.max(W - W * z.s, z.x));
    z.y = Math.min(0, Math.max(H - H * z.s, z.y));
  }
  zoomAt(px, py, s, animate) {
    const z = this.zoom;
    const cx = (px - z.x) / z.s, cy = (py - z.y) / z.s; // content point under finger
    z.s = s;
    z.x = px - cx * s;
    z.y = py - cy * s;
    this.clampZoom();
    if (z.s < 1.02) { z.s = 1; z.x = 0; z.y = 0; }
    this.applyZoom(animate);
    if (z.s >= 1.6) this.engine.visible().forEach((i) => this.loadPage(i, true));
  }
  resetZoom(animate) {
    this.zoom = { s: 1, x: 0, y: 0 };
    this.applyZoom(animate);
  }

  // ---------- gestures ----------
  installGestures() {
    const stage = this.stage;
    const local = (t) => { const r = stage.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    const inStage = (e) => stage.contains(e.target);
    let pinch = null; // {d0, s0, mid}
    let pan = null;   // {x, y, zx, zy}
    let blocking = false; // swallow the rest of this touch sequence

    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a, b) => local({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });

    // Capture phase on window runs before StPageFlip's own listeners, so we can keep
    // pinches and zoomed pans away from it (no accidental page turns while zoomed).
    this.on(window, 'touchstart', (e) => {
      if (!inStage(e)) return;
      if (e.touches.length >= 2) {
        blocking = true;
        e.stopPropagation();
        e.preventDefault();
        this.engine.cancelGesture?.();
        const [a, b] = e.touches;
        pinch = { d0: dist(a, b), s0: this.zoom.s, m0: mid(a, b), x0: this.zoom.x, y0: this.zoom.y };
        pan = null;
      } else if (this.zoom.s > 1) {
        blocking = true;
        e.stopPropagation();
        const t = e.touches[0];
        pan = { x: t.clientX, y: t.clientY, zx: this.zoom.x, zy: this.zoom.y };
      }
    }, { capture: true, passive: false });

    this.on(window, 'touchmove', (e) => {
      if (!blocking) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (pinch && e.touches.length >= 2) {
        const [a, b] = e.touches;
        const s = Math.max(1, Math.min(5, pinch.s0 * (dist(a, b) / pinch.d0)));
        const m = mid(a, b);
        // keep the content point that was under the initial midpoint under the current midpoint
        const cx = (pinch.m0.x - pinch.x0) / pinch.s0, cy = (pinch.m0.y - pinch.y0) / pinch.s0;
        this.zoom = { s, x: m.x - cx * s, y: m.y - cy * s };
        this.clampZoom();
        this.applyZoom(false);
      } else if (pan && e.touches.length === 1) {
        const t = e.touches[0];
        this.zoom.x = pan.zx + (t.clientX - pan.x);
        this.zoom.y = pan.zy + (t.clientY - pan.y);
        this.clampZoom();
        this.applyZoom(false);
      }
    }, { capture: true, passive: false });

    const end = (e) => {
      if (!blocking) return;
      e.stopPropagation();
      if (e.touches.length === 1 && this.zoom.s > 1) {
        const t = e.touches[0];
        pinch = null;
        pan = { x: t.clientX, y: t.clientY, zx: this.zoom.x, zy: this.zoom.y };
        return;
      }
      if (e.touches.length === 0) {
        blocking = false;
        pinch = null;
        pan = null;
        if (this.zoom.s < 1.05) this.resetZoom(true);
        else this.engine.visible().forEach((i) => this.loadPage(i, true));
      }
    };
    this.on(window, 'touchend', end, { capture: true });
    this.on(window, 'touchcancel', end, { capture: true });

    // Mouse: drag to pan while zoomed (block StPageFlip's mousedown), ctrl+wheel / trackpad pinch to zoom.
    let mpan = null;
    this.on(window, 'mousedown', (e) => {
      if (!inStage(e) || this.zoom.s <= 1) return;
      e.stopPropagation();
      e.preventDefault();
      mpan = { x: e.clientX, y: e.clientY, zx: this.zoom.x, zy: this.zoom.y };
    }, true);
    this.on(window, 'mousemove', (e) => {
      if (!mpan) return;
      e.stopPropagation();
      this.zoom.x = mpan.zx + (e.clientX - mpan.x);
      this.zoom.y = mpan.zy + (e.clientY - mpan.y);
      this.clampZoom();
      this.applyZoom(false);
    }, true);
    this.on(window, 'mouseup', (e) => { if (mpan) { e.stopPropagation(); mpan = null; } }, true);
    this.on(stage, 'wheel', (e) => {
      if (!e.ctrlKey && this.zoom.s <= 1) return;
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey) this.zoomAt(p.x, p.y, this.zoom.s * Math.exp(-e.deltaY / 200), false);
      else { this.zoom.x -= e.deltaX; this.zoom.y -= e.deltaY; this.clampZoom(); this.applyZoom(false); }
    }, { passive: false });

    // Taps: edges turn pages; centre toggles bars; double-tap (centre) zooms.
    let down = null, lastTap = null, tapTimer = null;
    this.on(stage, 'pointerdown', (e) => {
      if (!e.isPrimary) { down = null; return; }
      down = { x: e.clientX, y: e.clientY, t: performance.now(), multi: false };
    });
    this.on(stage, 'pointerup', (e) => {
      if (!down || !e.isPrimary) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 350;
      down = null;
      if (moved > 10 || !quick || pinch) return;
      if (!this.menu.hidden) { this.closeMenu(); return; }
      const p = local(e);
      const W = stage.clientWidth;
      const zone = this.zoom.s > 1 ? 'center' : p.x < W * 0.22 ? 'left' : p.x > W * 0.78 ? 'right' : 'center';
      // defer a tick so StPageFlip's own mouseup handling (corner clicks) runs first
      setTimeout(() => {
        if (zone === 'left') { this.prev(); return; }
        if (zone === 'right') { this.next(); return; }
        const now = performance.now();
        if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
          clearTimeout(tapTimer);
          lastTap = null;
          if (this.zoom.s > 1) this.resetZoom(true); else this.zoomAt(p.x, p.y, 2.5, true);
          return;
        }
        lastTap = { t: now, x: p.x, y: p.y };
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => { lastTap = null; this.toggleBars(); }, 300);
      }, 0);
    });

    this.on(window, 'keydown', (e) => {
      if (e.target.closest?.('input, textarea, select') && e.target !== this.slider) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); this.next(); }
      else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { e.preventDefault(); this.prev(); }
      else if (k === 'Home') this.goTo(0, false);
      else if (k === 'End') this.goTo(this.count - 1, false);
      else if (k === 'Escape') { if (this.zoom.s > 1) this.resetZoom(true); else if (!this.menu.hidden) this.closeMenu(); else this.close(); }
      else if (k === '+' || k === '=') this.zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, this.zoom.s * 1.5, true);
      else if (k === '-') this.zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, this.zoom.s / 1.5, true);
      else if (k.toLowerCase() === 'b') this.toggleBookmark();
    });
    this.on(this.slider, 'keydown', (e) => e.stopPropagation());

    // Rotation / resize: rebuild only when switching single <-> spread; StPageFlip handles plain resizes.
    let rz;
    const onResize = () => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        if (this.dead || !this.engine) return;
        if (this.isSpread() !== this.spread) this.rebuildEngine(true);
        else { this.engine.resize?.(); this.clampZoom(); this.applyZoom(false); }
      }, 150);
    };
    // ResizeObserver also catches fullscreen, URL-bar and split-screen changes that skip window 'resize'.
    const ro = new ResizeObserver(onResize);
    ro.observe(this.stage);
    this.listeners.push(() => ro.disconnect());
    this.on(window, 'orientationchange', onResize);
    this.on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.dead) this.requestWakeLock();
      else this.saveProgress();
    });
  }
}

// ---------------- Engines ----------------

/** Realistic page curl using StPageFlip (HTML mode). Pages are DOM nodes we lazily fill. */
class FlipEngine {
  constructor(host, { count, aspect, start, spread, make, onTurn }) {
    this.root = document.createElement('div');
    this.root.className = 'flip-root';
    host.appendChild(this.root);
    this.count = count;
    this.spread = spread;
    const pages = [];
    for (let i = 0; i < count; i++) pages.push(make(i));
    const W = host.clientWidth || window.innerWidth;
    const baseW = 600;
    this.pf = new window.St.PageFlip(this.root, {
      width: baseW,
      height: Math.round(baseW / aspect),
      size: 'stretch',
      // StPageFlip goes single-page when the container is narrower than 2*minWidth.
      minWidth: spread ? 120 : Math.ceil(W / 2) + 2,
      maxWidth: 3000,
      minHeight: 150,
      maxHeight: 4000,
      showCover: spread,
      usePortrait: true,
      autoSize: true,
      drawShadow: true,
      maxShadowOpacity: 0.45,
      flippingTime: 650,
      mobileScrollSupport: false,
      swipeDistance: 24,
      showPageCorners: true,
      disableFlipByClick: true,
      startPage: start,
    });
    // StPageFlip routes swipes and programmatic turns through flip(), which refuses any point that
    // isn't a page corner while disableFlipByClick is on. We want: swipes + our calls turn pages,
    // plain clicks don't (taps are ours: edges turn, centre toggles bars). So lift the flag only
    // inside these entry points; a mouse click calls flipController.flip() directly and stays blocked.
    for (const m of ['flipNext', 'flipPrev', 'flip']) {
      const orig = this.pf[m].bind(this.pf);
      this.pf[m] = (...args) => {
        const s = this.pf.getSettings();
        s.disableFlipByClick = false;
        try { orig(...args); } finally { s.disableFlipByClick = true; }
      };
    }
    this.pf.loadFromHTML(pages);
    this.pf.on('flip', (e) => onTurn(e.data));
    this.pf.on('changeOrientation', () => onTurn(this.current()));
  }
  current() { return this.pf.getCurrentPageIndex(); }
  visible() {
    const c = this.current();
    if (this.pf.getOrientation() === 'portrait') return [c];
    // landscape: with showCover, page 0 is alone; afterwards pairs (odd, even)
    if (c === 0) return [0];
    const left = c % 2 === 1 ? c : c - 1;
    return left + 1 < this.count ? [left, left + 1] : [left];
  }
  busy() { return this.pf.getState() === 'flipping'; }
  next() { this.pf.flipNext('bottom'); }
  prev() { this.pf.flipPrev('bottom'); }
  go(i, animate) { animate ? this.pf.flip(i) : this.pf.turnToPage(i); } // both fire 'flip'
  resize() { try { this.pf.update(); } catch { /* ignore */ } }
  cancelGesture() {
    try {
      const ui = this.pf.getUI();
      ui.touchPoint = null; // cancels StPageFlip's pending swipe / delayed fold
      if (this.busy()) this.pf.getFlipController().stopMove();
    } catch { /* ignore */ }
  }
  destroy() {
    try { this.pf.destroy(); } catch { /* ignore */ }
    this.root.remove();
  }
}

/** Instant page turns (reduced motion / animation off). Simple swipe detection of its own. */
class SimpleEngine {
  constructor(host, { count, aspect, start, spread, make, onTurn }) {
    this.count = count;
    this.spread = spread;
    this.make = make;
    this.onTurn = onTurn;
    this.root = document.createElement('div');
    this.root.className = 'simple-root' + (spread ? ' spread' : '');
    this.root.style.setProperty('--aspect', String(aspect || 0.68));
    host.appendChild(this.root);
    this.cur = this.normalise(start);
    this.render();
    let sx = null, sy = null, st = 0;
    this.ts = (e) => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); } else sx = null; };
    this.te = (e) => {
      if (sx == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 40 && Math.abs(dy) < Math.abs(dx) && Date.now() - st < 600) (dx < 0 ? this.next() : this.prev());
    };
    this.root.addEventListener('touchstart', this.ts, { passive: true });
    this.root.addEventListener('touchend', this.te);
  }
  normalise(i) { return this.spread && i > 0 ? (i % 2 === 1 ? i : i - 1) : i; }
  visible() {
    if (!this.spread || this.cur === 0) return [this.cur];
    return this.cur + 1 < this.count ? [this.cur, this.cur + 1] : [this.cur];
  }
  render() {
    this.root.replaceChildren(...this.visible().map((i) => this.make(i)));
    this.root.classList.toggle('single-in-spread', this.spread && this.visible().length === 1);
  }
  current() { return this.cur; }
  busy() { return false; }
  step() { return this.spread && this.cur > 0 ? 2 : 1; }
  next() {
    const n = this.spread ? (this.cur === 0 ? 1 : this.cur + 2) : this.cur + 1;
    if (n < this.count) this.set(n);
  }
  prev() {
    const n = this.spread ? (this.cur <= 1 ? 0 : this.cur - 2) : this.cur - 1;
    if (n >= 0) this.set(n);
  }
  go(i) { this.set(this.normalise(i)); }
  set(i) { this.cur = i; this.render(); this.onTurn(i); }
  destroy() {
    this.root.removeEventListener('touchstart', this.ts);
    this.root.removeEventListener('touchend', this.te);
    this.root.remove();
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
