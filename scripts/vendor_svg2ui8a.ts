/**
 * Refresh the Wasm binaries vendored by the demo server.
 *
 * The published package ships `assets/*.wasm` as separate files. The server
 * reads its local copies at startup instead of fetching jsr.io at runtime, so
 * the two files under `assets/svg2ui8a/` and their provenance are refreshed
 * together after a version bump.
 *
 * Run after changing the svg2ui8a import entries: `deno task vendor:svg2ui8a`.
 */

const VERSION = "0.6.1";
const PACKAGE = "@tksh/svg2ui8a";
const DEST = new URL("../assets/svg2ui8a/", import.meta.url);

interface VendoredFile {
  name: string;
  sha256: string;
  size: number;
}

const FILES: VendoredFile[] = [
  {
    name: "svg2rgba_bg.wasm",
    sha256: "efe5a798399e181b1acecd7b7f4b9e736f2a13451222e4f9cb513415717a4bb6",
    size: 998801,
  },
  {
    name: "svg2usvg_bg.wasm",
    sha256: "d9c17f6a1c28a773dede5800f802dc9603244bb737c96db6b0905715d00fb33e",
    size: 657772,
  },
];

function sourceUrl(name: string): string {
  return `https://jsr.io/${PACKAGE}/${VERSION}/assets/${name}`;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

await Deno.mkdir(DEST, { recursive: true });

for (const file of FILES) {
  const url = sourceUrl(file.name);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `vendor_svg2ui8a: cannot fetch ${url} (${response.status} ${response.statusText})`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== file.size) {
    throw new Error(
      `vendor_svg2ui8a: ${url} has ${bytes.byteLength} bytes, expected ${file.size}`,
    );
  }
  const actual = await sha256(bytes);
  if (actual !== file.sha256) {
    throw new Error(
      `vendor_svg2ui8a: ${url} has sha256 ${actual}, expected ${file.sha256}`,
    );
  }
  await Deno.writeFile(new URL(file.name, DEST), new Uint8Array(bytes));
  console.log(`✅ ${file.name} (${file.size} bytes)`);
}

const provenance = {
  package: PACKAGE,
  version: VERSION,
  files: Object.fromEntries(
    FILES.map((file) => [
      file.name,
      {
        sourceUrl: sourceUrl(file.name),
        size: file.size,
        sha256: file.sha256,
      },
    ]),
  ),
};
await Deno.writeTextFile(
  new URL("provenance.json", DEST),
  `${JSON.stringify(provenance, null, 2)}\n`,
);
console.log("✅ provenance.json");
