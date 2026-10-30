const ROOT = new URL("../", import.meta.url);
const denoConfig = JSON.parse(
  await Deno.readTextFile(new URL("deno.json", ROOT)),
);
const lockfile = JSON.parse(
  await Deno.readTextFile(new URL("deno.lock", ROOT)),
);
const mainSource = await Deno.readTextFile(new URL("main.ts", ROOT));

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

const versionConstant = mainSource.match(
  /const\s+SVG2UI8A_VERSION\s*=\s*["']([^"']+)["']/,
);
if (versionConstant === null) {
  throw new Error("main.ts is missing const SVG2UI8A_VERSION");
}
if (versionConstant[1] !== version) {
  throw new Error(
    `svg2ui8a version mismatch: deno.json=${version}, main.ts=${
      versionConstant[1]
    }`,
  );
}

if (
  !mainSource.includes("https://jsr.io/@tksh/svg2ui8a/") ||
  !mainSource.includes("/assets/${asset}")
) {
  throw new Error("main.ts is missing the pinned svg2ui8a Wasm URL template");
}

const expectedAssets = [
  "svg2rgba_bg.wasm",
  "svg2usvg_bg.wasm",
];
for (const asset of expectedAssets) {
  if (!mainSource.includes(`svg2ui8aWasmUrl("${asset}")`)) {
    throw new Error(`main.ts is missing the pinned URL use for ${asset}`);
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

console.log(`svg2ui8a version consistency verified: ${version}`);
