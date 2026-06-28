let config = { groups: [], chains: [] }
let currentGroupId = null
let modalContext = null   // { mode:'cmd'|'group', groupId, cmdId }
let outputCollapsed = false

// ── Startup ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  config = await adb.loadConfig()
  render()
  pollDevices()
  setInterval(pollDevices, 4000)
})

async function pollDevices() {
  const devices = await adb.devices()
  const sel = document.getElementById('device-select')
  const prev = sel.value
  sel.innerHTML = '<option value="">-- 选择设备 --</option>' +
    devices.map(d => `<option value="${esc(d.serial)}">${esc(d.serial)}</option>`).join('')
  if (prev && devices.find(d => d.serial === prev)) sel.value = prev
  const st = document.getElementById('device-status')
  st.textContent = devices.length ? `${devices.length} 台设备在线` : '未检测到设备'
  st.style.color = devices.length ? '#4ec94e' : '#888'
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
  const hasParams = cmd.params?.length
  let html = `<button class="widget-btn ${isDanger ? 'danger-btn' : ''}"
    onclick="handleButton('${cmd.id}','${groupId}')">${esc(cmd.name)}</button>`
  if (hasParams) {
    html += `<div class="params-form" id="pf_${cmd.id}">`
    html += cmd.params.map(p => `
      <label>${esc(p.label)}</label>
      <input type="text" id="param_${cmd.id}_${p.name}"
        value="${esc(p.default || '')}" placeholder="${esc(p.label)}">
    `).join('')
    html += '</div>'
  }
  return html
}

function renderSliderWidget(cmd, groupId, id) {
  return `<div class="widget-row">
    <input type="range" id="${id}" min="${cmd.min||0}" max="${cmd.max||100}" step="${cmd.step||1}"
      value="${Math.round((cmd.min||0)+((cmd.max||100)-(cmd.min||0))/2)}"
      oninput="document.getElementById('lbl_${cmd.id}').textContent=this.value"
      onchange="runSlider('${cmd.id}','${groupId}',this.value)">
    <span class="slider-val" id="lbl_${cmd.id}">${Math.round((cmd.min||0)+((cmd.max||100)-(cmd.min||0))/2)}</span>
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
  if (chain.params?.length) {
    html += `<div class="params-form">`
    html += chain.params.map(p => `
      <label>${esc(p.label)}</label>
      <input type="text" id="cp_${chain.id}_${p.name}"
        value="${esc(p.default||'')}" placeholder="${esc(p.label)}">
    `).join('')
    html += `</div>`
  }
  html += `<button class="widget-btn danger-btn" style="margin-top:8px"
    onclick="runChain('${chain.id}')">执行组合</button></div>`
  return html
}

// ── Command execution ─────────────────────────────────────────────────────────
function serial() { return document.getElementById('device-select').value || null }

function fillParams(cmd, values) {
  return Object.entries(values).reduce((s, [k, v]) =>
    s.replace(new RegExp(`\\{${k}\\}`, 'g'), v), cmd)
}

async function handleButton(cmdId, groupId) {
  const cmd = findCmd(cmdId, groupId)
  if (!cmd) return
  if (cmd.confirm && !confirm(`确认执行：${cmd.name}？`)) return

  let resolved = cmd.cmd
  if (cmd.params?.length) {
    const values = {}
    for (const p of cmd.params) {
      const el = document.getElementById(`param_${cmdId}_${p.name}`)
      values[p.name] = el ? el.value : (p.default || '')
    }
    resolved = fillParams(resolved, values)
  }
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

  const values = {}
  chain.params?.forEach(p => {
    const el = document.getElementById(`cp_${chainId}_${p.name}`)
    values[p.name] = el ? el.value : (p.default || '')
  })

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
    const div = document.createElement('div')
    div.className = 'log-ok'
    document.getElementById('output-log').appendChild(div)
    const stopBtn = document.createElement('button')
    stopBtn.className = 'btn danger'
    stopBtn.style.cssText = 'margin:4px 0;font-size:11px;height:22px;padding:0 8px'
    stopBtn.textContent = '■ 停止'
    stopBtn.onclick = () => adb.streamKill(id)
    document.getElementById('output-log').appendChild(stopBtn)
    document.getElementById('output-log').scrollTop = 9999
    adb.stream(id, cmd, serial(), msg => {
      if (msg.type === 'data') { div.textContent += msg.data; document.getElementById('output-log').scrollTop = 9999 }
      else if (msg.type === 'err') { log('err', msg.data.trim()) }
      else { stopBtn.remove() }
    })
    return
  }
  const result = await adb.run(cmd, serial())
  if (result.stdout) log('ok', result.stdout.trim())
  if (result.stderr) log('err', result.stderr.trim())
  if (!result.ok && !result.stderr) log('err', '执行失败')
  return result
}

// ── Output ────────────────────────────────────────────────────────────────────
function log(type, msg) {
  const el = document.getElementById('output-log')
  const div = document.createElement('div')
  div.className = `log-${type}`
  div.textContent = msg
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
  const expanded = output.dataset.expanded === '1'
  if (expanded) {
    output.style.height = output.dataset.prevH || '140px'
    output.dataset.expanded = ''
    document.getElementById('btn-expand').textContent = '⤢'
  } else {
    output.dataset.prevH = output.style.height || '140px'
    output.style.height = (window.innerHeight - 60) + 'px'
    output.dataset.expanded = '1'
    document.getElementById('btn-expand').textContent = '⤡'
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
  if (modalContext.mode === 'group') {
    const name = document.getElementById('f_gname').value.trim()
    if (!name) return
    if (modalContext.groupId) {
      const g = config.groups.find(g => g.id === modalContext.groupId)
      if (g) g.name = name
    } else {
      config.groups.push({ id: uid(), name, commands: [] })
    }
  } else if (modalContext.mode === 'chain') {
    const name = document.getElementById('f_cname').value.trim()
    const stepsRaw = document.getElementById('f_steps').value.trim()
    if (!name || !stepsRaw) return
    const steps = stepsRaw.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [cmd, wait] = l.split('@@')
      return wait ? { cmd: cmd.trim(), waitMs: +wait } : { cmd: cmd.trim() }
    })
    const paramsRaw = document.getElementById('f_params').value.trim()
    const params = paramsRaw ? paramsRaw.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [name, label, def] = l.split(':')
      return { name: name.trim(), label: (label||name).trim(), type: 'text', default: (def||'').trim() }
    }) : []
    const obj = { id: modalContext.chainId || uid(), name, steps,
      confirm: document.getElementById('f_cconfirm').checked }
    if (params.length) obj.params = params
    if (modalContext.chainId) {
      const idx = config.chains.findIndex(c => c.id === modalContext.chainId)
      if (idx >= 0) config.chains[idx] = obj
    } else {
      if (!config.chains) config.chains = []
      config.chains.push(obj)
    }
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
    if (modalContext.cmdId) {
      const idx = group.commands.findIndex(c => c.id === modalContext.cmdId)
      if (idx >= 0) group.commands[idx] = obj
    } else {
      group.commands.push(obj)
    }
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
