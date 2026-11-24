import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  DESKTOP_TARGETS,
  TARGETS,
  assetName,
  bumpVersion,
  buildPlan,
  cargoTomlName,
  cargoTomlVersion,
  changelogVersions,
  extractSection,
  isVersion,
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
} from './lib.mjs';

describe('versions', () => {
  it('bumps each level', () => {
    assert.equal(bumpVersion('0.1.9', 'patch'), '0.1.10');
    assert.equal(bumpVersion('0.1.9', 'minor'), '0.2.0');
    assert.equal(bumpVersion('0.1.9', 'major'), '1.0.0');
  });

  it('refuses what it can’t bump', () => {
    assert.throws(() => bumpVersion('0.1', 'patch'), /isn't a version/);
    assert.throws(() => bumpVersion('0.1.0', 'huge'), /isn't one of patch, minor, major/);
    assert.equal(isVersion('0.1.0'), true);
    assert.equal(isVersion('v0.1.0'), false);
  });
});

describe('the CHANGELOG', () => {
  const changelog = [
    '# Changelog',
    '',
    'Intro.',
    '',
    '## Unreleased',
    '',
    '### Added',
    '- Updates',
    '',
    '## 0.1.0 – 2026-11-23',
    '',
    '- First',
    '',
  ].join('\n');

  it('makes Unreleased the new version’s section', () => {
    const released = releaseUnreleased(changelog, '0.2.0', '2026-11-24');
    assert.match(released, /^## 0\.2\.0 – 2026-11-24$/m);
    assert.doesNotMatch(released, /Unreleased/);
    assert.deepEqual(changelogVersions(released), ['0.2.0', '0.1.0']);
    assert.equal(extractSection(released, '0.2.0'), '### Added\n- Updates');
    assert.equal(extractSection(released, '0.1.0'), '- First');
    assert.equal(extractSection(released, '0.3.0'), null);
  });

  it('refuses a release with nothing unreleased, or one that exists', () => {
    assert.throws(() => releaseUnreleased(changelog, '0.1.0', 'x'), /already has 0\.1\.0/);
    assert.throws(() => releaseUnreleased('## 0.1.0\n\n- First\n', '0.2.0', 'x'), /no "## Unreleased"/);
    assert.throws(
      () => releaseUnreleased('## Unreleased\n\n## 0.1.0\n\n- First\n', '0.2.0', 'x'),
      /"## Unreleased" section is empty/
    );
  });

  it('gives the feed the released sections, newest first, without Unreleased', () => {
    assert.equal(releaseSections(changelog), '## 0.1.0 – 2026-11-23\n\n- First');
    const released = releaseUnreleased(changelog, '0.2.0', '2026-11-24');
    assert.equal(
      releaseSections(released),
      '## 0.2.0 – 2026-11-24\n\n### Added\n- Updates\n\n## 0.1.0 – 2026-11-23\n\n- First'
    );
    assert.equal(releaseSections(released, 1), '## 0.2.0 – 2026-11-24\n\n### Added\n- Updates');
    assert.equal(releaseSections('# Changelog\n'), '');
  });

  it('has a releasable Unreleased section in the repository', () => {
    const real = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
    assert.ok(changelogVersions(real).includes('0.1.0'));
  });
});

describe('manifests', () => {
  it('sets package.json’s version and keeps the rest', () => {
    const text = '{\n  "name": "roku-remote",\n  "version": "0.1.0",\n  "private": true\n}\n';
    assert.equal(packageJsonVersion(text, 'package.json'), '0.1.0');
    assert.equal(
      setPackageJsonVersion(text, '0.2.0', 'package.json'),
      '{\n  "name": "roku-remote",\n  "version": "0.2.0",\n  "private": true\n}\n'
    );
    assert.throws(() => packageJsonVersion('{}', 'x.json'), /x\.json: no "version"/);
  });

  it('sets only the [package] version in Cargo.toml', () => {
    const text = '[package]\nname = "roku-controller"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1" }\n';
    assert.equal(cargoTomlName(text, 'Cargo.toml'), 'roku-controller');
    assert.equal(cargoTomlVersion(text, 'Cargo.toml'), '0.1.0');
    assert.equal(
      setCargoTomlVersion(text, '0.2.0', 'Cargo.toml'),
      '[package]\nname = "roku-controller"\nversion = "0.2.0"\n\n[dependencies]\nserde = { version = "1" }\n'
    );
  });

  it('sets the crate’s entry in Cargo.lock', () => {
    const lock =
      '[[package]]\nname = "roku"\nversion = "0.2.0"\n\n[[package]]\nname = "roku-controller"\nversion = "0.1.0"\n';
    assert.equal(
      setCargoLockVersion(lock, 'roku-controller', '0.3.0'),
      '[[package]]\nname = "roku"\nversion = "0.2.0"\n\n[[package]]\nname = "roku-controller"\nversion = "0.3.0"\n'
    );
    assert.throws(() => setCargoLockVersion(lock, 'missing', '0.3.0'), /lists missing 0 times/);
  });

  it('reads the repository’s own manifests', () => {
    const cargo = readFileSync(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8');
    const pkg = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const conf = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    assert.equal(cargoTomlVersion(cargo, 'Cargo.toml'), packageJsonVersion(pkg, 'package.json'));
    // The app's version is package.json's, so a release bumps it once
    assert.equal(conf.version, '../package.json');
    assert.equal(conf.productName, 'Roku Remote');
  });
});

describe('what a release ships', () => {
  it('names every file', () => {
    assert.deepEqual(releaseAssets('0.2.0'), [
      'RokuRemote-0.2.0-macos-arm64.dmg',
      'RokuRemote-0.2.0-macos-x64.dmg',
      'RokuRemote-0.2.0-windows-x64-setup.exe',
      'RokuRemote-0.2.0-android-arm64.apk',
      'RokuRemote-0.2.0-macos-arm64.app.tar.gz',
      'RokuRemote-0.2.0-macos-arm64.app.tar.gz.sig',
      'RokuRemote-0.2.0-macos-x64.app.tar.gz',
      'RokuRemote-0.2.0-macos-x64.app.tar.gz.sig',
      'RokuRemote-0.2.0-windows-x64-setup.exe.sig',
    ]);
    assert.deepEqual(missingAssets('0.2.0', releaseAssets('0.2.0').slice(1)), ['RokuRemote-0.2.0-macos-arm64.dmg']);
    assert.throws(() => assetName('0.2.0', 'linux-x64'), /Unknown target "linux-x64"/);
    assert.throws(() => updateAssetNames('0.2.0', 'android-arm64'), /has no desktop update/);
  });

  it('names the APK the way the app downloads it', () => {
    // updates.rs's apk_url and UpdateRelease.kt build this same name
    assert.equal(assetName('0.2.0', 'android-arm64'), 'RokuRemote-0.2.0-android-arm64.apk');
  });

  it('builds macOS with its app bundle, for the update', () => {
    const plan = buildPlan('0.2.0', 'macos-x64');
    assert.equal(plan.kind, 'desktop');
    assert.deepEqual(plan.args, [
      'build',
      '--target',
      'x86_64-apple-darwin',
      '--bundles',
      'app,dmg',
      '--config',
      'src-tauri/tauri.updater.conf.json',
      '--ci',
    ]);
    const bundle = 'src-tauri/target/x86_64-apple-darwin/release/bundle';
    assert.deepEqual(plan.files, [
      { from: `${bundle}/dmg/Roku Remote_0.2.0_x64.dmg`, to: 'RokuRemote-0.2.0-macos-x64.dmg' },
      { from: `${bundle}/macos/Roku Remote.app.tar.gz`, to: 'RokuRemote-0.2.0-macos-x64.app.tar.gz' },
      { from: `${bundle}/macos/Roku Remote.app.tar.gz.sig`, to: 'RokuRemote-0.2.0-macos-x64.app.tar.gz.sig' },
    ]);
    assert.deepEqual(plan.signed, {
      file: `${bundle}/macos/Roku Remote.app.tar.gz`,
      signature: `${bundle}/macos/Roku Remote.app.tar.gz.sig`,
    });
  });

  it('ships Windows’ installer as its own update', () => {
    const plan = buildPlan('0.2.0', 'windows-x64');
    const bundle = 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis';
    assert.ok(plan.args.includes('nsis'));
    assert.deepEqual(plan.files, [
      { from: `${bundle}/Roku Remote_0.2.0_x64-setup.exe`, to: 'RokuRemote-0.2.0-windows-x64-setup.exe' },
      { from: `${bundle}/Roku Remote_0.2.0_x64-setup.exe.sig`, to: 'RokuRemote-0.2.0-windows-x64-setup.exe.sig' },
    ]);
  });

  it('builds an arm64 APK', () => {
    const plan = buildPlan('0.2.0', 'android-arm64');
    assert.equal(plan.kind, 'android');
    assert.deepEqual(plan.args, ['android', 'build', '--apk', '--target', 'aarch64', '--ci']);
    assert.deepEqual(plan.files, [
      {
        from: 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk',
        to: 'RokuRemote-0.2.0-android-arm64.apk',
      },
    ]);
  });

  it('builds every target', () => {
    assert.deepEqual(TARGETS, ['macos-arm64', 'macos-x64', 'windows-x64', 'android-arm64']);
    for (const target of TARGETS) assert.ok(buildPlan('0.2.0', target).files.length > 0);
  });
});

describe('latest.json', () => {
  const signatures = Object.fromEntries(DESKTOP_TARGETS.map(target => [target, `sig-${target}\n`]));

  it('lists each desktop update with its signature', () => {
    const manifest = updateManifest({
      version: '0.2.0',
      notes: '- Updates',
      changelog: '## 0.2.0\n\n- Updates',
      pubDate: '2026-11-24T10:00:00Z',
      downloadUrl: releaseDownloadUrl('BeardedUnicorn/MineRoku', '0.2.0'),
      signatures,
    });
    const base = 'https://github.com/BeardedUnicorn/MineRoku/releases/download/v0.2.0';
    assert.deepEqual(manifest, {
      version: '0.2.0',
      notes: '- Updates',
      changelog: '## 0.2.0\n\n- Updates',
      pub_date: '2026-11-24T10:00:00Z',
      platforms: {
        'darwin-aarch64': { signature: 'sig-macos-arm64', url: `${base}/RokuRemote-0.2.0-macos-arm64.app.tar.gz` },
        'darwin-x86_64': { signature: 'sig-macos-x64', url: `${base}/RokuRemote-0.2.0-macos-x64.app.tar.gz` },
        'windows-x86_64': { signature: 'sig-windows-x64', url: `${base}/RokuRemote-0.2.0-windows-x64-setup.exe` },
      },
    });
  });

  it('refuses a manifest with an update unsigned', () => {
    assert.throws(
      () =>
        updateManifest({
          version: '0.2.0',
          notes: '',
          changelog: '',
          pubDate: 'x',
          downloadUrl: 'x',
          signatures: { ...signatures, 'windows-x64': ' ' },
        }),
      /no update signature for windows-x64/
    );
  });
});

describe('update signatures', () => {
  // `tauri signer generate`'s public key, and `tauri signer sign` of "hello"
  // (a throwaway key, made for this test; from TaskMint's tests)
  const tauriKey =
    'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDk1QjVGMDdCMzk5NzcxNjgKUldSb2NaYzVlL0MxbFdZV1dGK01PVFhlMDhtVm55dDlRTUtjVDh0NzltMjZ3ZDdZY25DNHVIZ3gK';
  const tauriSignature =
    'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSb2NaYzVlL0MxbFZYckVSTldqZ2FrbkFGbmxKTTBpWmxaeFdKU21oZEU0UjR1Sm9jTGxQWkI4a0ZyYnNjUHhEc3h1ZXY5WDFrRmI4blByM1RFMUpZYmZCMHBRWnd2Q3djPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0MTA4ODQ2CWZpbGU6aGVsbG8udHh0Ci9PTGprVUh6ejZBOU1NU0c3TDFaMGVvL2VQYmRDc21VTDlEaGZlaXMwMDhWSVQxWTRRcTVSeUdwNFFXK0FpMmtKTU5CRVNhNXFGdUJOUzZvQ3laWUNnPT0K';

  /** A minisign key of our own, so the test can make any signature. */
  function keyPair(id = Buffer.from('0123456789abcdef', 'hex')) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
    const file = `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), id, raw]).toString('base64')}\n`;
    const signFile = (data, { algorithm = 'ED', comment = 'timestamp:1\tfile:x', tamper = false } = {}) => {
      const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
      const signature = sign(null, message, privateKey);
      const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
      const trusted = tamper ? `${comment}x` : comment;
      const lines = [
        'untrusted comment: signature',
        Buffer.concat([Buffer.from(algorithm), id, signature]).toString('base64'),
        `trusted comment: ${trusted}`,
        global.toString('base64'),
      ];
      return Buffer.from(`${lines.join('\n')}\n`).toString('base64');
    };
    return { publicKey: Buffer.from(file).toString('base64'), signFile };
  }

  const data = Buffer.from('the update');

  it("accepts Tauri's own signature", () => {
    verifyUpdateSignature({ publicKey: tauriKey, signature: tauriSignature, data: Buffer.from('hello') });
    assert.throws(
      () => verifyUpdateSignature({ publicKey: tauriKey, signature: tauriSignature, data: Buffer.from('hellO') }),
      /The update's signature doesn't match the file/
    );
  });

  it('accepts a signature of the file or of its hash, by the trusted key', () => {
    const { publicKey, signFile } = keyPair();
    verifyUpdateSignature({ publicKey, signature: signFile(data), data });
    verifyUpdateSignature({ publicKey, signature: signFile(data, { algorithm: 'Ed' }), data });
  });

  it('names the key an update was signed with when the app trusts another', () => {
    const { signFile } = keyPair(Buffer.from('1111111111111111', 'hex'));
    assert.throws(
      () => verifyUpdateSignature({ publicKey: tauriKey, signature: signFile(data), data }),
      /The update is signed with key 1111111111111111, but the app trusts key 95B5F07B39977168/
    );
  });

  it('refuses a changed trusted comment', () => {
    const { publicKey, signFile } = keyPair();
    assert.throws(
      () => verifyUpdateSignature({ publicKey, signature: signFile(data, { tamper: true }), data }),
      /trusted comment doesn't match/
    );
  });

  it("refuses a key or signature that isn't minisign's", () => {
    const { publicKey, signFile } = keyPair();
    for (const key of ['PUBKEY_PENDING', '', Buffer.from('a\nb').toString('base64')]) {
      assert.throws(
        () => verifyUpdateSignature({ publicKey: key, signature: signFile(data), data }),
        /isn't a minisign public key/
      );
    }
    for (const signature of ['', Buffer.from('a\nRVg=\n').toString('base64'), signFile(data, { algorithm: 'XX' })]) {
      assert.throws(() => verifyUpdateSignature({ publicKey, signature, data }), /isn't a minisign signature/);
    }
  });

  it('is what the app trusts: tauri.conf.json’s key is a minisign key', () => {
    const conf = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const { signFile } = keyPair();
    // A real key gets as far as the key id check; a placeholder stops before it
    assert.throws(
      () => verifyUpdateSignature({ publicKey: conf.plugins.updater.pubkey, signature: signFile(data), data }),
      /but the app trusts key/
    );
  });
});

describe('the APK', () => {
  const digest = '827565d25b4ae02c31995427871bbf00ae3c8c03e9c0f2b078e14ed238222f2e';
  const other = 'a'.repeat(64);
  const lines = (prefix, sha256) =>
    [
      `${prefix} DN: CN=Android Debug, O=Android, C=US`,
      `${prefix} SHA-256 digest: ${sha256}`,
      `${prefix} SHA-1 digest: ${'b'.repeat(40)}`,
    ].join('\n');
  const signer = (n, sha256) => lines(`Signer #${n} certificate`, sha256);
  const schemeSigner = (scheme, n, sha256) => lines(`${scheme} Signer${n ? ` #${n}` : ''}: certificate`, sha256);

  it('accepts the one signer with the release certificate', () => {
    assert.doesNotThrow(() => verifyApkSigner({ output: `Verifies\n${signer(1, digest)}\n`, digest }));
    assert.doesNotThrow(() => verifyApkSigner({ output: schemeSigner('V2', 0, digest), digest }));
    assert.doesNotThrow(() => verifyApkSigner({ output: signer(1, digest), digest: digest.toUpperCase() }));
  });

  it('refuses another key, no signer, or more than one', () => {
    assert.throws(
      () => verifyApkSigner({ output: schemeSigner('V2', 0, other), digest }),
      new RegExp(`The APK is signed with certificate ${other}, but releases are signed with ${digest}`)
    );
    assert.throws(() => verifyApkSigner({ output: 'Verifies\n', digest }), /apksigner found no signer/);
    assert.throws(
      () => verifyApkSigner({ output: `${schemeSigner('V2', 1, digest)}\n${schemeSigner('V2', 2, other)}`, digest }),
      /The APK has 2 signers; a release has one/
    );
  });

  it('checks the package and its version', () => {
    const badging = version =>
      `package: name='com.rokucontroller.remote' versionCode='2000' versionName='${version}' platformBuildVersionName='17'\nminSdkVersion:'24'\n`;
    const name = 'com.rokucontroller.remote';
    assert.doesNotThrow(() => verifyApkPackage({ output: badging('0.2.0'), name, version: '0.2.0' }));
    assert.throws(
      () => verifyApkPackage({ output: badging('0.1.0'), name, version: '0.2.0' }),
      /The APK is version 0\.1\.0, but this release is 0\.2\.0/
    );
    assert.throws(
      () => verifyApkPackage({ output: badging('0.2.0'), name: 'com.other', version: '0.2.0' }),
      /The APK is com\.rokucontroller\.remote, but a release is com\.other/
    );
    assert.throws(() => verifyApkPackage({ output: '', name, version: '0.2.0' }), /no package name/);
  });
});
