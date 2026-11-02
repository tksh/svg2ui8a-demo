const ROOT = new URL("../", import.meta.url);
const denoConfig = JSON.parse(
  await Deno.readTextFile(new URL("deno.json", ROOT)),
);
const lockfile = JSON.parse(
  await Deno.readTextFile(new URL("deno.lock", ROOT)),
);
const mainSource = await Deno.readTextFile(new URL("main.ts", ROOT));
const provenance = JSON.parse(
  await Deno.readTextFile(
    new URL("assets/svg2ui8a/provenance.json", ROOT),
  ),
);

const imports = denoConfig.imports as Record<string, string>;
const entryNames = [
  "@tksh/svg2ui8a",
  "@tksh/svg2ui8a/svg2rgba",
  "@tksh/svg2ui8a/svg2usvg",
];

const versions = entryNames.map((entryName) => {
  const specifier = imports[entryName];
  if (specifier === undefined) {
    throw new Error(`Missing svg2ui8a import-map entry: ${entryName}`);
  }

  const match = specifier.match(/^jsr:@tksh\/svg2ui8a@([^/]+)(?:\/.*)?$/);
  if (match === null || match[1].includes("^")) {
    throw new Error(
      `${entryName} must use an exact jsr:@tksh/svg2ui8a@VERSION specifier; got ${specifier}`,
    );
  }
  return match[1];
});

if (new Set(versions).size !== 1) {
  throw new Error(
    `svg2ui8a import-map entries disagree: ${
      entryNames.map((entry, i) => `${entry}=${versions[i]}`).join(", ")
    }`,
  );
}

const version = versions[0];
const expectedSubpaths = new Map([
  ["@tksh/svg2ui8a", "jsr:@tksh/svg2ui8a@VERSION"],
  ["@tksh/svg2ui8a/svg2rgba", "jsr:@tksh/svg2ui8a@VERSION/svg2rgba"],
  ["@tksh/svg2ui8a/svg2usvg", "jsr:@tksh/svg2ui8a@VERSION/svg2usvg"],
]);
for (const entryName of entryNames) {
  const expected = expectedSubpaths.get(entryName)!.replace("VERSION", version);
  if (imports[entryName] !== expected) {
    throw new Error(
      `${entryName} must be ${expected}; got ${imports[entryName]}`,
    );
  }
}

const lockSpecifiers = lockfile.specifiers as Record<string, string>;
const lockResolution = lockSpecifiers[`jsr:@tksh/svg2ui8a@${version}`];
if (lockResolution !== version) {
  throw new Error(
    `deno.lock must resolve jsr:@tksh/svg2ui8a@${version} to ${version}; got ${
      lockResolution ?? "missing"
    }`,
  );
}

const workspaceDependencies = lockfile.workspace?.dependencies as
  | string[]
  | undefined;
if (!workspaceDependencies?.includes(`jsr:@tksh/svg2ui8a@${version}`)) {
  throw new Error(
    `deno.lock workspace dependencies must include jsr:@tksh/svg2ui8a@${version}`,
  );
}

if (provenance.package !== "@tksh/svg2ui8a") {
  throw new Error(
    `provenance package must be @tksh/svg2ui8a; got ${provenance.package}`,
  );
}
if (provenance.version !== version) {
  throw new Error(
    `provenance version ${provenance.version} does not match import version ${version}`,
  );
}

const expectedAssets = [
  "svg2rgba_bg.wasm",
  "svg2usvg_bg.wasm",
];
for (const name of expectedAssets) {
  const record = provenance.files?.[name] as
    | { sourceUrl?: string; size?: number; sha256?: string }
    | undefined;
  if (record === undefined) {
    throw new Error(`provenance is missing ${name}`);
  }
  if (
    record.sourceUrl !==
      `https://jsr.io/@tksh/svg2ui8a/${version}/assets/${name}`
  ) {
    throw new Error(`provenance source URL for ${name} is not versioned`);
  }
  if (record.sha256 === undefined || !/^[0-9a-f]{64}$/.test(record.sha256)) {
    throw new Error(`provenance sha256 for ${name} must be 64 lowercase hex`);
  }

  const path = new URL(`assets/svg2ui8a/${name}`, ROOT);
  const bytes = await Deno.readFile(path);
  if (record.size !== bytes.length) {
    throw new Error(
      `provenance size for ${name} is ${record.size}, actual ${bytes.length}`,
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer,
  );
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== record.sha256) {
    throw new Error(
      `provenance sha256 for ${name} is ${record.sha256}, actual ${actual}`,
    );
  }
}

if (!mainSource.includes("Deno.readFile(")) {
  throw new Error(
    "main.ts must read the vendored Wasm files with Deno.readFile",
  );
}
for (const name of expectedAssets) {
  if (!mainSource.includes(`readVendoredWasm("${name}")`)) {
    throw new Error(`main.ts must read ${name} from the vendored assets`);
  }
}
if (!mainSource.includes("wasmBytes:")) {
  throw new Error("main.ts must initialize svg2ui8a from wasmBytes");
}
if (
  mainSource.includes("jsr.io/@tksh/svg2ui8a") ||
  mainSource.includes("svg2ui8aWasmUrl") ||
  /const\s+SVG2UI8A_VERSION\s*=/.test(mainSource)
) {
  throw new Error(
    "main.ts must not contain a fixed jsr.io Wasm URL or SVG2UI8A_VERSION",
  );
}

console.log(`svg2ui8a version consistency verified: ${version}`);
