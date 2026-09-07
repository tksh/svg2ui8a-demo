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

function decodeBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function loadSource() {
  const res = await fetch("/artwork.svg");
  sourceEl.value = await res.text();
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

async function render() {
  const svg = sourceEl.value;
  const dpr = dprEl.checked ? window.devicePixelRatio || 1 : 1;
  const width = scaledSize(sizeValue(widthEl), dpr);
  const height = scaledSize(sizeValue(heightEl), dpr);
  statusEl.textContent = "Rendering…";
  try {
    const [data, usvgData] = await Promise.all([
      postJson("/api/render", { svg, width, height }),
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
    statusEl.textContent = `${data.width}×${data.height} · ${data.alphaMode}` +
      (dprEl.checked ? ` · dpr ${dpr}` : "");
    usvgMetaEl.textContent =
      `Uint8Array ${usvgData.byteLength} bytes → usvg string ${usvgData.usvg.length} chars`;
    usvgEl.textContent = usvgData.usvg;
  } catch (e) {
    statusEl.textContent = `Render failed: ${e.message}`;
  }
}

pixelatedEl.addEventListener("change", applyPixelated);
dprEl.addEventListener("change", render);
renderBtn.addEventListener("click", render);
applyPixelated();
await loadSource();
await render();
