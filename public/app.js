import {
  BOXES,
  drawBoxOverlay,
  formatRect,
  isClipped,
  overlayLayout,
  toPixelRect,
} from "./bbox.js";

const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const widthEl = document.getElementById("width");
const heightEl = document.getElementById("height");
const renderBtn = document.getElementById("render");
const sourceEl = document.getElementById("source");
const usvgMetaEl = document.getElementById("usvg-meta");
const usvgEl = document.getElementById("usvg");
const dprEl = document.getElementById("dpr");
const pixelatedEl = document.getElementById("pixelated");
const sampleEl = document.getElementById("sample");
const nativeEl = document.getElementById("native");
const overlayEl = document.getElementById("bbox-overlay");
const overlayCtx = overlayEl.getContext("2d");
const bboxVisibleEl = document.getElementById("bbox-visible");
const bboxMetaEl = document.getElementById("bbox-meta");
const bboxRows = new Map(
  [...document.querySelectorAll("tr[data-box]")].map((row) => [
    row.dataset.box,
    row,
  ]),
);
const bboxToggles = new Map(
  [...document.querySelectorAll(".bbox-toggle")].map((el) => [
    el.dataset.box,
    el,
  ]),
);
let lastBboxData = null;

function decodeBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function loadSource() {
  await loadSample();
}

async function loadSample() {
  const res = await fetch(`/${sampleEl.value}`);
  sourceEl.value = await res.text();
  nativeEl.src = `/${sampleEl.value}`;
}

function sizeValue(el) {
  return el.value === "" ? undefined : Number(el.value);
}

// Scale a requested CSS-pixel size to backing pixels for the DPR toggle,
// clamped to the server's 1..4096 limit. `undefined` passes through so the
// server falls back to the natural SVG size.
function scaledSize(value, dpr) {
  if (value === undefined) return undefined;
  return Math.min(4096, Math.max(1, Math.round(value * dpr)));
}

function applyPixelated() {
  canvas.classList.toggle("pixelated", pixelatedEl.checked);
}

function applyBboxVisibility() {
  overlayEl.style.display = bboxVisibleEl.checked ? "" : "none";
}

async function postJson(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const num = (n) => Number(n.toFixed(2));

// Draws only the boxes whose row toggle is checked; all three values stay in
// the table regardless.
function drawOverlay(data) {
  const { width, height, naturalWidth, naturalHeight } = data;
  const boxes = BOXES.filter((box) => bboxToggles.get(box.key).checked).map(
    (box) => ({
      ...box,
      rect: toPixelRect(
        data[box.key] ?? null,
        naturalWidth,
        naturalHeight,
        width,
        height,
      ),
    }),
  );
  // The raster keeps its exact output pixels; only the overlay bitmap grows by
  // half a line width on every side so boundary outlines are not clipped.
  const layout = overlayLayout(width, height);
  overlayEl.width = layout.bitmapWidth;
  overlayEl.height = layout.bitmapHeight;
  overlayEl.style.left = `${layout.css.left}%`;
  overlayEl.style.top = `${layout.css.top}%`;
  overlayEl.style.width = `${layout.css.width}%`;
  overlayEl.style.height = `${layout.css.height}%`;
  drawBoxOverlay(overlayCtx, width, height, boxes, layout.padding);
}

// Fills the bbox table (all three boxes, every render: `null` is a value) and
// draws the mapped rects onto the transparent overlay canvas. The overlay is
// separate so the raster canvas keeps the library's pixels untouched.
function showBoundingBoxes(data) {
  lastBboxData = data;
  const { width, height, naturalWidth, naturalHeight } = data;
  bboxMetaEl.textContent =
    `natural ${num(naturalWidth)}×${
      num(naturalHeight)
    } → output ${width}×${height} px` +
    ` (scale ×${num(width / naturalWidth)}, ×${num(height / naturalHeight)})`;
  for (const box of BOXES) {
    const rect = data[box.key] ?? null;
    const pixels = toPixelRect(
      rect,
      naturalWidth,
      naturalHeight,
      width,
      height,
    );
    const row = bboxRows.get(box.key);
    row.querySelector(".bbox-natural").textContent = formatRect(rect);
    row.querySelector(".bbox-pixels").textContent = formatRect(pixels);
    row.querySelector(".bbox-note").textContent =
      isClipped(pixels, width, height) ? "extends beyond canvas" : "";
  }
  drawOverlay(data);
}

function clearBoundingBoxes(message) {
  lastBboxData = null;
  bboxMetaEl.textContent = message;
  for (const row of bboxRows.values()) {
    row.querySelector(".bbox-natural").textContent = "—";
    row.querySelector(".bbox-pixels").textContent = "—";
    row.querySelector(".bbox-note").textContent = "";
  }
  overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
}

async function render() {
  const svg = sourceEl.value;
  const dpr = dprEl.checked ? globalThis.devicePixelRatio || 1 : 1;
  const width = scaledSize(sizeValue(widthEl), dpr);
  const height = scaledSize(sizeValue(heightEl), dpr);
  statusEl.textContent = "Rendering…";
  try {
    const [data, usvgData] = await Promise.all([
      postJson("/api/rgba", { svg, width, height }),
      postJson("/api/usvg", { svg }),
    ]);
    const pixels = decodeBase64(data.pixelsBase64);
    canvas.width = data.width;
    canvas.height = data.height;
    const image = new ImageData(
      new Uint8ClampedArray(pixels.buffer),
      data.width,
      data.height,
    );
    ctx.putImageData(image, 0, 0);
    statusEl.textContent =
      `${data.width}×${data.height} · alpha: ${data.alphaMode}` +
      (dprEl.checked ? ` · dpr ${dpr}` : "");
    usvgMetaEl.textContent =
      `Uint8Array ${usvgData.byteLength} bytes → usvg string ${usvgData.usvg.length} chars`;
    usvgEl.textContent = usvgData.usvg;
    showBoundingBoxes(data);
  } catch (e) {
    statusEl.textContent = `Render failed: ${e.message}`;
    clearBoundingBoxes("Render failed");
  }
}

pixelatedEl.addEventListener("change", applyPixelated);
bboxVisibleEl.addEventListener("change", applyBboxVisibility);
for (const toggle of bboxToggles.values()) {
  toggle.addEventListener("change", () => {
    if (lastBboxData !== null) drawOverlay(lastBboxData);
  });
}
dprEl.addEventListener("change", render);
sampleEl.addEventListener("change", async () => {
  await loadSample();
  await render();
});
renderBtn.addEventListener("click", render);
applyPixelated();
applyBboxVisibility();
await loadSource();
await render();
