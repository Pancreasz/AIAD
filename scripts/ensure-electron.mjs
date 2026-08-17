// Repairs a half-installed Electron binary.
//
// On some Windows setups the `extract-zip` library that Electron's own
// postinstall uses fails silently: the ~136 MB release zip downloads fine into
// the @electron/get cache, but only `dist/locales` gets unpacked, leaving no
// `electron.exe` and no `path.txt`. electron-vite then aborts with
// "Error: Electron uninstall".
//
// This script runs after `npm install` (via the root `postinstall`). If the
// binary is already present it does nothing. Otherwise it finds the cached zip
// and re-extracts it with the OS archiver (`tar`, then `unzip`, then
// PowerShell), which unpacks reliably where the JS extractor did not.

import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'

const require = createRequire(import.meta.url)
const ELECTRON_DIR = path.dirname(require.resolve('electron/package.json'))
const { version } = require('electron/package.json')

const platform = process.platform
const arch = process.arch

function platformPath() {
  switch (platform) {
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'win32':
      return 'electron.exe'
    default:
      return 'electron'
  }
}

const BIN = platformPath()
const DIST = path.join(ELECTRON_DIR, 'dist')

function isInstalled() {
  try {
    if (fs.readFileSync(path.join(ELECTRON_DIR, 'path.txt'), 'utf-8') !== BIN) return false
    return fs.existsSync(path.join(DIST, BIN))
  } catch {
    return false
  }
}

function cacheRoots() {
  const home = os.homedir()
  const roots = []
  if (platform === 'win32') {
    roots.push(path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'electron', 'Cache'))
  } else if (platform === 'darwin') {
    roots.push(path.join(home, 'Library', 'Caches', 'electron'))
  } else {
    roots.push(path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'electron'))
  }
  if (process.env.electron_config_cache) roots.unshift(process.env.electron_config_cache)
  return roots
}

function findCachedZip() {
  const zipName = `electron-v${version}-${platform}-${arch}.zip`
  for (const root of cacheRoots()) {
    if (!fs.existsSync(root)) continue
    // Cache layout is <root>/<sha256>/<zipName>
    for (const entry of fs.readdirSync(root)) {
      const candidate = path.join(root, entry, zipName)
      if (fs.existsSync(candidate)) return candidate
    }
    const direct = path.join(root, zipName)
    if (fs.existsSync(direct)) return direct
  }
  return null
}

function extract(zip) {
  const attempts =
    platform === 'win32'
      ? [
          ['tar', ['-xf', zip, '-C', DIST]],
          ['unzip', ['-q', '-o', zip, '-d', DIST]],
          [
            'powershell',
            ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${DIST}' -Force`]
          ]
        ]
      : [
          ['unzip', ['-q', '-o', zip, '-d', DIST]],
          ['tar', ['-xf', zip, '-C', DIST]]
        ]

  for (const [cmd, args] of attempts) {
    const res = spawnSync(cmd, args, { stdio: 'ignore' })
    if (!res.error && res.status === 0 && fs.existsSync(path.join(DIST, BIN))) return cmd
  }
  return null
}

function main() {
  if (isInstalled()) return

  let zip = findCachedZip()
  if (!zip) {
    // Populate the cache via Electron's own installer (its download half works;
    // only its extraction is broken), then look again.
    spawnSync(process.execPath, [path.join(ELECTRON_DIR, 'install.js')], { stdio: 'ignore' })
    zip = findCachedZip()
  }
  if (!zip) {
    console.warn(
      `[ensure-electron] No cached Electron ${version} zip found and download did not produce one. ` +
        `Check your network/proxy, then re-run \`npm install\`.`
    )
    return
  }

  fs.rmSync(DIST, { recursive: true, force: true })
  fs.mkdirSync(DIST, { recursive: true })

  const used = extract(zip)
  if (!used) {
    console.error(`[ensure-electron] Failed to extract ${zip} into ${DIST}.`)
    process.exit(1)
  }

  // Mirror Electron's installer: hoist the type defs and write path.txt.
  const srcTypeDef = path.join(DIST, 'electron.d.ts')
  if (fs.existsSync(srcTypeDef)) fs.renameSync(srcTypeDef, path.join(ELECTRON_DIR, 'electron.d.ts'))
  fs.writeFileSync(path.join(ELECTRON_DIR, 'path.txt'), BIN)

  console.log(`[ensure-electron] Repaired Electron ${version} binary via \`${used}\` (${BIN}).`)
}

main()
