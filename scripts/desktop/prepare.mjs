#!/usr/bin/env node
/**
 * Gets everything the desktop app bundles ready in src-tauri:
 *
 * - resources/server: the Aurora server bundled into one file, plus the web
 *   client it serves. It runs exactly as the Docker image does.
 * - binaries/aurora-node-<target>: the official Node.js build the server runs
 *   on (same major as the Docker image), checked against nodejs.org's SHA-256
 *   list. Tauri ships it as a sidecar.
 * - resources/ffmpeg: ffmpeg and ffprobe, with --ffmpeg (Windows only for
 *   now: the LGPL build from BtbN/FFmpeg-Builds, checked against its
 *   checksums). Without them the app uses an ffmpeg installed on the system.
 *
 * Tauri runs this before `tauri build` and `tauri dev`; the target comes from
 * TAURI_ENV_TARGET_TRIPLE, or --target, or the host.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_MAJOR = 24; // keep in step with the Dockerfile

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tauriDir = path.join(root, 'src-tauri');
const cacheDir = path.join(tauriDir, '.cache');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

function hostTarget() {
  const info = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  return /host: (\S+)/.exec(info)?.[1];
}

const target = option('--target') ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTarget();
const windows = target.includes('windows');

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed`);
}

async function download(url, file) {
  if (fs.existsSync(file)) return file;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
  return file;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verify(file, expected) {
  const actual = sha256(file);
  if (!expected || actual !== expected) {
    fs.rmSync(file, { force: true });
    throw new Error(`Checksum mismatch for ${path.basename(file)}`);
  }
}

/** Unpacks an archive into a fresh directory of its own. */
function unpack(archive) {
  const out = `${archive}.unpacked`;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  // Windows' own tar (bsdtar) also unpacks zip files; Git's GNU tar can't.
  const systemTar = 'C:\\Windows\\System32\\tar.exe';
  const tar = process.platform === 'win32' && fs.existsSync(systemTar) ? systemTar : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', out]);
  return out;
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}

async function bundleServer() {
  if (!flag('--skip-web')) {
    // The server build, as in the Docker image (no SPA shell for Capacitor).
    run('npx', ['vite', 'build'], { AURORA_DISABLE_SPA_PRERENDER: 'true' });
  }
  const out = path.join(tauriDir, 'resources', 'server');
  fs.rmSync(out, { recursive: true, force: true });
  const { build } = await import('esbuild');
  await build({
    entryPoints: [path.join(root, 'server.mjs')],
    outfile: path.join(out, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: `node${NODE_MAJOR}`,
    logLevel: 'warning',
    // Some dependencies are CommonJS and call require().
    banner: {
      js: "import { createRequire as __auroraRequire } from 'node:module'; const require = __auroraRequire(import.meta.url);",
    },
  });
  fs.cpSync(path.join(root, 'dist', 'client'), path.join(out, 'dist', 'client'), {
    recursive: true,
  });
  console.log('Bundled the server into src-tauri/resources/server');
}

function nodePlatform() {
  if (target.startsWith('aarch64-apple')) return { name: 'darwin-arm64', ext: 'tar.gz' };
  if (target.startsWith('x86_64-apple')) return { name: 'darwin-x64', ext: 'tar.gz' };
  if (target.startsWith('x86_64-pc-windows')) return { name: 'win-x64', ext: 'zip' };
  if (target.startsWith('aarch64-pc-windows')) return { name: 'win-arm64', ext: 'zip' };
  if (target.startsWith('x86_64-unknown-linux')) return { name: 'linux-x64', ext: 'tar.gz' };
  if (target.startsWith('aarch64-unknown-linux')) return { name: 'linux-arm64', ext: 'tar.gz' };
  throw new Error(`No Node.js build for ${target}`);
}

async function fetchNode() {
  const { name, ext } = nodePlatform();
  const releases = await (await fetch('https://nodejs.org/dist/index.json')).json();
  const version = releases.find((release) => release.version.startsWith(`v${NODE_MAJOR}.`))?.version;
  if (!version) throw new Error(`No Node.js ${NODE_MAJOR} release found`);

  const file = `node-${version}-${name}.${ext}`;
  const sums = await (await fetch(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).text();
  const expected = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, entry]) => entry === file)?.[0];
  const archive = await download(`https://nodejs.org/dist/${version}/${file}`, path.join(cacheDir, file));
  verify(archive, expected);

  const binary = findFile(unpack(archive), windows ? 'node.exe' : 'node');
  if (!binary) throw new Error(`node binary not found in ${file}`);
  const destination = path.join(tauriDir, 'binaries', `aurora-node-${target}${windows ? '.exe' : ''}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(binary, destination);
  fs.chmodSync(destination, 0o755);
  console.log(`Node.js ${version} for ${target} is in src-tauri/binaries`);
}

async function fetchFfmpeg() {
  const out = path.join(tauriDir, 'resources', 'ffmpeg');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, 'README.txt'),
    'ffmpeg and ffprobe bundled with Aurora, when present. Without them Aurora uses an ffmpeg installed on the system.\n',
  );
  if (!flag('--ffmpeg')) return;
  if (!target.startsWith('x86_64-pc-windows')) {
    console.warn(`No bundled ffmpeg for ${target} yet; the app will use the system's ffmpeg.`);
    return;
  }
  const base = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest';
  const file = 'ffmpeg-master-latest-win64-lgpl.zip';
  const sums = await (await fetch(`${base}/checksums.sha256`)).text();
  const expected = sums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, entry]) => entry?.replace(/^\*/, '') === file)?.[0];
  // "latest" moves, so don't trust a cached copy.
  const archive = path.join(cacheDir, file);
  fs.rmSync(archive, { force: true });
  await download(`${base}/${file}`, archive);
  verify(archive, expected);
  const unpacked = unpack(archive);
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
    const binary = findFile(unpacked, name);
    if (!binary) throw new Error(`${name} not found in ${file}`);
    fs.copyFileSync(binary, path.join(out, name));
  }
  const license = findFile(unpacked, 'LICENSE.txt');
  if (license) fs.copyFileSync(license, path.join(out, 'LICENSE.txt'));
  console.log('Bundled ffmpeg (LGPL) into src-tauri/resources/ffmpeg');
}

await bundleServer();
await fetchNode();
await fetchFfmpeg();
