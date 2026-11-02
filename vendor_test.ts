import { assert, assertEquals } from "@std/assert";
import { initSvg2rgba, svg2rgba } from "@tksh/svg2ui8a/svg2rgba";
import { initSvg2usvg, svg2usvg } from "@tksh/svg2ui8a/svg2usvg";

const ASSETS = new URL("./assets/svg2ui8a/", import.meta.url);
const PROVENANCE = JSON.parse(
  await Deno.readTextFile(new URL("provenance.json", ASSETS)),
);

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#ff0000"/></svg>';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("vendored Wasm files match their provenance", async () => {
  for (const name of ["svg2rgba_bg.wasm", "svg2usvg_bg.wasm"]) {
    const record = PROVENANCE.files[name];
    const bytes = await Deno.readFile(new URL(name, ASSETS));
    assertEquals(bytes.length, record.size, `${name} size`);
    assertEquals(await sha256(bytes), record.sha256, `${name} sha256`);
  }
});

Deno.test("the server source has no fixed jsr.io Wasm URL", async () => {
  const source = await Deno.readTextFile(new URL("./main.ts", import.meta.url));
  assert(!source.includes("jsr.io/@tksh/svg2ui8a"));
  assert(!source.includes("SVG2UI8A_VERSION"));
  assert(source.includes("wasmBytes:"));
});

Deno.test("the vendored rgba bytes render a known SVG", async () => {
  await initSvg2rgba({
    wasmBytes: await Deno.readFile(new URL("svg2rgba_bg.wasm", ASSETS)),
  });
  const result = await svg2rgba(SVG);
  assertEquals(result.width, 4);
  assertEquals(result.height, 4);
  assertEquals([...result.pixels.slice(0, 4)], [255, 0, 0, 255]);
});

Deno.test("the vendored usvg bytes normalize a known SVG", async () => {
  await initSvg2usvg({
    wasmBytes: await Deno.readFile(new URL("svg2usvg_bg.wasm", ASSETS)),
  });
  const bytes = await svg2usvg(SVG);
  assert(new TextDecoder().decode(bytes).includes("<svg"));
});
