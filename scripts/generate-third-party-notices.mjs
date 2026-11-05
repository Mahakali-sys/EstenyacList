// Generates THIRD_PARTY_NOTICES.md from Cargo.lock/Cargo metadata and package-lock.json.
// Run from the repository root: node scripts/generate-third-party-notices.mjs

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const noticesPath = path.join(root, "THIRD_PARTY_NOTICES.md");
const cargoManifest = path.join(root, "src-tauri", "Cargo.toml");
const nativeManifestPath = path.join(root, "scripts", "native-dependencies.json");

function fail(message) {
  throw new Error(`native dependency audit failed: ${message}`);
}

function validateNativeManifest(manifest) {
  const roles = new Set(["linked", "headers", "runtime"]);
  const licenseIds = new Set(Object.keys(manifest.licenses));
  const usedLicenseIds = new Set();
  const seenNames = new Set();

  if (!manifest.binary?.file || !manifest.binary?.sha256) {
    fail("binary file and SHA-256 are required");
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.binary.sha256)) {
    fail(`invalid binary SHA-256: ${manifest.binary.sha256}`);
  }

  for (const [id, file] of Object.entries(manifest.licenses)) {
    if (!fs.existsSync(path.join(root, file))) {
      fail(`license text for ${id} does not exist: ${file}`);
    }
  }

  for (const component of manifest.components) {
    if (!component.name || !component.license || !component.url || !component.role) {
      fail(`component is missing a required field: ${JSON.stringify(component)}`);
    }
    if (seenNames.has(component.name)) {
      fail(`duplicate component name: ${component.name}`);
    }
    seenNames.add(component.name);
    if (!roles.has(component.role)) {
      fail(`unknown role "${component.role}" for ${component.name}`);
    }
    if (!/^https?:\/\//.test(component.url)) {
      fail(`invalid upstream URL for ${component.name}: ${component.url}`);
    }
    if (!Array.isArray(component.texts) || component.texts.length === 0) {
      fail(`component ${component.name} has no license texts`);
    }
    for (const id of component.texts) {
      if (!licenseIds.has(id)) {
        fail(`component ${component.name} references unknown license text: ${id}`);
      }
      usedLicenseIds.add(id);
    }
  }

  for (const id of licenseIds) {
    if (!usedLicenseIds.has(id)) {
      fail(`license text ${id} is not referenced by any component`);
    }
  }

  const nativeDir = path.join(root, "licenses", "native");
  const mappedFiles = new Set(
    Object.values(manifest.licenses).map((file) => path.normalize(path.join(root, file))),
  );
  for (const name of fs.readdirSync(nativeDir)) {
    if (!name.endsWith(".txt")) continue;
    const file = path.normalize(path.join(nativeDir, name));
    if (!mappedFiles.has(file)) {
      fail(`native license file is not mapped in the manifest: licenses/native/${name}`);
    }
  }

  const binaryPath = path.join(root, manifest.binary.file);
  if (fs.existsSync(binaryPath)) {
    const data = fs.readFileSync(binaryPath);
    const hash = crypto.createHash("sha256").update(data).digest("hex");
    if (hash !== manifest.binary.sha256) {
      fail(`binary SHA-256 mismatch: expected ${manifest.binary.sha256}, got ${hash}`);
    }
    if (manifest.binary.size && data.length !== manifest.binary.size) {
      fail(`binary size mismatch: expected ${manifest.binary.size}, got ${data.length}`);
    }
  } else {
    console.warn(
      `warning: ${manifest.binary.file} is missing; skipped binary hash verification.`,
    );
  }
}

const nativeManifest = JSON.parse(fs.readFileSync(nativeManifestPath, "utf8"));
validateNativeManifest(nativeManifest);

const roleLabels = {
  linked: "Statically linked",
  headers: "Build-time headers only",
  runtime: "Runtime import (not bundled)",
};

function readLicenseFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^(license|licence|copying|notice|copyright)/i.test(name))
    .filter((name) => fs.statSync(path.join(dir, name)).isFile())
    .map((name) => {
      const file = path.join(dir, name);
      return { name, text: fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim() };
    })
    .filter((entry) => entry.text.length > 0);
}

function licenseTextGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    for (const file of entry.files) {
      const hash = crypto.createHash("sha256").update(file.text).digest("hex");
      if (!groups.has(hash)) {
        groups.set(hash, {
          text: file.text,
          packages: new Set(),
        });
      }
      groups.get(hash).packages.add(`${entry.name}@${entry.version}`);
    }
  }
  return [...groups.values()].sort((a, b) => a.packages.size - b.packages.size);
}

function escapeTable(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function crateUrl(name, version) {
  return `https://crates.io/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--manifest-path", cargoManifest, "--locked"],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
  ),
);

const rustEntries = [];
for (const pkg of metadata.packages) {
  if (pkg.name === "estenyac-list") continue;
  const dir = path.dirname(pkg.manifest_path);
  const files = readLicenseFiles(dir);
  rustEntries.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? "see package",
    repository: pkg.repository ?? crateUrl(pkg.name, pkg.version),
    files,
  });
}

const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const npmEntries = [];
for (const [key, value] of Object.entries(lock.packages ?? {})) {
  if (!key.startsWith("node_modules/") || value.link) continue;
  const dir = path.join(root, key);
  const files = readLicenseFiles(dir);
  npmEntries.push({
    name: key.slice("node_modules/".length),
    version: value.version ?? "",
    license: typeof value.license === "string" ? value.license : "see package",
    repository: value.resolved ?? `https://www.npmjs.com/package/${key.slice("node_modules/".length)}`,
    dev: Boolean(value.dev),
    files,
  });
}

const rustGroups = licenseTextGroups(rustEntries);
const npmGroups = licenseTextGroups(npmEntries);

const lines = [];
lines.push("# Third-party notices");
lines.push("");
lines.push(
  "EstenyacList is licensed under the GNU General Public License, version 3 or later. See [LICENSE](LICENSE).",
);
lines.push("");
lines.push(
  "This file lists the third-party software used by the project. It covers the native libraries statically linked into libmpv-2.dll, Rust crates linked into the executable, and npm packages used by the frontend. Development-only npm packages are included for completeness, even though they are not shipped in the installer.",
);
lines.push("");
const binary = nativeManifest.binary;
const buildScripts = binary.buildScripts;
const roleCounts = { linked: 0, headers: 0, runtime: 0 };
for (const component of nativeManifest.components) roleCounts[component.role] += 1;
const binarySize = binary.size ? `${binary.size.toLocaleString("en-US")} bytes, ` : "";

lines.push("## Bundled native components");
lines.push("");
lines.push(
  `The release installer and portable build include \`${binary.file}\` (${binarySize}SHA-256 \`${binary.sha256}\`). It reports mpv \`${binary.version}\` built from mpv commit \`${binary.sourceCommit}\`.`,
);
lines.push("");
lines.push(
  "The DLL is a combined work distributed under the GNU General Public License, version 3 or later. mpv itself is GPL-2.0-or-later, and FFmpeg is configured with `--enable-gpl --enable-version3`; the GPL-2.0-or-later codec libraries are compatible with the GPLv3. The GPL-2.0 text is in [licenses/GPL-2.0.txt](licenses/GPL-2.0.txt) and the GPL-3.0 text is in [LICENSE](LICENSE).",
);
lines.push("");
lines.push("Build attribution:");
lines.push("");
lines.push(`- mpv source: https://github.com/mpv-player/mpv/tree/${binary.sourceCommit}`);
lines.push("- FFmpeg source: https://github.com/FFmpeg/FFmpeg");
lines.push(
  `- Native build scripts: ${buildScripts.repository}/tree/${buildScripts.commit} (${buildScripts.date})`,
);
lines.push(`- Builder: ${binary.builder}`);
lines.push(`- Reference build run: ${binary.referenceBuildRun}`);
lines.push(`- Binary build timestamp: ${binary.buildTimestamp.replace("T", " ")}`);
lines.push("");
lines.push(`Provenance note: ${binary.provenanceNote}`);
lines.push("");
const runtimeLabel = roleCounts.runtime === 1 ? "runtime import" : "runtime imports";
lines.push(
  `The table below lists ${nativeManifest.components.length} native components: ${roleCounts.linked} statically linked, ${roleCounts.headers} build-time header packages, and ${roleCounts.runtime} ${runtimeLabel}. Version strings reported by the binary are listed where available. For components without a reported version, the exact revision depends on the build and is not recoverable from the binary alone; the upstream project is linked.`,
);
lines.push("");
lines.push("<details>");
lines.push("<summary>Show native component list</summary>");
lines.push("");
lines.push("| Component | Version / revision | License | Role | Notes | Upstream |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const component of [...nativeManifest.components].sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  lines.push(
    `| ${escapeTable(component.name)} | ${escapeTable(component.version || "not recorded")} | ${escapeTable(component.license)} | ${roleLabels[component.role]} | ${escapeTable(component.note ?? "-")} | [source](${component.url}) |`,
  );
}
lines.push("");
lines.push("</details>");
lines.push("");
lines.push("### Native license texts");
lines.push("");
lines.push(
  "The full text of each license is included in the release under `licenses/native/`, together with `licenses/GPL-2.0.txt` and `LICENSE`.",
);
lines.push("");
lines.push("| License | File |");
lines.push("| --- | --- |");
for (const [id, file] of Object.entries(nativeManifest.licenses).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  lines.push(`| ${escapeTable(id)} | [${file}](${file}) |`);
}
lines.push("");
lines.push("## Rust dependencies");
lines.push("");
lines.push(`The executable links ${rustEntries.length} Rust packages, including transitive dependencies.`);
lines.push("");
lines.push("<details>");
lines.push("<summary>Show Rust dependency list</summary>");
lines.push("");
lines.push("| Crate | Version | License | Source |");
lines.push("| --- | --- | --- | --- |");
for (const entry of rustEntries.sort((a, b) => a.name.localeCompare(b.name))) {
  lines.push(
    `| ${escapeTable(entry.name)} | ${escapeTable(entry.version)} | ${escapeTable(entry.license)} | ${escapeTable(entry.repository)} |`,
  );
}
lines.push("");
lines.push("</details>");
lines.push("");
lines.push("## npm dependencies");
lines.push("");
lines.push(`The frontend uses ${npmEntries.length} npm packages, including development dependencies.`);
lines.push("");
lines.push("<details>");
lines.push("<summary>Show npm dependency list</summary>");
lines.push("");
lines.push("| Package | Version | License | Source |");
lines.push("| --- | --- | --- | --- |");
for (const entry of npmEntries.sort((a, b) => a.name.localeCompare(b.name))) {
  lines.push(
    `| ${escapeTable(entry.name)} | ${escapeTable(entry.version)} | ${escapeTable(entry.license)} | ${escapeTable(entry.repository)} |`,
  );
}
lines.push("");
lines.push("</details>");
lines.push("");
lines.push("## Rust and npm license texts");
lines.push("");
lines.push(
  "The Rust and npm license texts below are reproduced from the dependency packages. Where a package includes multiple license files, each file is listed. If a package did not ship a license file, its declared license is shown in the tables above and the package source should be consulted.",
);

lines.push("");
lines.push("### Rust crate license texts");
lines.push("");
rustGroups.forEach((group, index) => {
  const packages = [...group.packages].sort();
  lines.push("<details>");
  lines.push(
    `<summary>Rust license text ${index + 1} (${packages.length} package${packages.length === 1 ? "" : "s"})</summary>`,
  );
  lines.push("");
  lines.push(`Packages: ${packages.join(", ")}`);
  lines.push("");
  lines.push("```text");
  lines.push(group.text);
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  lines.push("");
});

lines.push("### npm package license texts");
lines.push("");
npmGroups.forEach((group, index) => {
  const packages = [...group.packages].sort();
  lines.push("<details>");
  lines.push(
    `<summary>npm license text ${index + 1} (${packages.length} package${packages.length === 1 ? "" : "s"})</summary>`,
  );
  lines.push("");
  lines.push(`Packages: ${packages.join(", ")}`);
  lines.push("");
  lines.push("```text");
  lines.push(group.text);
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  lines.push("");
});

fs.writeFileSync(noticesPath, `${lines.join("\n").trim()}\n`, "utf8");
console.log(
  `Wrote ${noticesPath}: ${nativeManifest.components.length} native components, ${rustEntries.length} Rust packages, ${npmEntries.length} npm packages, ${rustGroups.length + npmGroups.length} Rust/npm license texts.`,
);
