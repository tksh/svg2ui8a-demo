const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const widthEl = document.getElementById("width");
const heightEl = document.getElementById("height");
const renderBtn = document.getElementById("render");
const sourceEl = document.getElementById("source");
const usvgMetaEl = document.getElementById("usvg-meta");
const usvgEl = document.getElementById("usvg");

function decodeBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadSource() {
  const res = await fetch("/artwork.svg");
  sourceEl.textContent = await res.text();
}

async function render() {
  const width = widthEl.value;
  const height = heightEl.value;
  statusEl.textContent = "Rendering…";
  try {
    const res = await fetch(`/api/render?width=${width}&height=${height}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    const pixels = decodeBase64(data.pixelsBase64);
    canvas.width = data.width;
    canvas.height = data.height;
    const image = new ImageData(
      new Uint8ClampedArray(pixels.buffer),
      data.width,
      data.height,
    );
    ctx.putImageData(image, 0, 0);
    statusEl.textContent = `${data.width}×${data.height} · ${data.alphaMode}`;
  } catch (e) {
    statusEl.textContent = `Render failed: ${e.message}`;
  }
}

async function loadUsvg() {
  try {
    const res = await fetch("/api/usvg");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    usvgMetaEl.textContent =
      `Uint8Array ${data.byteLength} bytes → usvg string ${data.usvg.length} chars`;
    usvgEl.textContent = data.usvg;
  } catch (e) {
    usvgMetaEl.textContent = `Failed to load usvg: ${e.message}`;
    usvgEl.textContent = "";
  }
}

renderBtn.addEventListener("click", render);
await loadSource();
await loadUsvg();
await render();
