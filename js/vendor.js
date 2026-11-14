// Lazy loaders for third-party libraries (CDN, pinned versions). Cached by the service worker.
export const PAGEFLIP_URL = 'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js';
export const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
export const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

let pfPromise = null;
export function loadPageFlip() {
  if (window.St?.PageFlip) return Promise.resolve(window.St);
  if (!pfPromise) {
    pfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PAGEFLIP_URL;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => (window.St?.PageFlip ? resolve(window.St) : reject(new Error('page-flip failed to initialise')));
      s.onerror = () => { pfPromise = null; reject(new Error('Could not load page-flip')); };
      document.head.appendChild(s);
    });
  }
  return pfPromise;
}

let pdfPromise = null;
export function loadPdfJs() {
  if (!pdfPromise) {
    pdfPromise = import(PDFJS_URL).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return lib;
    }).catch((e) => { pdfPromise = null; throw e; });
  }
  return pdfPromise;
}
