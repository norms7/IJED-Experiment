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
};
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

console.log("File preview classification and markup tests passed.");
