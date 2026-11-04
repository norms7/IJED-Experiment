"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(
  "lms-frontend/utils/utils.js",
  "utf8",
);
const context = {
  document: { addEventListener() {} },
  window: { location: { href: "https://lms.example/" } },
  URL,
  Map,
  setTimeout,
  clearTimeout,
  console,
};
context.window.addEventListener = () => {};
context.window.removeEventListener = () => {};
context.globalThis = context;
vm.runInNewContext(`${source}\nglobalThis.previewUnderTest = FilePreview;`, context);

const preview = context.previewUnderTest;
for (const [fileName, expected] of [
  ["activity.pdf", "pdf"],
  ["answer.docx", "docx"],
  ["lesson.pptx", "pptx"],
  ["grades.xlsx", "spreadsheet"],
  ["photo.png", "image"],
  ["photo.webp", "image"],
  ["recording.mp4", "video"],
  ["recording.webm", "video"],
  ["notes.txt", "text"],
]) {
  assert.equal(preview._kind(fileName), expected, fileName);
}

assert.equal(
  preview._kind("file-without-extension", "application/pdf"),
  "pdf",
);
assert.equal(preview._kind("archive.zip"), "unsupported");

const button = preview.button(
  "https://files.example/document?token=one&next=two",
  'student "answer".docx',
  "Preview",
);
assert.match(button, /data-file-preview/);
assert.match(button, /token=one&amp;next=two/);
assert.match(button, /student &quot;answer&quot;\.docx/);
assert.doesNotMatch(button, /target=/);

async function testPdfPreviewRendersAndPages() {
  const renderedPages = [];
  const listeners = new Map();
  const buttons = new Map();
  const pageLabel = { textContent: "" };
  const canvas = {
    style: {},
    getContext: () => ({}),
  };
  const pageContainer = { clientWidth: 320 };
  const modal = { classList: { add: value => listeners.set("modal-class", value) } };
  const container = {
    isConnected: true,
    set innerHTML(_html) {},
    querySelector(selector) {
      if (selector === ".file-preview-pdf-page") return pageLabel;
      if (selector === ".file-preview-pdf-canvas") return canvas;
      if (selector === ".file-preview-pdf-page-container") return pageContainer;
      if (!buttons.has(selector)) {
        buttons.set(selector, {
          disabled: false,
          addEventListener: (event, handler) => listeners.set(selector, handler),
        });
      }
      return buttons.get(selector);
    },
  };
  context.window.devicePixelRatio = 2;
  context.window.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async pageNumber => ({
          getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
          render: () => {
            renderedPages.push(pageNumber);
            return { promise: Promise.resolve(), cancel() {} };
          },
        }),
        destroy: async () => {},
      }),
    }),
  };
  context.document.querySelector = () => modal;

  await preview._renderPdf(
    new Blob(["pdf bytes"]),
    "lesson.pdf",
    container,
    new AbortController().signal,
  );
  assert.deepEqual(renderedPages, [1]);
  assert.equal(pageLabel.textContent, "Page 1 of 2");
  assert.equal(canvas.width, 608);
  assert.equal(listeners.get("modal-class"), "modal-file-preview-pdf");

  listeners.get(".file-preview-pdf-next")();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(renderedPages, [1, 2]);
  assert.equal(pageLabel.textContent, "Page 2 of 2");
}

testPdfPreviewRendersAndPages()
  .then(() => console.log("File preview classification, markup, and PDF rendering tests passed."))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
