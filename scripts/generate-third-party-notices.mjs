// Generates THIRD_PARTY_NOTICES.md from Cargo.lock/Cargo metadata and package-lock.json.
// Run from the repository root: node scripts/generate-third-party-notices.mjs

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const noticesPath = path.join(root, "THIRD_PARTY_NOTICES.md");
const cargoManifest = path.join(root, "src-tauri", "Cargo.toml");

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
  "This file lists the third-party software used by the project. It covers Rust crates linked into the executable and npm packages used by the frontend. Development-only npm packages are included for completeness, even though they are not shipped in the installer.",
);
lines.push("");
lines.push("## Bundled native component: mpv / libmpv");
lines.push("");
lines.push(
  "The release installer and portable build include `libmpv-2.dll` version `v0.41.0-1308-gbaa3e11d4`, built from mpv commit `baa3e11d4`.",
);
lines.push("");
lines.push("- Project: https://github.com/mpv-player/mpv");
lines.push("- Exact source commit: https://github.com/mpv-player/mpv/tree/baa3e11d4");
lines.push("- Windows build scripts: https://github.com/shinchiro/mpv-winbuild-cmake");
lines.push(
  "- License: GNU General Public License, version 2 or later. The full text is in [licenses/GPL-2.0.txt](licenses/GPL-2.0.txt).",
);
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
lines.push("## License texts");
lines.push("");
lines.push(
  "The license texts below are reproduced from the dependency packages. Where a package includes multiple license files, each file is listed. If a package did not ship a license file, its declared license is shown in the tables above and the package source should be consulted.",
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
  `Wrote ${noticesPath}: ${rustEntries.length} Rust packages, ${npmEntries.length} npm packages, ${rustGroups.length + npmGroups.length} license texts.`,
);
