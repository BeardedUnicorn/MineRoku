#!/usr/bin/env node
/**
 * Cuts, builds and publishes Roku Remote releases (modeled on TaskMint's).
 * The pure parts are in release/lib.mjs.
 *
 *   pnpm release <patch|minor|major> [--dry-run]
 *     On a clean main: bumps the version in package.json (tauri.conf.json
 *     reads it from there), src-tauri/Cargo.toml and Cargo.lock, makes
 *     CHANGELOG.md's "## Unreleased" that version's section, then commits
 *     "Release X.Y.Z" and tags vX.Y.Z. Nothing is pushed.
 *
 *   pnpm release publish
 *     Pushes main and the current version's tag. The tag starts the Release
 *     workflow, which builds everything and publishes the GitHub release.
 *
 *   node scripts/release.mjs build --target <target>
 *     (The Release workflow's build step.) Builds one target into releases/:
 *     macos-arm64, macos-x64, windows-x64 or android-arm64. A desktop build
 *     needs TAURI_SIGNING_PRIVATE_KEY to sign its update, and checks the
 *     signature against plugins.updater.pubkey. The APK needs the release
 *     key in src-tauri/gen/android/keystore.properties, and its signer is
 *     checked against ANDROID_SIGNER_SHA256.
 *
 *   node scripts/release.mjs github-release
 *     (The Release workflow's last step.) Writes latest.json from releases/
 *     and the CHANGELOG, then creates the GitHub release for the checked-out
 *     tag with every file. If the release already exists, it replaces the
 *     release's files.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUMPS,
  DESKTOP_TARGETS,
  UPDATE_MANIFEST,
  bumpVersion,
  buildPlan,
  cargoTomlName,
  extractSection,
  isTarget,
  isoDate,
  missingAssets,
  packageJsonVersion,
  releaseAssets,
  releaseDownloadUrl,
  releaseSections,
  releaseUnreleased,
  setCargoLockVersion,
  setCargoTomlVersion,
  setPackageJsonVersion,
  updateAssetNames,
  updateManifest,
  verifyApkPackage,
  verifyApkSigner,
  verifyUpdateSignature,
} from './release/lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGE_JSON = 'package.json';
const CARGO_TOML = 'src-tauri/Cargo.toml';
const CARGO_LOCK = 'src-tauri/Cargo.lock';
const CHANGELOG = 'CHANGELOG.md';
const TAURI_CONF = 'src-tauri/tauri.conf.json';
const RELEASES = 'releases';
const ANDROID_PROJECT = 'src-tauri/gen/android';
const ANDROID_PACKAGE = 'com.rokucontroller.remote';

/**
 * The SHA-256 of the certificate every release APK is signed with: the key
 * that signed v0.1.0 (CN=Android Debug, from keystore.p12). An APK signed
 * with any other key wouldn't install over the app, so the build refuses
 * to ship one.
 */
const ANDROID_SIGNER_SHA256 = '827565d25b4ae02c31995427871bbf00ae3c8c03e9c0f2b078e14ed238222f2e';

const USAGE = `Usage:
  pnpm release <${BUMPS.join('|')}> [--dry-run]   bump, CHANGELOG, commit and tag
  pnpm release publish                       push main and the tag (CI builds and publishes)
  node scripts/release.mjs build --target <macos-arm64|macos-x64|windows-x64|android-arm64>
  node scripts/release.mjs github-release    (CI) latest.json and the GitHub release`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function stop(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/** Runs `fn`, stopping with its error's message rather than a stack. */
function checked(fn) {
  try {
    return fn();
  } catch (error) {
    stop(error.message);
  }
}

const read = file => readFileSync(join(root, file), 'utf8');
const write = (file, text) => writeFileSync(join(root, file), text);

/** Runs a command in the repository, showing its output; stops if it fails. */
function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    // pnpm is pnpm.cmd on Windows
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) stop(`${command}: ${result.error.message}`);
  if (result.status !== 0) stop(`${command} ${args.join(' ')} failed (exit ${result.status}).`);
}

/** A command's output, trimmed; stops if it fails. */
function output(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) stop(`${command}: ${result.error.message}`);
  if (result.status !== 0) stop(`${command} ${args.join(' ')} failed:\n${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

const git = (...args) => output('git', args);
const succeeds = (command, args) => spawnSync(command, args, { cwd: root, stdio: 'ignore' }).status === 0;

const currentVersion = () => checked(() => packageJsonVersion(read(PACKAGE_JSON), PACKAGE_JSON));
const tagOf = version => `v${version}`;

// ── pnpm release <bump> ─────────────────────────────────────────────────────

function requireMainAndClean() {
  const branch = git('branch', '--show-current');
  if (branch !== 'main') stop(`Releases are cut on main (this is ${branch || 'a detached HEAD'}).`);
  const status = git('status', '--porcelain');
  if (status) stop(`Commit or set aside these changes first:\n${status}`);
}

function cut(bump, { dryRun }) {
  const current = currentVersion();
  const version = checked(() => bumpVersion(current, bump));
  const changelog = checked(() => releaseUnreleased(read(CHANGELOG), version, isoDate(new Date())));
  const crate = checked(() => cargoTomlName(read(CARGO_TOML), CARGO_TOML));
  const texts = checked(() => [
    [PACKAGE_JSON, setPackageJsonVersion(read(PACKAGE_JSON), version, PACKAGE_JSON)],
    [CARGO_TOML, setCargoTomlVersion(read(CARGO_TOML), version, CARGO_TOML)],
    [CARGO_LOCK, setCargoLockVersion(read(CARGO_LOCK), crate, version)],
    [CHANGELOG, changelog],
  ]);

  console.log(`${current} → ${version}\n\n## ${version}\n\n${extractSection(changelog, version)}`);
  if (dryRun) {
    console.log('\n(--dry-run: nothing changed)');
    return;
  }
  requireMainAndClean();
  if (succeeds('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tagOf(version)}`])) {
    stop(`The tag ${tagOf(version)} already exists.`);
  }
  for (const [file, text] of texts) write(file, text);
  const paths = texts.map(([file]) => file);
  const commit = spawnSync('git', ['commit', '-m', `Release ${version}`, '--', ...paths], {
    cwd: root,
    stdio: 'inherit',
  });
  if (commit.status !== 0) {
    console.error('\nPutting the version and CHANGELOG back as they were.');
    git('restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths);
    stop('The release commit failed.');
  }
  git('tag', '-a', tagOf(version), '-m', `Roku Remote ${version}`);
  console.log(`\nCommitted "Release ${version}" and tagged ${tagOf(version)}. Next: pnpm release publish`);
}

function publish() {
  const tag = tagOf(currentVersion());
  if (!succeeds('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) {
    stop(`There's no tag ${tag}: run pnpm release <${BUMPS.join('|')}> first.`);
  }
  run('git', ['push', '--atomic', 'origin', 'main', tag]);
  console.log(`\nPushed ${tag}. The Release workflow builds and publishes it: gh run list --workflow release.yml`);
}

// ── build --target ──────────────────────────────────────────────────────────

/** The newest Build-Tools' `name` (apksigner, aapt2) in the Android SDK. */
function buildTool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) stop("ANDROID_HOME (the Android SDK) isn't set.");
  const dir = join(sdk, 'build-tools');
  const byVersion = (a, b) => b.localeCompare(a, 'en', { numeric: true });
  const versions = existsSync(dir) ? readdirSync(dir).filter(version => /^[\d.]+$/.test(version)) : [];
  const tool = versions
    .sort(byVersion)
    .map(version => join(dir, version, name))
    .find(path => existsSync(path));
  if (!tool) stop(`There's no ${name} in ${dir}: install Build-Tools with the SDK Manager.`);
  return tool;
}

/** Checks the APK is signed with the release key and is this app at this version. */
function checkApk(apk, version) {
  const signer = spawnSync(buildTool('apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8' });
  if (signer.error) stop(`apksigner: ${signer.error.message}`);
  if (signer.status !== 0) {
    stop(`apksigner says the APK isn't signed properly:\n${(signer.stderr || signer.stdout).trim()}`);
  }
  checked(() => verifyApkSigner({ output: signer.stdout, digest: ANDROID_SIGNER_SHA256 }));
  const badging = spawnSync(buildTool('aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' });
  if (badging.error) stop(`aapt2: ${badging.error.message}`);
  checked(() => verifyApkPackage({ output: badging.stdout, name: ANDROID_PACKAGE, version }));
}

function build(target) {
  if (!isTarget(target)) stop(`Unknown target "${target}".\n\n${USAGE}`);
  const version = currentVersion();
  const plan = buildPlan(version, target);

  if (plan.kind === 'desktop' && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
    stop("TAURI_SIGNING_PRIVATE_KEY isn't set, so the update can't be signed (the README's \"Updates\").");
  }
  if (plan.kind === 'android' && !existsSync(join(root, ANDROID_PROJECT, 'keystore.properties'))) {
    stop(`${ANDROID_PROJECT}/keystore.properties isn't there, so the APK can't be signed (the README's "Android signing").`);
  }

  run('rustup', ['target', 'add', plan.triple]);
  // Gradle's incremental packaging can keep bytes from an earlier build
  if (plan.kind === 'android') rmSync(join(root, ANDROID_PROJECT, 'app/build'), { recursive: true, force: true });
  // `pnpm exec`, not the package.json script: that one sets PATH in sh syntax, which Windows' cmd can't run
  run('pnpm', ['exec', 'tauri', ...plan.args]);

  if (plan.kind === 'desktop') {
    const pubkey = JSON.parse(read(TAURI_CONF)).plugins?.updater?.pubkey ?? '';
    const { file, signature } = plan.signed;
    if (!existsSync(join(root, signature))) stop(`The build finished, but ${signature} isn't there.`);
    checked(() =>
      verifyUpdateSignature({
        publicKey: pubkey,
        signature: read(signature),
        data: readFileSync(join(root, file)),
      })
    );
  } else {
    const apk = plan.files[0].from;
    if (!existsSync(join(root, apk))) stop(`The build finished, but ${apk} isn't there.`);
    checkApk(join(root, apk), version);
  }

  mkdirSync(join(root, RELEASES), { recursive: true });
  for (const { from, to } of plan.files) {
    if (!existsSync(join(root, from))) stop(`The build finished, but ${from} isn't there.`);
    copyFileSync(join(root, from), join(root, RELEASES, to));
    console.log(`→ ${RELEASES}/${to}`);
  }
}

// ── github-release ──────────────────────────────────────────────────────────

function writeUpdateManifest(version, notes, changelog) {
  const repository = process.env.GH_REPO;
  if (!repository) stop('GH_REPO (owner/name) says where the release is; the Release workflow sets it.');
  const signatures = Object.fromEntries(
    DESKTOP_TARGETS.map(target => [target, read(join(RELEASES, updateAssetNames(version, target).signature))])
  );
  const manifest = checked(() =>
    updateManifest({
      version,
      notes,
      changelog,
      pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      downloadUrl: releaseDownloadUrl(repository, version),
      signatures,
    })
  );
  const file = join(RELEASES, UPDATE_MANIFEST);
  write(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return join(root, file);
}

function githubRelease() {
  const version = currentVersion();
  const tag = tagOf(version);
  const ref = process.env.GITHUB_REF_NAME;
  if (ref && ref !== tag) stop(`This run is for ${ref}, but package.json says ${version}.`);
  const changelog = read(CHANGELOG);
  const notes = extractSection(changelog, version);
  if (notes === null) stop(`CHANGELOG.md has no ${version} section.`);

  const dir = join(root, RELEASES);
  const missing = missingAssets(version, existsSync(dir) ? readdirSync(dir) : []);
  if (missing.length > 0) stop(`${RELEASES}/ is missing ${missing.join(', ')}.`);
  const files = [
    ...releaseAssets(version).map(file => join(dir, file)),
    writeUpdateManifest(version, notes, releaseSections(changelog)),
  ];

  if (succeeds('gh', ['release', 'view', tag])) {
    run('gh', ['release', 'upload', tag, '--clobber', ...files]);
    return;
  }
  const notesFile = join(tmpdir(), `roku-remote-${version}-notes.md`);
  writeFileSync(notesFile, `${notes}\n`);
  try {
    run('gh', ['release', 'create', tag, '--verify-tag', '--title', `Roku Remote ${version}`, '--notes-file', notesFile, ...files]);
  } finally {
    rmSync(notesFile, { force: true });
  }
}

// ── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const [command] = args;
if (BUMPS.includes(command)) {
  cut(command, { dryRun: args.includes('--dry-run') });
} else if (command === 'publish') {
  publish();
} else if (command === 'build') {
  const at = args.indexOf('--target');
  build(at === -1 ? undefined : args[at + 1]);
} else if (command === 'github-release') {
  githubRelease();
} else {
  stop(USAGE);
}
