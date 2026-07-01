let config = { groups: [], chains: [] }
let currentGroupId = null
let modalContext = null   // { mode:'cmd'|'group', groupId, cmdId }
let outputCollapsed = false
let outputExpanded = false
let prevOutputH = ''
let currentSerial = null
let knownDevices = []     // 上一次 poll 的结果,缓存用
let autoTimer = null
const failCounts = new Map()   // ip -> consecutive fail count

function defaultAutoConnect() {
  return {
    enabled: false,
    probePort: 8888,
    rangeStart: 101,
    rangeEnd: 115,
    intervalMs: 3000,
    timeoutMs: 300,
    failsBeforeDisconnect: 2,
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  config = await adb.loadConfig()
  if (!config.network) config.network = { subnetPrefix: '192.168.1.', port: 5555 }
  if (!config.network.autoConnect) config.network.autoConnect = defaultAutoConnect()
  render()
  pollDevices()
  setInterval(pollDevices, 4000)
  if (config.network.autoConnect.enabled) startAutoConnect()
})

async function pollDevices() {
  knownDevices = await adb.devices()
  // 当前选中的设备掉了 → 自动取消选中
  if (currentSerial && !knownDevices.find(d => d.serial === currentSerial)) currentSerial = null
  // 没选 → 默认选第一个 online 的
  if (!currentSerial) currentSerial = knownDevices.find(d => d.status === 'device')?.serial || null
  renderDevices()
}

function renderDevices() {
  const wrap = document.getElementById('device-chips')
  const online = knownDevices.filter(d => d.status === 'device').length
  wrap.innerHTML = knownDevices.map(d => {
    const isWifi = /^[\d.]+:\d+$/.test(d.serial)
    const label = deviceLabel(d.serial)
    const cls = ['device-chip', d.status === 'device' ? '' : d.status,
                 d.serial === currentSerial ? 'active' : '',
                 isWifi ? '' : 'no-x'].filter(Boolean).join(' ')
    const x = isWifi
      ? `<button class="chip-x" onclick="event.stopPropagation();disconnectDevice('${esc(d.serial)}')" title="断开">×</button>`
      : ''
    return `<span class="${cls}" title="${esc(d.serial)} (${d.status})"
              onclick="selectDevice('${esc(d.serial)}')">
        <span class="chip-kind">${isWifi ? '📡' : '🔌'}</span>${esc(label)}${x}</span>`
  }).join('') +
  `<button class="btn" id="btn-add-device" onclick="openConnectModal()">+ 连接</button>`

  const st = document.getElementById('device-status')
  st.textContent = online ? `${online} 台在线` : '未检测到设备'
  st.style.color = online ? '#4ec94e' : '#888'
}

function deviceLabel(serial) {
  const prefix = config.network?.subnetPrefix || '192.168.1.'
  // 同网段 IP:port → 只显示末位
  const m = serial.startsWith(prefix) && serial.match(/\.(\d+):\d+$/)
  if (m) return '.' + m[1]
  // 其他网段 IP:port → 显示完整 IP(去 port)
  const m2 = serial.match(/^([\d.]+):\d+$/)
  if (m2) return m2[1]
  // USB serial → 截短
  return serial.length > 10 ? serial.slice(0, 8) + '…' : serial
}

function selectDevice(serial) {
  currentSerial = serial
  renderDevices()
}

async function disconnectDevice(serial) {
  log('cmd', `▶ 断开: adb disconnect ${serial}`)
  const r = await adb.run(`disconnect ${serial}`, null)
  if (r.stdout) log('ok', r.stdout.trim())
  if (r.stderr) log('err', r.stderr.trim())
  pollDevices()
}

function openConnectModal() {
  modalContext = { mode: 'connect' }
  const prefix = config.network?.subnetPrefix || '192.168.1.'
  const port = config.network?.port || 5555
  const ac = config.network.autoConnect
  document.getElementById('modal-title').textContent = '连接无线设备'
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>IP 末位(网段 ${esc(prefix)}x:${port})</label>
      <input id="f_ip_tail" type="text" placeholder="如 105" autofocus
        onkeydown="if(event.key==='Enter')saveModal()"></div>
    <div class="field"><label>或完整地址 IP:port(覆盖上面)</label>
      <input id="f_ip_full" type="text" placeholder="如 10.76.0.105:5555"></div>
    <div class="field"><label>网段前缀</label>
      <input id="f_subnet" value="${esc(prefix)}"></div>
    <div class="field"><label>默认端口</label>
      <input id="f_port" type="number" value="${port}"></div>
    <div class="auto-section">
      <div class="field"><label style="font-size:12px;color:#d4d4d4">⚙ 自动连接设置(扫 8888 端口)</label></div>
      <div class="field"><div class="row">
        <div><label>起始末位</label><input id="f_ac_start" type="number" value="${ac.rangeStart}"></div>
        <div><label>结束末位</label><input id="f_ac_end" type="number" value="${ac.rangeEnd}"></div>
      </div></div>
      <div class="field"><div class="row">
        <div><label>心跳端口</label><input id="f_ac_port" type="number" value="${ac.probePort}"></div>
        <div><label>扫描间隔(ms)</label><input id="f_ac_interval" type="number" value="${ac.intervalMs}"></div>
      </div></div>
      <div class="field"><div class="row">
        <div><label>探测超时(ms)</label><input id="f_ac_timeout" type="number" value="${ac.timeoutMs}"></div>
        <div><label>断开容忍次数</label><input id="f_ac_fails" type="number" value="${ac.failsBeforeDisconnect}"></div>
      </div></div>
    </div>`
  document.getElementById('modal').classList.remove('hidden')
}

async function doConnect(addr, silent) {
  if (!silent) log('cmd', `▶ 连接: adb connect ${addr}`)
  const r = await adb.run(`connect ${addr}`, null)
  if (!silent) {
    if (r.stdout) log(/already|connected/i.test(r.stdout) ? 'ok' : 'info', r.stdout.trim())
    if (r.stderr) log('err', r.stderr.trim())
  }
  pollDevices()
}

// ── Auto-connect (TCP probe to 8888) ──────────────────────────────────────────
function toggleAutoConnect() {
  const ac = config.network.autoConnect
  ac.enabled = !ac.enabled
  adb.saveConfig(config)
  if (ac.enabled) startAutoConnect()
  else stopAutoConnect()
}

function startAutoConnect() {
  if (autoTimer) return
  const ac = config.network.autoConnect
  document.getElementById('btn-auto').classList.add('active')
  runAutoProbe()
  autoTimer = setInterval(runAutoProbe, ac.intervalMs || 3000)
}

function stopAutoConnect() {
  clearInterval(autoTimer)
  autoTimer = null
  failCounts.clear()
  const btn = document.getElementById('btn-auto')
  btn.classList.remove('active', 'scanning')
  btn.textContent = '🔄 自动'
}

async function runAutoProbe() {
  const ac = config.network.autoConnect
  const prefix = config.network.subnetPrefix || '192.168.1.'
  const adbPort = config.network.port || 5555
  const hosts = []
  for (let i = ac.rangeStart; i <= ac.rangeEnd; i++) hosts.push(prefix + i)

  const btn = document.getElementById('btn-auto')
  btn.classList.add('scanning')
  const results = await adb.probe(hosts, ac.probePort, ac.timeoutMs)
  btn.classList.remove('scanning')

  const reachable = new Set(results.filter(r => r.ok).map(r => r.host))
  btn.textContent = `🔄 自动 ${reachable.size}/${hosts.length}`

  // 当前 adb 状态,按 IP 索引
  const adbByIp = new Map()
  knownDevices.forEach(d => {
    const m = d.serial.match(/^([\d.]+):\d+$/)
    if (m) adbByIp.set(m[1], d.status)
  })

  // 通的 → 没连就连,offline 就重连
  for (const host of reachable) {
    failCounts.delete(host)
    const status = adbByIp.get(host)
    const addr = `${host}:${adbPort}`
    if (!status) {
      doConnect(addr, true)
    } else if (status !== 'device') {
      await adb.run(`disconnect ${addr}`, null)
      doConnect(addr, true)
    }
  }

  // 不通的 → 计数,达阈值则断开
  for (const host of hosts) {
    if (reachable.has(host)) continue
    const cur = (failCounts.get(host) || 0) + 1
    failCounts.set(host, cur)
    if (cur >= ac.failsBeforeDisconnect && adbByIp.has(host)) {
      await adb.run(`disconnect ${host}:${adbPort}`, null)
      failCounts.delete(host)
    }
  }

  pollDevices()
}

document.getElementById('btn-refresh').onclick = pollDevices

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  renderSidebar()
  renderContent()
}

function renderSidebar() {
  const gl = document.getElementById('groups-list')
  gl.innerHTML = config.groups.map(g => `
    <div class="group-item ${g.id === currentGroupId ? 'active' : ''}"
         onclick="selectGroup('${g.id}')">
      <span>${esc(g.name)}</span>
      <span class="group-actions">
        <button class="icon-btn" onclick="event.stopPropagation();openGroupModal('${g.id}')" title="编辑">✎</button>
        <button class="icon-btn" onclick="event.stopPropagation();deleteGroup('${g.id}')" title="删除">✕</button>
      </span>
    </div>`).join('')

  // Chains section
  const cs = document.getElementById('chains-section')
  if (!config.chains?.length) { cs.innerHTML = ''; return }
  cs.innerHTML = `<div class="group-item ${currentGroupId === '__chains__' ? 'active' : ''}"
    onclick="selectChainGroup()"><span>⛓ 指令组合</span></div>`
}

function renderContent() {
  if (!currentGroupId) return
  const group = config.groups.find(g => g.id === currentGroupId)
  if (!group) return
  document.getElementById('content-title').textContent = group.name
  const cards = document.getElementById('cmd-cards')
  cards.innerHTML = group.commands.map(c => renderCard(c, group.id)).join('')
}

function renderCard(cmd, groupId) {
  return `<div class="cmd-card" draggable="true"
    ondragstart="dragStart(event,'${cmd.id}','${groupId}')"
    ondragover="dragOver(event)"
    ondrop="dragDrop(event,'${cmd.id}','${groupId}')"
    ondragend="dragEnd(event)"
    ondragleave="event.currentTarget.classList.remove('drag-before','drag-after','drag-over')">
    <div class="cmd-name">
      <span>${esc(cmd.name)}</span>
      <span class="card-actions">
        <button class="icon-btn" onclick="openCmdModal('${cmd.id}','${groupId}')" title="编辑">✎</button>
        <button class="icon-btn" onclick="deleteCmd('${cmd.id}','${groupId}')" title="删除">✕</button>
      </span>
    </div>
    ${renderWidget(cmd, groupId)}
  </div>`
}

function renderWidget(cmd, groupId) {
  const id = `w_${cmd.id}`
  switch (cmd.widget) {
    case 'button': return renderButtonWidget(cmd, groupId, id)
    case 'slider': return renderSliderWidget(cmd, groupId, id)
    case 'switch': return renderSwitchWidget(cmd, groupId, id)
    case 'input':  return renderInputWidget(cmd, groupId, id)
    case 'select': return renderSelectWidget(cmd, groupId, id)
    default: return `<span class="log-info">未知控件类型: ${esc(cmd.widget)}</span>`
  }
}

function renderButtonWidget(cmd, groupId, id) {
  const isDanger = cmd.confirm
  let html = `<button class="widget-btn ${isDanger ? 'danger-btn' : ''}"
    onclick="handleButton('${cmd.id}','${groupId}')">${esc(cmd.name)}</button>`
  if (cmd.params?.length) html += renderParams(cmd.params, 'param', cmd.id)
  return html
}

function renderSliderWidget(cmd, groupId, id) {
  const min = cmd.min || 0, max = cmd.max || 100
  const mid = Math.round((min + max) / 2)
  return `<div class="widget-row">
    <input type="range" id="${id}" min="${min}" max="${max}" step="${cmd.step||1}"
      value="${mid}"
      oninput="document.getElementById('lbl_${cmd.id}').textContent=this.value"
      onchange="runSlider('${cmd.id}','${groupId}',this.value)">
    <span class="slider-val" id="lbl_${cmd.id}">${mid}</span>
  </div>`
}

function renderSwitchWidget(cmd, groupId, id) {
  return `<div class="toggle-wrap">
    <label class="toggle">
      <input type="checkbox" id="${id}"
        onchange="runSwitch('${cmd.id}','${groupId}',this.checked)">
      <span class="slider-track"></span>
    </label>
    <span style="font-size:12px;color:#888">${esc(cmd.name)}</span>
  </div>`
}

function renderInputWidget(cmd, groupId, id) {
  return `<div class="input-widget">
    <input type="text" id="${id}" placeholder="${esc(cmd.placeholder||cmd.name)}"
      onkeydown="if(event.key==='Enter')runInput('${cmd.id}','${groupId}')">
    <button class="btn primary" onclick="runInput('${cmd.id}','${groupId}')">运行</button>
  </div>`
}

function renderSelectWidget(cmd, groupId, id) {
  if (!cmd.options?.length) return '<span class="log-info">无选项</span>'
  return `<select class="widget-select" id="${id}"
    onchange="runSelect('${cmd.id}','${groupId}',this.value)">
    ${cmd.options.map(o => `<option value="${esc(o.cmd)}">${esc(o.label)}</option>`).join('')}
  </select>
  <button class="btn primary" style="width:100%;margin-top:6px"
    onclick="runSelect('${cmd.id}','${groupId}',document.getElementById('${id}').value)">运行</button>`
}

function renderChainCard(chain) {
  let html = `<div class="cmd-card">
    <div class="cmd-name">
      <span>⛓ ${esc(chain.name)}</span>
      <span class="card-actions">
        <button class="icon-btn" onclick="openChainModal('${chain.id}')" title="编辑">✎</button>
        <button class="icon-btn" onclick="deleteChain('${chain.id}')" title="删除">✕</button>
      </span>
    </div>`
  if (chain.params?.length) html += renderParams(chain.params, 'cp', chain.id)
  html += `<button class="widget-btn danger-btn" style="margin-top:8px"
    onclick="runChain('${chain.id}')">执行组合</button></div>`
  return html
}

function renderParams(params, prefix, entityId) {
  return `<div class="params-form">` + params.map(p => `
      <label>${esc(p.label)}</label>
      <input type="text" id="${prefix}_${entityId}_${p.name}"
        value="${esc(p.default || '')}" placeholder="${esc(p.label)}">
    `).join('') + `</div>`
}

function collectParams(params, prefix, entityId) {
  const values = {}
  params?.forEach(p => {
    const el = document.getElementById(`${prefix}_${entityId}_${p.name}`)
    values[p.name] = el ? el.value : (p.default || '')
  })
  return values
}

// ── Command execution ─────────────────────────────────────────────────────────
function serial() { return currentSerial }

function fillParams(cmd, values) {
  return Object.entries(values).reduce((s, [k, v]) =>
    s.replace(new RegExp(`\\{${k}\\}`, 'g'), v), cmd)
}

async function handleButton(cmdId, groupId) {
  const cmd = findCmd(cmdId, groupId)
  if (!cmd) return
  if (cmd.confirm && !confirm(`确认执行：${cmd.name}？`)) return

  const resolved = cmd.params?.length
    ? fillParams(cmd.cmd, collectParams(cmd.params, 'param', cmdId))
    : cmd.cmd
  await execute(resolved, cmd.name, cmd.stream)
}

async function runSlider(cmdId, groupId, value) {
  const cmd = findCmd(cmdId, groupId)
  if (!cmd) return
  await execute(fillParams(cmd.cmd, { [cmd.paramName]: value }), cmd.name)
}

async function runSwitch(cmdId, groupId, checked) {
  const cmd = findCmd(cmdId, groupId)
  if (!cmd) return
  await execute(checked ? cmd.cmdOn : cmd.cmdOff, cmd.name)
}

async function runInput(cmdId, groupId) {
  const cmd = findCmd(cmdId, groupId)
  if (!cmd) return
  const val = document.getElementById(`w_${cmdId}`)?.value || ''
  if (!val.trim()) return
  await execute(fillParams(cmd.cmd, { [cmd.paramName]: val }), cmd.name)
}

async function runSelect(cmdId, groupId, cmdStr) {
  if (!cmdStr) return
  const cmd = findCmd(cmdId, groupId)
  await execute(cmdStr, cmd?.name || cmdId)
}

async function runChain(chainId) {
  const chain = config.chains?.find(c => c.id === chainId)
  if (!chain) return
  if (chain.confirm && !confirm(`确认执行：${chain.name}？`)) return

  const values = collectParams(chain.params, 'cp', chainId)

  for (const step of chain.steps) {
    const cmd = fillParams(step.cmd, values)
    const result = await execute(cmd, chain.name)
    if (step.waitMs) await new Promise(r => setTimeout(r, step.waitMs))
    // ponytail: no waitForOutput support in MVP — add when needed
  }
}

async function execute(cmd, label, stream) {
  log('cmd', `▶ ${label}: adb ${cmd}`)
  if (stream) {
    const id = uid()
    const logEl = document.getElementById('output-log')
    const div = document.createElement('div')
    div.className = 'log-ok'
    logEl.appendChild(div)
    const stopBtn = document.createElement('button')
    stopBtn.className = 'btn danger'
    stopBtn.style.cssText = 'margin:4px 0;font-size:11px;height:22px;padding:0 8px'
    stopBtn.textContent = '■ 停止'
    stopBtn.onclick = () => adb.streamKill(id)
    logEl.appendChild(stopBtn)
    logEl.scrollTop = 9999
    adb.stream(id, cmd, serial(), msg => {
      if (msg.type === 'data') { div.textContent += stripAnsi(msg.data); logEl.scrollTop = 9999 }
      else if (msg.type === 'err') { log('err', msg.data.trim()) }
      else { stopBtn.remove(); adb.streamKill(id) }   // ponytail: 自然结束也要清监听器,否则闭包持有 div 泄漏
    })
    return
  }
  const logEl = document.getElementById('output-log')
  const div = document.createElement('div')
  div.className = 'log-ok'
  logEl.appendChild(div)
  const stopBtn = document.createElement('button')
  stopBtn.className = 'btn danger'
  stopBtn.style.cssText = 'margin:4px 0;font-size:11px;height:22px;padding:0 8px'
  stopBtn.textContent = '■ 停止'
  stopBtn.onclick = () => adb.runKill()
  logEl.appendChild(stopBtn)
  adb.onRunData(msg => {
    const text = stripAnsi(msg.data)
    if (!text.trim()) return
    if (msg.type === 'out') { div.textContent += text; logEl.scrollTop = logEl.scrollHeight }
    else { log('err', text.trim()) }
  })
  const result = await adb.run(cmd, serial())
  adb.offRunData()
  stopBtn.remove()
  if (!div.textContent && result.stdout) div.textContent = result.stdout.trim()
  if (!result.ok && !result.stderr && !div.textContent) log('err', '执行失败')
  return result
}

// ── Output ────────────────────────────────────────────────────────────────────
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

function log(type, msg) {
  const el = document.getElementById('output-log')
  const div = document.createElement('div')
  div.className = `log-${type}`
  div.textContent = stripAnsi(msg)
  el.appendChild(div)
  el.scrollTop = el.scrollHeight
}

function clearOutput() { document.getElementById('output-log').innerHTML = '' }

function toggleOutput() {
  outputCollapsed = !outputCollapsed
  document.getElementById('output').classList.toggle('collapsed', outputCollapsed)
  document.getElementById('btn-collapse').textContent = outputCollapsed ? '▲' : '▼'
}

function expandOutput() {
  const output = document.getElementById('output')
  const btn = document.getElementById('btn-expand')
  if (outputExpanded) {
    output.style.height = prevOutputH || '140px'
    outputExpanded = false
    btn.textContent = '⤢'
  } else {
    prevOutputH = output.style.height || '140px'
    output.style.height = (window.innerHeight - 60) + 'px'
    outputExpanded = true
    btn.textContent = '⤡'
    if (outputCollapsed) { outputCollapsed = false; output.classList.remove('collapsed') }
  }
}

// ── Output resize ─────────────────────────────────────────────────────────────
;(function() {
  const handle = document.getElementById('output-resize')
  const output = document.getElementById('output')
  let startY, startH
  handle.addEventListener('mousedown', e => {
    if (outputCollapsed) return
    startY = e.clientY; startH = output.offsetHeight
    handle.classList.add('dragging')
    output.style.transition = 'none'
    const onMove = e => output.style.height = Math.max(60, startH - (e.clientY - startY)) + 'px'
    const onUp = () => {
      handle.classList.remove('dragging')
      output.style.transition = ''
      removeEventListener('mousemove', onMove)
      removeEventListener('mouseup', onUp)
    }
    addEventListener('mousemove', onMove)
    addEventListener('mouseup', onUp)
  })
})()

// ── Navigation ────────────────────────────────────────────────────────────────
function selectGroup(id) {
  currentGroupId = id
  document.getElementById('btn-add').textContent = '＋ 添加指令'
  renderSidebar()
  renderContent()
}

function selectChainGroup() {
  currentGroupId = '__chains__'
  document.getElementById('btn-add').textContent = '＋ 添加组合'
  renderSidebar()
  document.getElementById('content-title').textContent = '指令组合'
  document.getElementById('cmd-cards').innerHTML =
    (config.chains || []).map(c => renderChainCard(c)).join('')
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function openCmdModal(cmdId, groupId) {
  const gId = groupId || currentGroupId
  if (!gId || gId === '__chains__') return
  const cmd = cmdId ? findCmd(cmdId, gId) : null
  modalContext = { mode: 'cmd', groupId: gId, cmdId }

  document.getElementById('modal-title').textContent = cmdId ? '编辑指令' : '添加指令'
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>名称</label>
      <input id="f_name" value="${esc(cmd?.name||'')}"></div>
    <div class="field"><label>控件类型</label>
      <select id="f_widget">
        ${['button','slider','switch','input','select'].map(w =>
          `<option value="${w}" ${cmd?.widget===w?'selected':''}>${w}</option>`).join('')}
      </select></div>
    <div class="field"><label>指令（adb 参数，支持 {占位符}）</label>
      <textarea id="f_cmd">${esc(cmd?.cmd||cmd?.cmdOn||'')}</textarea>
      <div class="widget-help">示例: shell settings put system brightness {value}</div></div>
    <div class="field" id="f_cmdoff_wrap" style="${cmd?.widget==='switch'?'':'display:none'}">
      <label>关闭指令（switch 专用）</label>
      <textarea id="f_cmdoff">${esc(cmd?.cmdOff||'')}</textarea></div>
    <div class="field" id="f_range_wrap" style="${cmd?.widget==='slider'?'':'display:none'}">
      <label>范围 (min / max / step)</label>
      <div style="display:flex;gap:6px">
        <input id="f_min" type="number" value="${cmd?.min||0}" placeholder="min">
        <input id="f_max" type="number" value="${cmd?.max||100}" placeholder="max">
        <input id="f_step" type="number" value="${cmd?.step||1}" placeholder="step">
      </div></div>
    <div class="field">
      <label><input type="checkbox" id="f_confirm" ${cmd?.confirm?'checked':''}> 执行前需确认</label>
    </div>`

  document.getElementById('f_widget').onchange = (e) => {
    document.getElementById('f_cmdoff_wrap').style.display = e.target.value==='switch' ? '' : 'none'
    document.getElementById('f_range_wrap').style.display  = e.target.value==='slider' ? '' : 'none'
  }

  document.getElementById('modal').classList.remove('hidden')
}

function openGroupModal(groupId) {
  const group = groupId ? config.groups.find(g => g.id === groupId) : null
  modalContext = { mode: 'group', groupId }
  document.getElementById('modal-title').textContent = groupId ? '编辑分组' : '添加分组'
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>分组名称</label>
      <input id="f_gname" value="${esc(group?.name||'')}"></div>`
  document.getElementById('modal').classList.remove('hidden')
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden')
  modalContext = null
}

function openAddModal() {
  if (currentGroupId === '__chains__') openChainModal(null)
  else openCmdModal(null)
}

function openChainModal(chainId) {
  const chain = chainId ? config.chains?.find(c => c.id === chainId) : null
  modalContext = { mode: 'chain', chainId }
  document.getElementById('modal-title').textContent = chainId ? '编辑指令组合' : '添加指令组合'
  const stepsVal = chain?.steps?.map(s => s.waitMs ? `${s.cmd}@@${s.waitMs}` : s.cmd).join('\n') || ''
  const paramsVal = chain?.params?.map(p => `${p.name}:${p.label}:${p.default||''}`).join('\n') || ''
  document.getElementById('modal-body').innerHTML = `
    <div class="field"><label>名称</label>
      <input id="f_cname" value="${esc(chain?.name||'')}"></div>
    <div class="field"><label>步骤（每行一条 adb 参数，延时用 @@毫秒，如 shell reboot@@500）</label>
      <textarea id="f_steps" style="min-height:100px">${esc(stepsVal)}</textarea></div>
    <div class="field"><label>参数（每行: 变量名:标签:默认值，可选）</label>
      <textarea id="f_params">${esc(paramsVal)}</textarea></div>
    <div class="field">
      <label><input type="checkbox" id="f_cconfirm" ${chain?.confirm?'checked':''}> 执行前需确认</label>
    </div>`
  document.getElementById('modal').classList.remove('hidden')
}

function deleteChain(chainId) {
  if (!confirm('删除此指令组合？')) return
  config.chains = config.chains.filter(c => c.id !== chainId)
  adb.saveConfig(config)
  selectChainGroup()
}

function saveModal() {
  if (!modalContext) return
  const parseLines = s => s.split('\n').map(l => l.trim()).filter(Boolean)
  const upsert = (arr, item) => {
    const i = arr.findIndex(x => x.id === item.id)
    if (i >= 0) arr[i] = item; else arr.push(item)
  }

  if (modalContext.mode === 'connect') {
    const subnet = document.getElementById('f_subnet').value.trim() || '192.168.1.'
    const port = +document.getElementById('f_port').value || 5555
    const full = document.getElementById('f_ip_full').value.trim()
    const tail = document.getElementById('f_ip_tail').value.trim()
    const ac = config.network.autoConnect
    ac.rangeStart            = +document.getElementById('f_ac_start').value    || ac.rangeStart
    ac.rangeEnd              = +document.getElementById('f_ac_end').value      || ac.rangeEnd
    ac.probePort             = +document.getElementById('f_ac_port').value     || ac.probePort
    ac.intervalMs            = +document.getElementById('f_ac_interval').value || ac.intervalMs
    ac.timeoutMs             = +document.getElementById('f_ac_timeout').value  || ac.timeoutMs
    ac.failsBeforeDisconnect = +document.getElementById('f_ac_fails').value    || ac.failsBeforeDisconnect
    config.network = { ...config.network, subnetPrefix: subnet, port }
    adb.saveConfig(config)
    // 设置变了 → 如果当前自动开着,重启计时器以应用新间隔
    if (autoTimer) { stopAutoConnect(); startAutoConnect() }
    const addr = full || (tail ? `${subnet}${tail}:${port}` : '')
    closeModal()
    if (addr) doConnect(addr)
    return
  }

  if (modalContext.mode === 'group') {
    const name = document.getElementById('f_gname').value.trim()
    if (!name) return
    upsert(config.groups, modalContext.groupId
      ? { ...config.groups.find(g => g.id === modalContext.groupId), name }
      : { id: uid(), name, commands: [] })
  } else if (modalContext.mode === 'chain') {
    const name = document.getElementById('f_cname').value.trim()
    const stepsRaw = document.getElementById('f_steps').value.trim()
    if (!name || !stepsRaw) return
    const steps = parseLines(stepsRaw).map(l => {
      const [cmd, wait] = l.split('@@')
      return wait ? { cmd: cmd.trim(), waitMs: +wait } : { cmd: cmd.trim() }
    })
    const params = parseLines(document.getElementById('f_params').value).map(l => {
      const [name, label, def] = l.split(':')
      return { name: name.trim(), label: (label||name).trim(), type: 'text', default: (def||'').trim() }
    })
    const obj = { id: modalContext.chainId || uid(), name, steps,
      confirm: document.getElementById('f_cconfirm').checked }
    if (params.length) obj.params = params
    if (!config.chains) config.chains = []
    upsert(config.chains, obj)
    adb.saveConfig(config)
    closeModal()
    selectChainGroup()
    return
  } else {
    const name    = document.getElementById('f_name').value.trim()
    const widget  = document.getElementById('f_widget').value
    const cmd     = document.getElementById('f_cmd').value.trim()
    const confirm = document.getElementById('f_confirm').checked
    if (!name || !cmd) return

    const obj = { id: modalContext.cmdId || uid(), name, widget, confirm }
    if (widget === 'switch') {
      obj.cmdOn = cmd
      obj.cmdOff = document.getElementById('f_cmdoff').value.trim()
    } else {
      obj.cmd = cmd
    }
    if (widget === 'slider') {
      obj.min  = +document.getElementById('f_min').value  || 0
      obj.max  = +document.getElementById('f_max').value  || 100
      obj.step = +document.getElementById('f_step').value || 1
      obj.paramName = 'value'
    }
    if (widget === 'input') obj.paramName = 'value'

    const group = config.groups.find(g => g.id === modalContext.groupId)
    if (!group) return
    upsert(group.commands, obj)
  }

  adb.saveConfig(config)
  closeModal()
  render()
}

function deleteCmd(cmdId, groupId) {
  if (!confirm('删除此指令？')) return
  const group = config.groups.find(g => g.id === groupId)
  if (!group) return
  group.commands = group.commands.filter(c => c.id !== cmdId)
  adb.saveConfig(config)
  renderContent()
}

function deleteGroup(groupId) {
  if (!confirm('删除此分组及其所有指令？')) return
  config.groups = config.groups.filter(g => g.id !== groupId)
  if (currentGroupId === groupId) currentGroupId = null
  adb.saveConfig(config)
  render()
}

function confirmReset() {
  if (!confirm('重置为默认配置？当前所有修改将丢失。')) return
  adb.resetConfig().then(cfg => { config = cfg; render() })
}

// ── Drag to reorder ───────────────────────────────────────────────────────────
let _dragSrc = null
let _insertAfter = false

function dragStart(e, cmdId, groupId) {
  _dragSrc = { cmdId, groupId }
  e.currentTarget.classList.add('dragging')
  e.dataTransfer.effectAllowed = 'move'
}

function dragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  const el = e.currentTarget
  _insertAfter = e.offsetX > el.offsetWidth / 2
  el.classList.toggle('drag-before', !_insertAfter)
  el.classList.toggle('drag-after', _insertAfter)
}

function dragDrop(e, targetId, targetGroup) {
  e.preventDefault()
  const el = e.currentTarget
  el.classList.remove('drag-before', 'drag-after')
  if (!_dragSrc || _dragSrc.cmdId === targetId || _dragSrc.groupId !== targetGroup) return
  const group = config.groups.find(g => g.id === targetGroup)
  if (!group) return
  const cmds = group.commands
  const fromIdx = cmds.findIndex(c => c.id === _dragSrc.cmdId)
  const toIdx   = cmds.findIndex(c => c.id === targetId)
  if (fromIdx < 0 || toIdx < 0) return
  let insertIdx = toIdx + (_insertAfter ? 1 : 0)
  if (fromIdx < insertIdx) insertIdx--   // splice 移除后下标前移
  cmds.splice(insertIdx, 0, cmds.splice(fromIdx, 1)[0])
  adb.saveConfig(config)
  renderContent()
}

function dragEnd(e) {
  e.currentTarget.classList.remove('dragging')
  document.querySelectorAll('.drag-before,.drag-after').forEach(el => el.classList.remove('drag-before','drag-after'))
  _dragSrc = null
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function findCmd(cmdId, groupId) {
  return config.groups.find(g => g.id === groupId)?.commands.find(c => c.id === cmdId)
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}
