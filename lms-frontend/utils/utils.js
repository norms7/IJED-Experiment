/* ============================================================
   utils/utils.js
   Shared helper utilities used across the entire application.
   ============================================================ */

"use strict";

/* ── Storage Utility ────────────────────────────────────────
   Thin wrapper around localStorage for type-safe access.
   ────────────────────────────────────────────────────────── */
const Storage = {
  get:    (k)    => JSON.parse(localStorage.getItem(k)),
  set:    (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  remove: (k)    => localStorage.removeItem(k),
};

/* ── Toast Notification System ──────────────────────────────
   Displays auto-dismissing toast messages.
   Types: 'success' | 'error' | 'info' | 'warning'
   ────────────────────────────────────────────────────────── */
const Toast = {
  icons: { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' },

  show(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toast-container');
    const toast     = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${this.icons[type] || 'ℹ'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut .3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
};

/* ── Modal System ───────────────────────────────────────────
   Programmatic modal dialog with title, body, and footer.
   Closes on overlay click or close button.
   ────────────────────────────────────────────────────────── */
const Modal = {
  show(title, bodyHTML, footerHTML = '', opts = {}) {
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    if (this._onClose) {
      const onClose = this._onClose;
      this._onClose = null;
      onClose();
    }
    const container = document.getElementById('modal-container');
    const wideStyle = opts.full
      ? 'width:min(96%,1200px);max-width:calc(100vw - 24px);'
      : opts.wide ? 'width:min(96%,860px);max-width:calc(100vw - 24px);' : '';
    this._onClose = opts.onClose || null;
    container.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal" style="${wideStyle}">
          <div class="modal-header">
            <span class="modal-title">${title}</span>
            <button class="modal-close" onclick="Modal.close()" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body">${bodyHTML}</div>
          ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
        </div>
      </div>`;

    // Close on backdrop click
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay' && opts.closeOnBackdrop !== false) Modal.close();
    });

    // Close on ESC key
    this._escHandler = (e) => { if (e.key === 'Escape') Modal.close(); };
    document.addEventListener('keydown', this._escHandler);
  },

  close() {
    document.getElementById('modal-container').innerHTML = '';
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    if (this._onClose) {
      const onClose = this._onClose;
      this._onClose = null;
      onClose();
    }
  },
};

/* ── Uploaded file preview ────────────────────────────────── */
const FilePreview = {
  _activeObjectUrl: null,
  _abortController: null,
  _activePdf: null,
  _activePdfLoadingTask: null,
  _activePdfRenderTask: null,
  _scriptPromises: new Map(),

  button(url, fileName, label, className = 'file-preview-link', onClick = '') {
    const clickAttribute = onClick ? ` onclick="${escHtml(onClick)}"` : '';
    return `<button type="button" class="${className}" data-file-preview data-file-url="${escHtml(url)}" data-file-name="${escHtml(fileName || 'Uploaded file')}"${clickAttribute}>${label}</button>`;
  },

  _kind(fileName, mimeType = '') {
    const extension = String(fileName || '').split('.').pop().toLowerCase();
    const byExtension = {
      pdf: 'pdf', docx: 'docx', pptx: 'pptx',
      xlsx: 'spreadsheet', xls: 'spreadsheet', csv: 'spreadsheet',
      txt: 'text', md: 'text',
      png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
      webp: 'image', bmp: 'image', avif: 'image', svg: 'image',
      mp4: 'video', webm: 'video', ogv: 'video', mov: 'video',
      mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio',
    };
    if (byExtension[extension]) return byExtension[extension];
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'spreadsheet';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('text/')) return 'text';
    return 'unsupported';
  },

  async open(url, fileName) {
    this.close();
    let parsedUrl;
    try {
      parsedUrl = new URL(url, window.location.href);
    } catch {
      Toast.show('This file has an invalid preview URL.', 'error');
      return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      Toast.show('This file has an invalid preview URL.', 'error');
      return;
    }

    const name = fileName || 'Uploaded file';
    const request = new AbortController();
    Modal.show(
      escHtml(name),
      '<div id="file-preview-content" class="file-preview-content" aria-live="polite">Loading preview…</div>',
      '<button type="button" class="btn btn-ghost" onclick="Modal.close()">Close</button>',
      {
        full: true,
        onClose: () => {
          if (this._abortController === request) this.close();
        },
      },
    );
    this._abortController = request;

    const content = document.getElementById('file-preview-content');
    let objectUrl = null;
    try {
      const response = await fetch(parsedUrl.href, { signal: request.signal });
      if (!response.ok) throw new Error(`File request failed (${response.status}).`);
      const blob = await response.blob();
      if (request.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      this._activeObjectUrl = objectUrl;

      switch (this._kind(name, blob.type)) {
        case 'pdf':
          await this._renderPdf(blob, name, content, request.signal);
          break;
        case 'image':
          content.innerHTML = `<img class="file-preview-image" src="${escHtml(objectUrl)}" alt="${escHtml(name)}">`;
          break;
        case 'video':
          content.innerHTML = `<video class="file-preview-video" src="${escHtml(objectUrl)}" controls playsinline preload="metadata">Your browser cannot play this video format.</video>`;
          break;
        case 'audio':
          content.innerHTML = `<audio class="file-preview-audio" src="${escHtml(objectUrl)}" controls>Your browser cannot play this audio format.</audio>`;
          break;
        case 'docx':
          await this._renderDocx(blob, content, request.signal);
          break;
        case 'pptx':
          await this._renderPptx(blob, name, content, request.signal);
          break;
        case 'spreadsheet':
          await this._renderSpreadsheet(blob, content);
          break;
        case 'text':
          content.innerHTML = `<pre class="file-preview-text">${escHtml(await blob.text())}</pre>`;
          break;
        default:
          content.innerHTML = '<p>This file type cannot be previewed in the browser. Download it to view it.</p>';
      }

      if (request.signal.aborted) return;
      const footer = document.querySelector('#modal-container .modal-footer');
      if (footer) {
        footer.innerHTML = `
          <a class="btn btn-outline" href="${escHtml(objectUrl)}" download="${escHtml(name)}">Download</a>
          <button type="button" class="btn btn-ghost" onclick="Modal.close()">Close</button>`;
      }
    } catch (error) {
      if (request.signal.aborted) return;
      console.error('[LMS] file preview failed:', error);
      if (content?.isConnected) {
        content.innerHTML = `<p role="alert">Could not preview this file: ${escHtml(error.message || 'An unexpected error occurred.')}</p>`;
      }
      const footer = document.querySelector('#modal-container .modal-footer');
      if (footer && objectUrl) {
        footer.innerHTML = `
          <a class="btn btn-outline" href="${escHtml(objectUrl)}" download="${escHtml(name)}">Download</a>
          <button type="button" class="btn btn-ghost" onclick="Modal.close()">Close</button>`;
      }
    }
  },

  async _renderPdf(blob, fileName, container, signal) {
    const pdfJsUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    const pdfWorkerUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    if (!window.pdfjsLib) await this._loadScript(pdfJsUrl);
    if (signal.aborted) return;
    if (!window.pdfjsLib) throw new Error('The PDF preview library did not load.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

    const loadingTask = window.pdfjsLib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
    });
    this._activePdfLoadingTask = loadingTask;
    const pdf = await loadingTask.promise;
    if (signal.aborted) {
      await pdf.destroy();
      return;
    }
    this._activePdfLoadingTask = null;
    this._activePdf = pdf;
    document.querySelector('#modal-container .modal')?.classList.add('modal-file-preview-pdf');

    container.innerHTML = `
      <div class="file-preview-pdf">
        <div class="file-preview-pdf-toolbar" role="group" aria-label="PDF controls">
          <button type="button" class="btn btn-outline file-preview-pdf-previous" aria-label="Previous page">Previous</button>
          <span class="file-preview-pdf-page" aria-live="polite"></span>
          <button type="button" class="btn btn-outline file-preview-pdf-next" aria-label="Next page">Next</button>
          <button type="button" class="btn btn-outline file-preview-pdf-zoom-out" aria-label="Zoom out">−</button>
          <button type="button" class="btn btn-outline file-preview-pdf-zoom-in" aria-label="Zoom in">+</button>
        </div>
        <div class="file-preview-pdf-page-container">
          <canvas class="file-preview-pdf-canvas" role="img" aria-label="${escHtml(fileName)}"></canvas>
        </div>
      </div>`;

    const pageLabel = container.querySelector('.file-preview-pdf-page');
    const canvas = container.querySelector('.file-preview-pdf-canvas');
    const pageContainer = container.querySelector('.file-preview-pdf-page-container');
    const previousButton = container.querySelector('.file-preview-pdf-previous');
    const nextButton = container.querySelector('.file-preview-pdf-next');
    let pageNumber = 1;
    let zoom = 1;
    let renderSequence = 0;

    const renderPage = async () => {
      const sequence = ++renderSequence;
      this._activePdfRenderTask?.cancel();
      const page = await pdf.getPage(pageNumber);
      if (signal.aborted || sequence !== renderSequence) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(160, pageContainer.clientWidth - 16);
      const scale = (availableWidth / baseViewport.width) * zoom;
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * pixelRatio);
      canvas.height = Math.ceil(viewport.height * pixelRatio);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      pageLabel.textContent = `Page ${pageNumber} of ${pdf.numPages}`;
      previousButton.disabled = pageNumber === 1;
      nextButton.disabled = pageNumber === pdf.numPages;

      const renderTask = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      this._activePdfRenderTask = renderTask;
      try {
        await renderTask.promise;
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException' && !signal.aborted) throw error;
      } finally {
        if (this._activePdfRenderTask === renderTask) this._activePdfRenderTask = null;
      }
    };

    const renderSafely = () => {
      renderPage().catch((error) => {
        if (!signal.aborted) {
          console.error('[LMS] PDF page render failed:', error);
          pageLabel.textContent = 'Could not render this PDF page.';
        }
      });
    };

    previousButton.addEventListener('click', () => {
      if (pageNumber > 1) {
        pageNumber -= 1;
        renderSafely();
      }
    });
    nextButton.addEventListener('click', () => {
      if (pageNumber < pdf.numPages) {
        pageNumber += 1;
        renderSafely();
      }
    });
    container.querySelector('.file-preview-pdf-zoom-out').addEventListener('click', () => {
      zoom = Math.max(0.75, zoom - 0.25);
      renderSafely();
    });
    container.querySelector('.file-preview-pdf-zoom-in').addEventListener('click', () => {
      zoom = Math.min(2.5, zoom + 0.25);
      renderSafely();
    });

    let resizeTimer;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderSafely, 120);
    };
    window.addEventListener('resize', onResize);
    signal.addEventListener('abort', () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    }, { once: true });

    await renderPage();
  },

  async _renderDocx(blob, container, signal) {
    if (!window.mammoth) {
      await this._loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
    }
    if (signal.aborted) return;
    if (!window.mammoth) throw new Error('The Word document preview library did not load.');
    const result = await window.mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
    if (!signal.aborted) await this._renderHtml(container, result.value, 'file-preview-document');
  },

  async _renderSpreadsheet(blob, container) {
    if (!window.XLSX) throw new Error('The spreadsheet preview library did not load.');
    const workbook = window.XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    const html = workbook.SheetNames.map((sheetName) =>
      `<h2>${escHtml(sheetName)}</h2>${window.XLSX.utils.sheet_to_html(workbook.Sheets[sheetName])}`,
    ).join('');
    await this._renderHtml(container, html, 'file-preview-spreadsheet');
  },

  async _renderHtml(container, html, className) {
    if (!window.DOMPurify) {
      await this._loadScript('https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js');
    }
    if (!window.DOMPurify) throw new Error('The safe document preview library did not load.');
    const safeHtml = window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['iframe', 'object', 'embed', 'form'],
    });
    const frame = document.createElement('iframe');
    frame.className = 'file-preview-frame';
    frame.title = 'Uploaded document preview';
    frame.setAttribute('sandbox', '');
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font:16px/1.6 Arial,sans-serif;color:#222;margin:24px;overflow-wrap:anywhere}
      img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}
      td,th{border:1px solid #bbb;padding:6px}pre{white-space:pre-wrap}
    </style></head><body class="${className}">${safeHtml}</body></html>`;
    container.replaceChildren(frame);
  },

  async _renderPptx(blob, fileName, container, signal) {
    const revision = '1a9260b2062f89ba822aeb54da792236780af8e7';
    const base = `https://cdn.jsdelivr.net/gh/meshesha/pptxjs@${revision}/`;
    const nonce = crypto.randomUUID();
    const frame = document.createElement('iframe');
    frame.className = 'file-preview-frame file-preview-pptx-frame';
    frame.title = `${fileName} presentation preview`;
    frame.setAttribute('sandbox', 'allow-scripts');
    const buffer = await blob.arrayBuffer();
    if (signal.aborted) return;
    const libraries = [
      'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',
      'https://cdn.jsdelivr.net/npm/jszip@2.6.1/dist/jszip.min.js',
      `${base}js/filereader.js`,
      `${base}js/d3.min.js`,
      `${base}js/nv.d3.min.js`,
      `${base}js/dingbat.js`,
      `${base}js/pptxjs.js`,
    ];
    const libraryTags = libraries.map((url) => `<script src="${url}"></script>`).join('');
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
      <link rel="stylesheet" href="${base}css/pptxjs.css">
      <style>body{margin:16px;background:#e5e7eb}.slide{max-width:100%;height:auto;margin:0 auto 24px}</style>
      </head><body><div id="pptx-preview"></div><input id="pptx-file" type="file" hidden>
      ${libraryTags}
      <script nonce="${nonce}">
        const preview=document.getElementById('pptx-preview');
        let finished=false;
        const observer=new MutationObserver(()=>{
          if(finished||!preview.querySelector('.slide'))return;
          finished=true;observer.disconnect();
          parent.postMessage({type:'pptx-preview-ready'},'*');
        });
        observer.observe(preview,{childList:true,subtree:true});
        window.addEventListener('error',()=>{
          if(!finished){finished=true;parent.postMessage({type:'pptx-preview-error'},'*');}
        });
        window.addEventListener('message',(event)=>{
          if(event.source!==parent||event.data?.type!=='pptx-preview-file'||finished)return;
          try{
            const input=document.getElementById('pptx-file');
            const transfer=new DataTransfer();
            transfer.items.add(new File([event.data.buffer],event.data.name,{
              type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            }));
            input.files=transfer.files;
            window.jQuery(preview).pptxToHtml({
              pptxFileUrl:'',fileInputId:input.id,slideMode:false,
              keyBoardShortCut:false,mediaProcess:true,jsZipV2:false,themeProcess:true
            });
            input.dispatchEvent(new Event('change',{bubbles:true}));
          }catch(error){
            finished=true;parent.postMessage({type:'pptx-preview-error'},'*');
          }
        });
        parent.postMessage({type:'pptx-preview-loaded'},'*');
      </script></body></html>`;

    container.replaceChildren(frame);
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        resolve();
      };
      const onMessage = (event) => {
        if (event.source !== frame.contentWindow) return;
        if (event.data?.type === 'pptx-preview-loaded') {
          frame.contentWindow.postMessage({
            type: 'pptx-preview-file',
            name: fileName,
            buffer,
          }, '*', [buffer]);
        } else if (event.data?.type === 'pptx-preview-ready') {
          cleanup();
          resolve();
        } else if (event.data?.type === 'pptx-preview-error') {
          cleanup();
          reject(new Error('The presentation could not be rendered.'));
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('The presentation could not be rendered.'));
      }, 60000);
      window.addEventListener('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    container.replaceChildren(frame);
  },

  _loadScript(url) {
    if (this._scriptPromises.has(url)) return this._scriptPromises.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('A preview library could not be loaded.'));
      document.head.appendChild(script);
    });
    this._scriptPromises.set(url, promise);
    promise.catch(() => this._scriptPromises.delete(url));
    return promise;
  },

  close() {
    this._abortController?.abort();
    this._abortController = null;
    this._activePdfRenderTask?.cancel();
    this._activePdfRenderTask = null;
    if (this._activePdfLoadingTask) {
      this._activePdfLoadingTask.destroy().catch((error) => {
        console.warn('[LMS] Could not stop PDF loading:', error);
      });
      this._activePdfLoadingTask = null;
    }
    if (this._activePdf) {
      this._activePdf.destroy().catch((error) => {
        console.warn('[LMS] Could not release PDF preview:', error);
      });
      this._activePdf = null;
    }
    if (this._activeObjectUrl) URL.revokeObjectURL(this._activeObjectUrl);
    this._activeObjectUrl = null;
  },
};

document.addEventListener('click', (event) => {
  const trigger = event.target instanceof Element
    ? event.target.closest('[data-file-preview]')
    : null;
  if (!trigger) return;
  event.preventDefault();
  FilePreview.open(trigger.dataset.fileUrl, trigger.dataset.fileName);
});

/* ── HTML Escape ────────────────────────────────────────────
   Prevents XSS when rendering user-supplied data into HTML.
   ────────────────────────────────────────────────────────── */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Grade Helpers ──────────────────────────────────────────
   Convert numeric percentage to CSS class and letter grade.
   ────────────────────────────────────────────────────────── */
function gradeClass(pct) {
  if (pct >= 90) return 'grade-a';
  if (pct >= 75) return 'grade-b';
  if (pct >= 60) return 'grade-c';
  return 'grade-d';
}

function gradeLabel(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 75) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'F';
}

/* ── Date Formatter ─────────────────────────────────────────
   Formats ISO date strings into readable PH locale format.
   ────────────────────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/* ── Activity Type Helpers ──────────────────────────────────
   Returns background style and emoji for activity types.
   ────────────────────────────────────────────────────────── */
function typeBg(type) {
  const map = {
    quiz:       'background: #fde8ec;',
    assignment: 'background: #e6f4ea;',
    essay:      'background: #fff0e6;',
  };
  return map[type] || 'background: var(--gray-100);';
}

function typeEmoji(type) {
  const map = { quiz: '📝', assignment: '📋', essay: '✍️' };
  return map[type] || '📌';
}

/* ── Input Validation ───────────────────────────────────────
   Basic form validation helpers.
   ────────────────────────────────────────────────────────── */
const Validate = {
  required(value, fieldName = 'This field') {
    if (!value || !String(value).trim()) {
      Toast.show(`${fieldName} is required.`, 'error');
      return false;
    }
    return true;
  },
  email(value) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(value)) {
      Toast.show('Please enter a valid email address.', 'error');
      return false;
    }
    return true;
  },
  minLength(value, min, fieldName = 'Password') {
    if (!value || value.length < min) {
      Toast.show(`${fieldName} must be at least ${min} characters.`, 'error');
      return false;
    }
    return true;
  },
};
