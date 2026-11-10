/**
 * dsh-fou · 宿主半（v0：只有验收表）
 *
 * 为什么需要宿主半：验收表是交互页面，如果从本地文件（file://）打开，它发不出
 * 任何请求（跨源被拦），结果只能靠"复制粘贴"带出来。所以由宿主同源提供页面，
 * 提交后直接落盘 —— Agent 下一次可以**直接读文件**，不必再等人粘回来。
 *
 * 只做两件事：
 *   GET  /dsh-fou/accept  → 返回验收表页面（同源）
 *   POST /dsh-fou/accept  → 把结果写成 <时间>.json + <时间>.md，并更新 latest
 *   GET  /dsh-fou/health  → { ok, version, outDir }
 *
 * 全部路由都要求 `x-dsh-fou` 头：挡住跨源"顺手一调"，与本机其它插件同一口径。
 */
import { mkdir, writeFile, readFile, stat, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HEADER = 'x-dsh-fou'
const ROUTES = {
  accept: '/dsh-fou/accept',
  sheets: '/dsh-fou/sheets',
  sheet: '/dsh-fou/sheet',
  panels: '/dsh-fou/panels',
  panelsPage: '/dsh-fou/panels.html',
  panel: '/dsh-fou/panel',
  hang: '/dsh-fou/hang',
  editor: '/dsh-fou/editor.html',
  view: '/dsh-fou/view',
  draft: '/dsh-fou/draft',
  commit: '/dsh-fou/commit',
  health: '/dsh-fou/health',
}
const DEFAULT_OUT = 'D:\\dsh-work\\_验收'
const SHEET_DIR_NAME = '_表单'
const IMAGE_DIR_NAME = 'images'
const PANEL_DIR_NAME = '_挂板'
const MAX_BODY_BYTES = 24 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PANEL_BYTES = 4 * 1024 * 1024
const HERE = dirname(fileURLToPath(import.meta.url))
const TABLE_FILE = join(HERE, 'accept.html')
const PANELS_FILE = join(HERE, 'panels.html')
const EDITOR_FILE = join(HERE, 'editor.html')
const VIEW_FILE = join(HERE, 'view.html')
const DRAFT_DIR_NAME = '_草稿'
const DOC_DIR_NAME = '_稿件'

// ---------------------------------------------------------------- 编辑器存档
//
// 两个动作，两个地方（用户 2026-11-05："编辑即保存，发送即落稿"）：
//   `_草稿\editor.md`            编辑中，可覆盖（防抖写 + baseMtime 冲突检测）
//   `_稿件\<时间>-<标题>.md`      发送时落稿，只增不改
// 冲突检测照抄记事本：带 baseMtime，磁盘更新就拒绝覆盖。

function draftPath(outDir) {
  return join(dirname(outDir), DRAFT_DIR_NAME, 'editor.md')
}

function docDir(outDir) {
  return join(dirname(outDir), DOC_DIR_NAME)
}

/** 文件名用的标题：去掉 markdown 记号与非法字符。 */
function titleToSlug(raw) {
  const cleaned = String(raw || '')
    .replace(/[#>*`~\[\]()]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\s　]+/g, '-')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .slice(0, 40)
  return cleaned
}

/** 标题：显式给了就用；没给取正文第一行（用户说的"手机便签法"）。 */
function resolveTitle(title, text) {
  const direct = typeof title === 'string' ? title.trim() : ''
  if (direct !== '') return direct.slice(0, 80)
  const firstLine = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  return firstLine ? firstLine.replace(/^#+\s*/, '').slice(0, 80) : '未命名'
}

async function saveDraft(outDir, body) {
  const text = typeof body.text === 'string' ? body.text : ''
  const title = typeof body.title === 'string' ? body.title : ''
  const path = draftPath(outDir)
  await mkdir(dirname(path), { recursive: true })

  let current = 0
  try {
    current = (await stat(path)).mtimeMs
  } catch (error) {
    current = 0
  }
  const base = typeof body.baseMtime === 'number' ? body.baseMtime : 0
  // baseMtime 给了、且磁盘比它新 → 别人改过，拒绝覆盖（与记事本同口径）
  if (base > 0 && current > base + 1 && body.force !== true) {
    return { conflict: true, baseMtime: current, text: await readFile(path, 'utf8') }
  }
  await writeFile(path, text, 'utf8')
  const next = (await stat(path)).mtimeMs
  return { path: path.replace(/\\/g, '/'), baseMtime: next, title, bytes: Buffer.byteLength(text, 'utf8') }
}

async function commitDoc(outDir, body) {
  const text = typeof body.text === 'string' ? body.text : ''
  if (text.trim() === '') throw new Error('正文为空')
  const title = resolveTitle(body.title, text)
  const slug = titleToSlug(title) || fileStamp()
  const dir = docDir(outDir)
  await mkdir(dir, { recursive: true })
  let name = fileStamp() + '-' + slug + '.md'
  let full = join(dir, name)
  // 重名就加后缀，绝不覆盖旧稿（稿件只增不改）
  try {
    await stat(full)
    name = fileStamp() + '-' + slug + '-' + Date.now().toString(36) + '.md'
    full = join(dir, name)
  } catch (error) {
    /* 不存在，直接用 */
  }
  await writeFile(full, text, 'utf8')
  return {
    path: full.replace(/\\/g, '/'),
    name,
    title,
    bytes: Buffer.byteLength(text, 'utf8'),
  }
}

// ---------------------------------------------------------------- 挂板
//
// **挂板的能力是「挂」，模表的能力是「模」—— 两回事。**
// 挂板不关心挂上来的是什么：html / md / json / 纯文本都能挂（用户 2026-11-05 定：
// "哪怕是原文"）。所以这里不做任何格式校验，只做三件事：存下来、列出来、取出来。
//
// 挂件 = `_挂板\<id>.<ext>` + `_挂板\index.json` 一条记录。

/**
 * 挂板能认的类型；认不出的一律当 text，不报错。
 * `url` 是特例：**挂地址，不挂内容** —— 内容不搬，只留一个指针（永远取最新那份）。
 */
const PANEL_KINDS = { html: 'html', md: 'md', json: 'json', text: 'txt', url: null }

function panelDir(outDir) {
  // 挂板是**独立于验收**的（挂什么由挂的人决定），所以放在验收目录的**同级**：
  // `D:\dsh-work\_验收` + `..` → `D:\dsh-work\_挂板`
  return join(dirname(outDir), PANEL_DIR_NAME)
}

async function readPanelIndex(outDir) {
  try {
    const parsed = JSON.parse(await readFile(join(panelDir(outDir), 'index.json'), 'utf8'))
    return Array.isArray(parsed.panels) ? parsed.panels : []
  } catch (error) {
    return []
  }
}

async function writePanelIndex(outDir, panels) {
  await mkdir(panelDir(outDir), { recursive: true })
  await writeFile(
    join(panelDir(outDir), 'index.json'),
    JSON.stringify({ panels }, null, 2),
    'utf8',
  )
}

/**
 * 挂一个上去。**不校验内容格式** —— 这是"挂"的语义。
 * body: { id?, title, kind?, content?, path?, from? }
 *   - content：直接给的正文
 *   - path：从别处读一个文件（跨区只读，规范允许）
 */
async function hangPanel(outDir, body) {
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '未命名'
  const rawKind = typeof body.kind === 'string' ? body.kind.trim().toLowerCase() : ''
  const kind = PANEL_KINDS[rawKind] !== undefined ? rawKind : 'text'
  const id = safeId(body.id || '') || 'p' + Date.now().toString(36)

  // `url` 挂件：只登记地址，不落文件 —— 内容永远取最新的那份（不复制，不会变旧）。
  if (kind === 'url') {
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (url === '') throw new Error('url 挂件必须给 url')
    const panels = await readPanelIndex(outDir)
    const record = {
      id,
      title,
      kind: 'url',
      url,
      from: typeof body.from === 'string' ? body.from : '',
      bytes: 0,
      hungAt: stamp(),
    }
    const at = panels.findIndex((item) => item && item.id === id)
    if (at >= 0) panels[at] = record
    else panels.unshift(record)
    await writePanelIndex(outDir, panels)
    return record
  }

  const ext = PANEL_KINDS[kind]
  const file = id + '.' + ext

  let content = typeof body.content === 'string' ? body.content : ''
  const fromPath = typeof body.path === 'string' ? body.path.trim() : ''
  if (content === '' && fromPath !== '') {
    content = await readFile(resolve(fromPath), 'utf8')
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_PANEL_BYTES) {
    throw new Error('内容太大（上限 ' + Math.round(MAX_PANEL_BYTES / 1024 / 1024) + ' MB）')
  }

  await mkdir(panelDir(outDir), { recursive: true })
  await writeFile(join(panelDir(outDir), file), content, 'utf8')

  const panels = await readPanelIndex(outDir)
  const record = {
    id,
    title,
    kind,
    file,
    from: typeof body.from === 'string' ? body.from : '',
    bytes: Buffer.byteLength(content, 'utf8'),
    hungAt: stamp(),
  }
  const at = panels.findIndex((item) => item && item.id === id)
  if (at >= 0) panels[at] = record
  else panels.unshift(record)
  await writePanelIndex(outDir, panels)
  return record
}

async function readPanel(outDir, id) {
  const safe = safeId(id || '')
  if (safe === '') throw new Error('挂件 id 不合法')
  const panels = await readPanelIndex(outDir)
  const meta = panels.find((item) => item && item.id === safe)
  if (!meta) throw new Error('没有这个挂件：' + safe)
  if (meta.kind === 'url') return { meta, content: '' }
  const content = await readFile(join(panelDir(outDir), meta.file), 'utf8')
  return { meta, content }
}

// ---------------------------------------------------------------- 表单定义
//
// 表不是写死的：`_验收\_表单\<id>.json` 里放一份 { id, title, note, items[] }，
// 页面顶部就能切换。这样"验收表"才能验"验收表本身"，也能验任何别的东西。

function sheetDir(outDir) {
  return join(outDir, SHEET_DIR_NAME)
}

function imageDir(outDir) {
  return join(outDir, IMAGE_DIR_NAME)
}

/** id 只允许字母数字下划线短横 —— 它会被拼进文件名。 */
function safeId(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : ''
}

async function listSheets(outDir) {
  let names = []
  try {
    names = await readdir(sheetDir(outDir))
  } catch (error) {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue
    const id = name.slice(0, -5)
    if (!safeId(id)) continue
    try {
      const parsed = JSON.parse(await readFile(join(sheetDir(outDir), name), 'utf8'))
      const items = Array.isArray(parsed.items) ? parsed.items : []
      out.push({
        id,
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : id,
        note: typeof parsed.note === 'string' ? parsed.note : '',
        itemCount: items.length,
      })
    } catch (error) {
      out.push({ id, title: id + '（读取失败）', note: String(error.message || error), itemCount: 0 })
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

async function readSheet(outDir, id) {
  const safe = safeId(id)
  if (safe === '') throw new Error('表单 id 不合法')
  const raw = await readFile(join(sheetDir(outDir), safe + '.json'), 'utf8')
  const parsed = JSON.parse(raw)
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .filter((item) => item && typeof item.name === 'string')
    .map((item) => ({
      name: item.name,
      desc: typeof item.desc === 'string' ? item.desc : '',
      // 反向项 = 测谎题（用户 2026-11-05 的方法学）：不计入通过率，只算可信度。
      reverse: item.reverse === true,
    }))
  return {
    id: safe,
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : safe,
    note: typeof parsed.note === 'string' ? parsed.note : '',
    // 三段文字区的标题可被表单定义覆盖（"报告 / 验收 / 询问"就是这么来的）
    sections:
      parsed.sections && typeof parsed.sections === 'object'
        ? {
            comment: typeof parsed.sections.comment === 'string' ? parsed.sections.comment : '',
            improve: typeof parsed.sections.improve === 'string' ? parsed.sections.improve : '',
            chat: typeof parsed.sections.chat === 'string' ? parsed.sections.chat : '',
          }
        : null,
    items,
  }
}

/** 把提交上来的 dataURL 图片落盘，返回可直接引用的路径。 */
async function saveImages(outDir, images, base) {
  if (!Array.isArray(images) || images.length === 0) return []
  const dir = imageDir(outDir)
  await mkdir(dir, { recursive: true })
  const saved = []
  let index = 0
  for (const image of images) {
    if (index >= 20) break
    const dataUrl = image && typeof image.dataUrl === 'string' ? image.dataUrl : ''
    const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!match) continue
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) continue
    index += 1
    const file = base + '-' + index + '.' + ext
    const full = join(dir, file)
    await writeFile(full, buffer)
    saved.push({ path: full, file, from: image && image.from ? String(image.from).slice(0, 40) : '' })
  }
  return saved
}

// ---------------------------------------------------------------- responses

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function sendHTML(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  })
  res.end(html)
}

function readJSONBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    let failed = false
    req.on('data', (chunk) => {
      if (failed) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        failed = true
        rejectBody(new Error('请求体太大'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (failed) return
      if (chunks.length === 0) {
        resolveBody({})
        return
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        rejectBody(new Error('请求体不是 JSON'))
      }
    })
    req.on('error', rejectBody)
  })
}

// ---------------------------------------------------------------- helpers

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

function stamp(now = new Date()) {
  return (
    now.getFullYear() +
    '-' +
    pad(now.getMonth() + 1) +
    '-' +
    pad(now.getDate()) +
    ' ' +
    pad(now.getHours()) +
    ':' +
    pad(now.getMinutes())
  )
}

function fileStamp(now = new Date()) {
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  )
}

const MARKS = { ok: '✓', no: '✗' }

/** 把提交结果排成一份人能读的 markdown（Agent 直接读这一份就够）。 */
function toMarkdown(result, at) {
  const items = Array.isArray(result.items) ? result.items : []
  const lines = ['# ' + (result.title || '验收表结果') + '（' + at + '）', '']
  // 正向项算「通过率」，反向项算「可信度」—— 两个数分开算（用户 2026-11-05 定）。
  const forward = items.filter((item) => item && item.reverse !== true)
  const reverse = items.filter((item) => item && item.reverse === true)
  const passed = forward.filter((item) => item.verdict === 'ok').length
  const failed = forward.filter((item) => item.verdict === 'no').length
  const skipped = forward.length - passed - failed
  lines.push(
    '> 通过 ' + passed + ' / ' + forward.length +
      ' · 不通过 ' + failed +
      ' · 未验 ' + skipped +
      (reverse.length > 0 ? ' · 反向项 ' + reverse.length + ' 条（测谎，不计入通过率）' : ''),
  )
  // 可信度：正向全 ✓ 且反向也 ✓ → 自相矛盾，可能没读题
  const allForwardOk = forward.length > 0 && forward.every((item) => item.verdict === 'ok')
  const anyReverseOk = reverse.some((item) => item.verdict === 'ok')
  if (allForwardOk && anyReverseOk) {
    lines.push('> ⚠️ **答案可能未细读**：正向全通过、反向项也勾了 —— 两者自相矛盾。')
  } else if (reverse.length > 0) {
    lines.push('> ✅ 答案可信：正向与反向没有自相矛盾。')
  }
  lines.push('')
  if (items.length > 0) {
    lines.push('## 验收项')
    for (const item of items) {
      const mark = MARKS[item && item.verdict] || '（未验）'
      const note = typeof item.note === 'string' ? item.note.trim() : ''
      lines.push('- ' + mark + ' ' + (item.name || '（无名项）') + (note ? ' —— ' + note : ''))
    }
    lines.push('')
  }
  const sections = [
    ['① 评论区', result.comment],
    ['② 优化区', result.improve],
    ['③ 话痨区', result.chat],
  ]
  for (const [title, text] of sections) {
    const body = typeof text === 'string' ? text.trim() : ''
    if (body !== '') {
      lines.push('## ' + title)
      lines.push(body)
      lines.push('')
    }
  }
  const images = Array.isArray(result.images) ? result.images : []
  if (images.length > 0) {
    lines.push('## 图片')
    for (const image of images) {
      // 链接一律用 `/`：markdown 里 `\_` 会被当成转义，反斜杠路径会把下划线吃掉。
      const slash = String(image.path || '').replace(/\\/g, '/')
      const label = image.from ? '（' + image.from + '）' : ''
      lines.push('- ![](' + slash + ')' + label)
      lines.push('  `' + slash + '`')
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function saveResult(outDir, result) {
  const now = new Date()
  const at = stamp(now)
  const base = fileStamp(now)
  await mkdir(outDir, { recursive: true })
  const images = await saveImages(outDir, result.images, base)
  const jsonPath = join(outDir, base + '.json')
  const mdPath = join(outDir, base + '.md')
  const record = {
    ...result,
    images,
    submittedAt: at,
    submittedAtIso: now.toISOString(),
  }
  delete record.imagesRaw
  await writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf8')
  const markdown = toMarkdown(record, at)
  await writeFile(mdPath, markdown, 'utf8')
  // `latest` 是给 Agent 的固定读点：永远指向最近一次提交。
  await writeFile(join(outDir, 'latest.json'), JSON.stringify(record, null, 2), 'utf8')
  await writeFile(join(outDir, 'latest.md'), markdown, 'utf8')
  return { jsonPath, mdPath, at, images: images.length }
}

// ---------------------------------------------------------------- plugin

export const name = 'dsh-fou'

/** 所有路由都走这里，且任何异常都不让它冒到启动流程。
 *
 * 头校验只针对**写**（POST）：浏览器从地址栏打开发来的 GET 带不了自定义头，
 * 若连 GET 也挡，页面自己就加载不了。跨源写依然被挡 —— 带自定义头的跨源请求
 * 会先触发 CORS 预检，而这里不发放行头。
 */
function guarded(operation) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.headers[HEADER] === undefined) {
      sendJSON(res, 405, { error: '缺少 ' + HEADER + ' 头' })
      return
    }
    try {
      await operation(req, res)
    } catch (error) {
      sendJSON(res, 500, { error: String((error && error.message) || error) })
    }
  }
}

export function apply(ctx, config) {
  const configured = config && typeof config.outDir === 'string' ? config.outDir.trim() : ''
  const outDir = resolve(configured || DEFAULT_OUT)
  let version = '0.1.0'
  try {
    version = ctx.root.package.version
  } catch (error) {
    /* 版本拿不到不影响路由 */
  }

  ctx.inject(['webServer'], (scoped) => {
    const routes = [
      [
        ROUTES.accept,
        // 同一个路径吃 GET（给页面）和 POST（收结果）—— 同源，页面才能写回来。
        async (req, res) => {
          if (req.method === 'GET') {
            let html
            try {
              html = await readFile(TABLE_FILE, 'utf8')
            } catch (error) {
              sendHTML(res, 500, '<h1>验收表页面缺失</h1><p>找不到 ' + TABLE_FILE + '</p>')
              return
            }
            sendHTML(res, 200, html)
            return
          }
          if (req.method !== 'POST') {
            sendJSON(res, 405, { error: '只支持 GET / POST' })
            return
          }
          const body = await readJSONBody(req)
          const saved = await saveResult(outDir, body)
          sendJSON(res, 200, { ok: true, ...saved })
        },
      ],
      [
        ROUTES.sheets,
        async (req, res) => {
          if (req.method !== 'GET') {
            sendJSON(res, 405, { error: '只支持 GET' })
            return
          }
          sendJSON(res, 200, { ok: true, dir: sheetDir(outDir), sheets: await listSheets(outDir) })
        },
      ],
      [
        ROUTES.sheet,
        async (req, res) => {
          if (req.method !== 'GET') {
            sendJSON(res, 405, { error: '只支持 GET' })
            return
          }
          const url = new URL(req.url, 'http://localhost')
          try {
            sendJSON(res, 200, { ok: true, sheet: await readSheet(outDir, url.searchParams.get('id') || '') })
          } catch (error) {
            sendJSON(res, 404, { error: String((error && error.message) || error) })
          }
        },
      ],
      [
        ROUTES.draft,
        async (req, res) => {
          if (req.method !== 'POST') {
            sendJSON(res, 405, { error: '只支持 POST' })
            return
          }
          const body = await readJSONBody(req)
          const saved = await saveDraft(outDir, body)
          sendJSON(res, saved.conflict ? 409 : 200, { ok: !saved.conflict, ...saved })
        },
      ],
      [
        ROUTES.commit,
        async (req, res) => {
          if (req.method !== 'POST') {
            sendJSON(res, 405, { error: '只支持 POST' })
            return
          }
          const body = await readJSONBody(req)
          sendJSON(res, 200, { ok: true, doc: await commitDoc(outDir, body) })
        },
      ],
      [
        ROUTES.view,
        async (req, res) => {
          if (req.method !== 'GET') {
            sendJSON(res, 405, { error: '只支持 GET' })
            return
          }
          try {
            sendHTML(res, 200, await readFile(VIEW_FILE, 'utf8'))
          } catch (error) {
            sendHTML(res, 500, '<h1>查看页缺失</h1><p>' + VIEW_FILE + '</p>')
          }
        },
      ],
      [
        ROUTES.editor,
        async (req, res) => {
          if (req.method !== 'GET') {
            sendJSON(res, 405, { error: '只支持 GET' })
            return
          }
          try {
            sendHTML(res, 200, await readFile(EDITOR_FILE, 'utf8'))
          } catch (error) {
            sendHTML(res, 500, '<h1>编辑器页面缺失</h1><p>' + EDITOR_FILE + '</p>')
          }
        },
      ],
      [
        ROUTES.panelsPage,
        async (req, res) => {
          if (req.method !== 'GET') {
            sendJSON(res, 405, { error: '只支持 GET' })
            return
          }
          try {
            sendHTML(res, 200, await readFile(PANELS_FILE, 'utf8'))
          } catch (error) {
            sendHTML(res, 500, '<h1>挂板页面缺失</h1><p>' + PANELS_FILE + '</p>')
          }
        },
      ],
      [
        ROUTES.panels,
        async (req, res) => {
          if (req.method !== 'GET') {
            sendJSON(res, 405, { error: '只支持 GET' })
            return
          }
          sendJSON(res, 200, { ok: true, dir: panelDir(outDir), panels: await readPanelIndex(outDir) })
        },
      ],
      [
        ROUTES.panel,
        async (req, res) => {
          if (req.method !== 'GET') {
            sendJSON(res, 405, { error: '只支持 GET' })
            return
          }
          const url = new URL(req.url, 'http://localhost')
          const id = url.searchParams.get('id') || ''
          try {
            const found = await readPanel(outDir, id)
            // ?raw=1 → 直接把内容吐出来（html 给 iframe 用，其它给纯文本）
            if (url.searchParams.get('raw') === '1') {
              if (found.meta.kind === 'html') {
                sendHTML(res, 200, found.content)
              } else {
                res.writeHead(200, {
                  'content-type': 'text/plain; charset=utf-8',
                  'content-length': Buffer.byteLength(found.content),
                  'cache-control': 'no-store',
                })
                res.end(found.content)
              }
              return
            }
            sendJSON(res, 200, { ok: true, ...found })
          } catch (error) {
            sendJSON(res, 404, { error: String((error && error.message) || error) })
          }
        },
      ],
      [
        ROUTES.hang,
        async (req, res) => {
          if (req.method !== 'POST') {
            sendJSON(res, 405, { error: '只支持 POST' })
            return
          }
          const body = await readJSONBody(req)
          sendJSON(res, 200, { ok: true, panel: await hangPanel(outDir, body) })
        },
      ],
      [
        ROUTES.health,
        async (req, res) => {
          if (req.method !== 'GET') {
            sendJSON(res, 405, { error: '只支持 GET' })
            return
          }
          let outDirExists = false
          try {
            outDirExists = (await stat(outDir)).isDirectory()
          } catch (error) {
            outDirExists = false
          }
          sendJSON(res, 200, { ok: true, version, outDir, outDirExists })
        },
      ],
    ]

    for (const [path, handler] of routes) {
      try {
        scoped.effect(
          () => scoped.webServer.register({ kind: 'exact', path, handler: guarded(handler) }),
          'dsh-fou: ' + path,
        )
      } catch (error) {
        // 路由注册失败不能让整个宿主启动失败 —— 浮游的界面照常可用。
        console.error('[dsh-fou] 路由注册失败：' + path, error)
      }
    }
  })
}
