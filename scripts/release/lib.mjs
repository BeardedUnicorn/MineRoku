/**
 * The release's pure parts (modeled on TaskMint's). scripts/release.mjs
 * handles the files, git and builds. This file covers:
 *
 * - the next version and the CHANGELOG section
 * - the version in each manifest
 * - what a release ships and where Tauri leaves each file
 * - the desktop updates (their signatures and latest.json)
 * - the checks on the APK's signer and package
 *
 * Tested by lib.test.mjs (`node --test scripts/release`).
 */

import { createHash, createPublicKey, verify } from 'node:crypto';

// ── Versions ────────────────────────────────────────────────────────────────

/** Bump levels, lowest first. */
export const BUMPS = ['patch', 'minor', 'major'];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function isVersion(text) {
  return VERSION.test(text);
}

export function bumpVersion(version, bump) {
  const match = version.match(VERSION);
  if (!match) throw new Error(`"${version}" isn't a version like 1.2.3`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`"${bump}" isn't one of ${BUMPS.join(', ')}`);
}

/** A local date as YYYY-MM-DD. */
export function isoDate(date) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ── The CHANGELOG ───────────────────────────────────────────────────────────
// Changes go under "## Unreleased" as they land; a release renames that
// heading to "## X.Y.Z – YYYY-MM-DD". The app shows each release's section
// as its notes (latest.json's `notes` and `changelog`).

const HEADING = /^## (\S+)/;
const UNRELEASED = 'Unreleased';

/** The versions the CHANGELOG has sections for, newest first (Unreleased aside). */
export function changelogVersions(changelog) {
  return changelog.split('\n').flatMap(line => {
    const name = line.match(HEADING)?.[1];
    return name && isVersion(name) ? [name] : [];
  });
}

/** A section's lines without its heading, trimmed; null when there's no such section. */
function sectionBody(changelog, name) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => line.match(HEADING)?.[1] === name);
  if (start === -1) return null;
  const next = lines.findIndex((line, index) => index > start && HEADING.test(line));
  return lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join('\n')
    .trim();
}

/**
 * The CHANGELOG with its Unreleased section made `version`'s. Throws when
 * there's nothing unreleased to release, or the version has a section already.
 */
export function releaseUnreleased(changelog, version, date) {
  if (changelogVersions(changelog).includes(version)) throw new Error(`CHANGELOG.md already has ${version}`);
  const body = sectionBody(changelog, UNRELEASED);
  if (body === null) throw new Error('CHANGELOG.md has no "## Unreleased" section to release');
  if (body === '') throw new Error('CHANGELOG.md\'s "## Unreleased" section is empty: say what this release changes');
  return changelog.replace(/^## Unreleased[^\n]*$/m, `## ${version} – ${date}`);
}

/** A version's section without its heading (the release notes); null when it has none. */
export function extractSection(changelog, version) {
  return sectionBody(changelog, version);
}

/** How many releases' notes the update feed carries: enough for any update, without growing for good. */
export const FEED_RELEASES = 30;

/**
 * The newest releases' sections (`limit` of them) with their headings,
 * newest first, without the file's header or Unreleased ('' with no
 * release yet).
 */
export function releaseSections(changelog, limit = FEED_RELEASES) {
  const lines = changelog.split('\n');
  const headings = lines.flatMap((line, index) => {
    const name = line.match(HEADING)?.[1];
    return name && isVersion(name) ? [index] : [];
  });
  return headings
    .slice(0, limit)
    .map(start => {
      const next = lines.findIndex((line, index) => index > start && HEADING.test(line));
      return lines
        .slice(start, next === -1 ? undefined : next)
        .join('\n')
        .trim();
    })
    .join('\n\n');
}

// ── The version in each manifest ────────────────────────────────────────────
// Each edit replaces only the version text, so the file's formatting is kept.
// tauri.conf.json reads its version from package.json.

const PACKAGE_JSON_VERSION = /^(\s*"version":\s*")([^"]*)(")/m;

export function packageJsonVersion(text, file) {
  const match = text.match(PACKAGE_JSON_VERSION);
  if (!match) throw new Error(`${file}: no "version"`);
  return match[2];
}

export function setPackageJsonVersion(text, version, file) {
  packageJsonVersion(text, file);
  return text.replace(PACKAGE_JSON_VERSION, `$1${version}$3`);
}

/** The [package] table: from its header to the next table. */
function packageTable(text, file) {
  const start = text.search(/^\[package\]\s*$/m);
  if (start === -1) throw new Error(`${file}: no [package] table`);
  const rest = text.slice(start + 1).search(/^\[/m);
  const end = rest === -1 ? text.length : start + 1 + rest;
  return { start, end, table: text.slice(start, end) };
}

function cargoField(text, field, file) {
  const match = packageTable(text, file).table.match(new RegExp(`^${field}\\s*=\\s*"([^"]*)"`, 'm'));
  if (!match) throw new Error(`${file}: no ${field} in [package]`);
  return match[1];
}

export const cargoTomlVersion = (text, file) => cargoField(text, 'version', file);
export const cargoTomlName = (text, file) => cargoField(text, 'name', file);

export function setCargoTomlVersion(text, version, file) {
  cargoTomlVersion(text, file);
  const { start, end, table } = packageTable(text, file);
  return text.slice(0, start) + table.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${version}$2`) + text.slice(end);
}

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cargo.lock with the named package at the version; it must be listed exactly once. */
export function setCargoLockVersion(text, name, version) {
  const entry = new RegExp(`(\\[\\[package\\]\\]\\nname = "${escapeRegex(name)}"\\nversion = ")[^"]*(")`, 'g');
  const count = text.match(entry)?.length ?? 0;
  if (count !== 1) throw new Error(`Cargo.lock lists ${name} ${count} times, expected once`);
  return text.replace(entry, `$1${version}$2`);
}

// ── What a release ships ────────────────────────────────────────────────────
// One file per target, named `RokuRemote-<version>-<suffix>`, and next to
// each desktop installer its update and the update's signature. The Release
// workflow builds every target on its own runner.

/** The release files' prefix. Tauri's own names use productName ("Roku Remote"). */
export const PRODUCT = 'RokuRemote';
const TAURI_PRODUCT = 'Roku Remote';

/** Every target a release ships, in the order the release lists them. */
export const TARGETS = ['macos-arm64', 'macos-x64', 'windows-x64', 'android-arm64'];

/**
 * The desktop targets:
 * - the Rust triple, built with `--target` (null for the runner's own)
 * - the bundles to make
 * - where Tauri leaves the installer and the update, under src-tauri/target/<triple>/release/bundle/
 * - the target's name in latest.json
 */
const DESKTOP = {
  'macos-arm64': {
    triple: 'aarch64-apple-darwin',
    bundles: 'app,dmg',
    installer: version => `dmg/${TAURI_PRODUCT}_${version}_aarch64.dmg`,
    update: () => `macos/${TAURI_PRODUCT}.app.tar.gz`,
    suffix: 'macos-arm64.dmg',
    updateSuffix: 'macos-arm64.app.tar.gz',
    platform: 'darwin-aarch64',
  },
  // Cross-compiled on the Apple silicon runner
  'macos-x64': {
    triple: 'x86_64-apple-darwin',
    bundles: 'app,dmg',
    installer: version => `dmg/${TAURI_PRODUCT}_${version}_x64.dmg`,
    update: () => `macos/${TAURI_PRODUCT}.app.tar.gz`,
    suffix: 'macos-x64.dmg',
    updateSuffix: 'macos-x64.app.tar.gz',
    platform: 'darwin-x86_64',
  },
  // On Windows the update is the NSIS installer itself, run in passive mode
  'windows-x64': {
    triple: 'x86_64-pc-windows-msvc',
    bundles: 'nsis',
    installer: version => `nsis/${TAURI_PRODUCT}_${version}_x64-setup.exe`,
    update: version => `nsis/${TAURI_PRODUCT}_${version}_x64-setup.exe`,
    suffix: 'windows-x64-setup.exe',
    updateSuffix: null,
    platform: 'windows-x86_64',
  },
};

/** The Android target: Tauri's name for its ABI, and where Gradle leaves the APK. */
const ANDROID = {
  'android-arm64': {
    triple: 'aarch64-linux-android',
    tauriTarget: 'aarch64',
    apk: 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk',
    suffix: 'android-arm64.apk',
  },
};

/** The desktop targets, in the order the release lists them. */
export const DESKTOP_TARGETS = TARGETS.filter(target => target in DESKTOP);

export const isTarget = name => TARGETS.includes(name);
export const isDesktop = name => name in DESKTOP;

function requireTarget(target) {
  if (!isTarget(target)) throw new Error(`Unknown target "${target}" (one of ${TARGETS.join(', ')})`);
}

function requireDesktop(target) {
  requireTarget(target);
  if (!isDesktop(target)) throw new Error(`${target} has no desktop update`);
}

/** The file a target ships as: its installer, or the APK. */
export function assetName(version, target) {
  requireTarget(target);
  const { suffix } = DESKTOP[target] ?? ANDROID[target];
  return `${PRODUCT}-${version}-${suffix}`;
}

/** The files a desktop target's update ships as: `{ file, signature }`. */
export function updateAssetNames(version, target) {
  requireDesktop(target);
  const { updateSuffix } = DESKTOP[target];
  const file = updateSuffix ? `${PRODUCT}-${version}-${updateSuffix}` : assetName(version, target);
  return { file, signature: `${file}.sig` };
}

/** Every file a release ships, latest.json aside (it's made from them). */
export function releaseAssets(version) {
  const updates = DESKTOP_TARGETS.flatMap(target => {
    const { file, signature } = updateAssetNames(version, target);
    // (Windows' update is its installer)
    return file === assetName(version, target) ? [signature] : [file, signature];
  });
  return [...TARGETS.map(target => assetName(version, target)), ...updates];
}

/** The files a release needs that aren't among `files` (file names). */
export function missingAssets(version, files) {
  return releaseAssets(version).filter(name => !files.includes(name));
}

/** How a target builds: the triple to add, the Tauri CLI's arguments, and where its files land. */
export function buildPlan(version, target) {
  requireTarget(target);
  if (ANDROID[target]) {
    const { triple, tauriTarget, apk } = ANDROID[target];
    return {
      kind: 'android',
      triple,
      args: ['android', 'build', '--apk', '--target', tauriTarget, '--ci'],
      files: [{ from: apk, to: assetName(version, target) }],
    };
  }
  const desktop = DESKTOP[target];
  const bundle = `src-tauri/target/${desktop.triple}/release/bundle`;
  const installer = `${bundle}/${desktop.installer(version)}`;
  const update = `${bundle}/${desktop.update(version)}`;
  const names = updateAssetNames(version, target);
  const files = [{ from: installer, to: assetName(version, target) }];
  if (update !== installer) files.push({ from: update, to: names.file });
  files.push({ from: `${update}.sig`, to: names.signature });
  return {
    kind: 'desktop',
    triple: desktop.triple,
    args: [
      'build',
      '--target',
      desktop.triple,
      '--bundles',
      desktop.bundles,
      '--config',
      'src-tauri/tauri.updater.conf.json',
      '--ci',
    ],
    files,
    // The update and the file its signature is of
    signed: { file: update, signature: `${update}.sig` },
  };
}

// ── The update feed ─────────────────────────────────────────────────────────

/** The file the app reads, in the latest GitHub release. */
export const UPDATE_MANIFEST = 'latest.json';

/** Where a release's files download from. */
export function releaseDownloadUrl(repository, version) {
  return `https://github.com/${repository}/releases/download/v${version}`;
}

/**
 * latest.json: the version, its notes and date, and for each desktop target
 * its update's address and signature (`signatures`: the .sig files' text, by
 * target). `changelog` carries every release's section, so that an app
 * several releases behind can show what each one brought. The desktop
 * updater reads only the rest. A phone reads `version` and the notes
 * (src-tauri/src/updates.rs) and downloads its APK from the release.
 */
export function updateManifest({ version, notes, changelog, pubDate, downloadUrl, signatures }) {
  const platforms = {};
  for (const target of DESKTOP_TARGETS) {
    const signature = signatures[target]?.trim();
    if (!signature) throw new Error(`There's no update signature for ${target}`);
    const { file } = updateAssetNames(version, target);
    platforms[DESKTOP[target].platform] = { signature, url: `${downloadUrl}/${encodeURIComponent(file)}` };
  }
  return { version, notes, changelog, pub_date: pubDate, platforms };
}

// Minisign, as the updater checks it. A public key is "Ed", its 8-byte key
// id and the Ed25519 key. A signature is its algorithm ("ED" signs the
// file's BLAKE2b-512 hash, "Ed" signs the file itself), the key id and the
// signature, then a trusted comment and a signature over both. Tauri
// base64-encodes each file.

/** A base64-encoded minisign file's lines. */
const minisignLines = text => Buffer.from(text.trim(), 'base64').toString('utf8').trimEnd().split('\n');

/** How minisign shows a key id. */
const keyId = bytes => Buffer.from(bytes).reverse().toString('hex').toUpperCase();

/**
 * Checks that `signature` (a .sig file's text) signs `data` with
 * `publicKey` (plugins.updater.pubkey), as the app does before it installs
 * an update. Throws saying what's wrong.
 */
export function verifyUpdateSignature({ publicKey, signature, data }) {
  const key = Buffer.from(minisignLines(publicKey)[1] ?? '', 'base64');
  if (key.length !== 42 || key.toString('latin1', 0, 2) !== 'Ed') {
    throw new Error("The app's updater public key (plugins.updater.pubkey) isn't a minisign public key");
  }
  const [, signed = '', trusted = '', global = ''] = minisignLines(signature);
  const signatureBytes = Buffer.from(signed, 'base64');
  const algorithm = signatureBytes.toString('latin1', 0, 2);
  if (signatureBytes.length !== 74 || (algorithm !== 'ED' && algorithm !== 'Ed')) {
    throw new Error("The update's signature isn't a minisign signature");
  }
  const signedBy = keyId(signatureBytes.subarray(2, 10));
  const trustedKey = keyId(key.subarray(2, 10));
  if (signedBy !== trustedKey) {
    throw new Error(`The update is signed with key ${signedBy}, but the app trusts key ${trustedKey}`);
  }
  const ed25519 = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: key.subarray(10).toString('base64url') },
    format: 'jwk',
  });
  const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  if (!verify(null, message, ed25519, signatureBytes.subarray(10))) {
    throw new Error("The update's signature doesn't match the file");
  }
  const comment = Buffer.from(trusted.replace(/^trusted comment: /, ''));
  if (!verify(null, Buffer.concat([signatureBytes.subarray(10), comment]), ed25519, Buffer.from(global, 'base64'))) {
    throw new Error("The update signature's trusted comment doesn't match it");
  }
}

// ── The APK ─────────────────────────────────────────────────────────────────
// Android installs an APK over the app only when both are signed with the
// same key, so every release is signed with the release key (the README's
// "Android signing").

/**
 * Checks that `apksigner verify --print-certs` (its `output`) found exactly
 * one signer, with the certificate whose SHA-256 is `digest`. Throws saying
 * what's wrong.
 *
 * Build-Tools 36 and earlier print "Signer #1 certificate SHA-256 digest: …".
 * 37 prints the strongest scheme it verified instead, and numbers the
 * signers only when there's more than one ("V2 Signer: certificate SHA-256
 * digest: …"). Both are read the same way here.
 */
export function verifyApkSigner({ output, digest }) {
  const signerLine = /^(?:V[\d.]+ Signer(?: #\d+)?:|Signer #\d+) certificate SHA-256 digest: ([0-9a-f]+)\s*$/gim;
  const found = [...output.matchAll(signerLine)].map(match => match[1].toLowerCase());
  if (found.length === 0) throw new Error('apksigner found no signer in the APK');
  if (found.length > 1) throw new Error(`The APK has ${found.length} signers; a release has one`);
  if (found[0] !== digest.toLowerCase()) {
    throw new Error(`The APK is signed with certificate ${found[0]}, but releases are signed with ${digest}`);
  }
}

/**
 * Checks that `aapt2 dump badging` (its `output`) names the package `name`
 * at versionName `version`, as AppUpdate.kt checks the APK it downloads.
 * Throws saying what's wrong.
 */
export function verifyApkPackage({ output, name, version }) {
  const line = /^package: (.*)$/m.exec(output)?.[1];
  const found = line && /name='([^']+)'/.exec(line)?.[1];
  if (!found) throw new Error('aapt2 found no package name in the APK');
  if (found !== name) throw new Error(`The APK is ${found}, but a release is ${name}`);
  const versionName = /versionName='([^']*)'/.exec(line)?.[1];
  if (versionName !== version) {
    throw new Error(`The APK is version ${versionName ?? '(none)'}, but this release is ${version}`);
  }
}
