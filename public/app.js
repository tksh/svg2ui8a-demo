import {
  BOXES,
  boxOverflow,
  drawBoxOverlay,
  drawViewBoxOutline,
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
const sourceMetaEl = document.getElementById("source-meta");
const dprEl = document.getElementById("dpr");
const pixelatedEl = document.getElementById("pixelated");
const sampleEl = document.getElementById("sample");
const nativeEl = document.getElementById("native");
const overlayEl = document.getElementById("bbox-overlay");
const overlayCtx = overlayEl.getContext("2d");
const bboxVisibleEl = document.getElementById("bbox-visible");
const bboxMetaEl = document.getElementById("bbox-meta");
const regionModeEl = document.getElementById("region-mode");
const alphaModeEl = document.getElementById("alpha-mode");
const regionFieldsEl = document.getElementById("region-fields");
const regionXEl = document.getElementById("region-x");
const regionYEl = document.getElementById("region-y");
const regionWEl = document.getElementById("region-w");
const regionHEl = document.getElementById("region-h");
const previewNoteEl = document.getElementById("preview-note");
const viewBoxLegendEl = document.getElementById("viewbox-legend");
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

// Shows the custom-region inputs, the native-preview note, and the viewBox
// legend only when the selected region mode needs them.
function applyRegionModeVisibility() {
  const mode = regionModeEl.value;
  regionFieldsEl.hidden = mode !== "custom";
  previewNoteEl.hidden = mode === "natural";
  viewBoxLegendEl.hidden = mode === "natural";
}

// Pre-fills the custom inputs from the last applied window.
function syncRegionInputs() {
  if (lastBboxData === null) return;
  const { region } = lastBboxData;
  regionXEl.value = String(num(region.x));
  regionYEl.value = String(num(region.y));
  regionWEl.value = String(num(region.width));
  regionHEl.value = String(num(region.height));
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
// the table regardless. The overlay bitmap keeps the raster's exact pixels and
// grows by half a line width per side, plus any box overflow beyond the frame,
// so boundary and off-frame outlines stay visible.
function drawOverlay(data) {
  const { width, height, region } = data;
  const mapped = BOXES.map((box) => ({
    box,
    rect: toPixelRect(data[box.key] ?? null, region, width, height),
  }));
  const boxes = mapped
    .filter(({ box }) => bboxToggles.get(box.key).checked)
    .map(({ box, rect }) => ({ ...box, rect }));
  const layout = overlayLayout(
    width,
    height,
    boxOverflow(mapped.map(({ rect }) => rect), width, height),
  );
  overlayEl.width = layout.bitmapWidth;
  overlayEl.height = layout.bitmapHeight;
  overlayEl.style.left = `${layout.css.left}%`;
  overlayEl.style.top = `${layout.css.top}%`;
  overlayEl.style.width = `${layout.css.width}%`;
  overlayEl.style.height = `${layout.css.height}%`;
  drawBoxOverlay(overlayCtx, width, height, boxes, layout.padding);
  if (regionModeEl.value !== "natural") {
    const viewBoxRect = toPixelRect(
      { x: 0, y: 0, width: data.naturalWidth, height: data.naturalHeight },
      region,
      width,
      height,
    );
    if (viewBoxRect !== null) {
      drawViewBoxOutline(overlayCtx, viewBoxRect, layout.padding);
    }
  }
}

// Fills the bbox table (all three boxes, every render: `null` is a value) and
// draws the mapped rects onto the transparent overlay canvas. The overlay is
// separate so the raster canvas keeps the library's pixels untouched.
function showBoundingBoxes(data) {
  lastBboxData = data;
  const { width, height, naturalWidth, naturalHeight, region } = data;
  const isNatural = region.x === 0 && region.y === 0 &&
    region.width === naturalWidth && region.height === naturalHeight;
  bboxMetaEl.textContent =
    `region ${num(region.x)}, ${num(region.y)}, ${num(region.width)}×${
      num(region.height)
    } → output ${width}×${height} px` +
    ` (scale ×${num(width / region.width)}, ×${num(height / region.height)})` +
    (isNatural ? "" : ` · natural ${num(naturalWidth)}×${num(naturalHeight)}`);
  for (const box of BOXES) {
    const rect = data[box.key] ?? null;
    const pixels = toPixelRect(rect, region, width, height);
    const row = bboxRows.get(box.key);
    row.querySelector(".bbox-natural").textContent = formatRect(rect);
    row.querySelector(".bbox-pixels").textContent = formatRect(pixels);
    row.querySelector(".bbox-note").textContent =
      isClipped(pixels, width, height) ? "extends beyond view" : "";
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
  const regionMode = regionModeEl.value;
  const regionFields = regionMode === "fit"
    ? { fit: "bounds" }
    : regionMode === "custom"
    ? {
      region: {
        x: Number(regionXEl.value),
        y: Number(regionYEl.value),
        width: Number(regionWEl.value),
        height: Number(regionHEl.value),
      },
    }
    : {};
  const payload = {
    svg,
    width,
    height,
    alphaMode: alphaModeEl.value,
    ...regionFields,
  };
  statusEl.textContent = "Rendering…";
  try {
    const [data, usvgData] = await Promise.all([
      postJson("/api/rgba", payload),
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
    // Input and usvg sizes, measured together per render (no per-keystroke work).
    sourceMetaEl.textContent = `SVG string ${svg.length} chars`;
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
alphaModeEl.addEventListener("change", render);
regionModeEl.addEventListener("change", () => {
  if (regionModeEl.value === "custom") syncRegionInputs();
  applyRegionModeVisibility();
  render();
});
sampleEl.addEventListener("change", async () => {
  await loadSample();
  await render();
});
renderBtn.addEventListener("click", render);
applyPixelated();
applyBboxVisibility();
applyRegionModeVisibility();
await loadSource();
await render();
