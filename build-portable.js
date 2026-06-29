#!/usr/bin/env node
// 手工打包便携版 Electron 应用 — 绕过 electron-builder 的网络下载
// 用法: node build-portable.js  → 产物在 dist/ADB Tool/

const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')
const OUT = path.join(ROOT, 'dist', 'ADB Tool')
const APP_NAME = 'ADB Tool.exe'

const APP_FILES = ['main.js', 'preload.js', 'renderer.js', 'index.html',
                   'default-commands.json', 'package.json']

function copyRecursive(src, dst) {
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const f of fs.readdirSync(src)) copyRecursive(path.join(src, f), path.join(dst, f))
  } else {
    fs.copyFileSync(src, dst)
  }
}

function rmRecursive(p) {
  if (!fs.existsSync(p)) return
  fs.rmSync(p, { recursive: true, force: true })
}

console.log('清理输出目录...')
rmRecursive(OUT)
fs.mkdirSync(OUT, { recursive: true })

console.log('复制 Electron 运行时...')
copyRecursive(ELECTRON_DIST, OUT)

// 删默认欢迎 app,Electron 会优先加载它
const defaultApp = path.join(OUT, 'resources', 'default_app.asar')
if (fs.existsSync(defaultApp)) fs.unlinkSync(defaultApp)

console.log('重命名 electron.exe → ' + APP_NAME)
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, APP_NAME))

console.log('写入应用代码 resources/app/...')
const appDir = path.join(OUT, 'resources', 'app')
fs.mkdirSync(appDir, { recursive: true })
for (const f of APP_FILES) copyRecursive(path.join(ROOT, f), path.join(appDir, f))

console.log('复制 adb 到 resources/adb/...')
copyRecursive(path.join(ROOT, 'adb'), path.join(OUT, 'resources', 'adb'))

// 大小统计
function dirSize(p) {
  let total = 0
  for (const f of fs.readdirSync(p, { withFileTypes: true })) {
    const fp = path.join(p, f.name)
    total += f.isDirectory() ? dirSize(fp) : fs.statSync(fp).size
  }
  return total
}
const mb = (dirSize(OUT) / 1024 / 1024).toFixed(1)
console.log(`\n✓ 完成: ${OUT}`)
console.log(`  大小: ${mb} MB`)
console.log(`  入口: ${path.join(OUT, APP_NAME)}`)
console.log(`\n打包 zip 给同事:  右键 dist\\ADB Tool 文件夹 → 发送到 → 压缩文件夹`)
