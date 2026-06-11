#!/usr/bin/env node
/**
 * build-arch.mjs
 *
 * Generates architecture SVGs from docs/architecture.yml.
 *
 * Outputs:
 *   docs/architecture.svg        — static, GitHub-compatible
 *   website/public/arch-web.svg  — same content, transparent bg (for web inline use)
 *
 * Usage:
 *   node scripts/build-arch.mjs                          # both outputs
 *   node scripts/build-arch.mjs --only github            # GitHub SVG only
 *   node scripts/build-arch.mjs --only web               # web SVG only
 *   node scripts/build-arch.mjs --input path/to/arch.yml # custom input
 *
 * Programmatic:
 *   import { buildAll } from './scripts/build-arch.mjs'
 *   buildAll('docs/architecture.yml')
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ─── layout ──────────────────────────────────────────────────────────────────

/**
 * Convert col/row indices into absolute pixel coordinates.
 * Returns a map of nodeId → { x, y, w, h, cx, cy }.
 */
export function computePositions(spec) {
  const { nodeW, nodeH, lineH, colGap, rowGap, groupPad, groupLabelH } = spec.layout

  // 1. Node dimensions
  const dims = {}
  for (const [id, node] of Object.entries(spec.nodes)) {
    const lines = node.lines ?? 1
    dims[id] = { w: nodeW, h: nodeH + (lines - 1) * lineH }
  }

  // 2. Column widths
  const colWidths = {}
  for (const [id, node] of Object.entries(spec.nodes)) {
    colWidths[node.col] = Math.max(colWidths[node.col] ?? 0, dims[id].w)
  }

  // 3. Column x positions
  const sortedCols = [...new Set(Object.values(spec.nodes).map(n => n.col))].sort((a,b)=>a-b)
  const colX = {}
  let cursorX = groupPad
  for (const c of sortedCols) {
    colX[c] = cursorX
    cursorX += colWidths[c] + colGap
  }

  // 4. GLOBAL row heights — max node height across ALL columns at that row.
  //    This ensures every row:N in any column shares the same Y coordinate,
  //    so the pipeline nodes stay vertically aligned with the source nodes.
  const globalRowH = {}
  for (const [id, node] of Object.entries(spec.nodes)) {
    globalRowH[node.row] = Math.max(globalRowH[node.row] ?? 0, dims[id].h)
  }

  // 5. Global row Y positions, starting below the group label reservation.
  const sortedRows = Object.keys(globalRowH).map(Number).sort((a,b)=>a-b)
  const rowY = {}
  let cursorY = groupPad + groupLabelH   // room for group labels at top of canvas
  for (const r of sortedRows) {
    rowY[r] = cursorY
    cursorY += globalRowH[r] + rowGap
  }

  // 6. Node positions
  const positions = {}
  for (const [id, node] of Object.entries(spec.nodes)) {
    const x = colX[node.col]
    const w = dims[id].w
    const h = dims[id].h
    const y = rowY[node.row]
    positions[id] = { x, y, w, h, cx: x + w/2, cy: y + h/2 }
  }

  return positions
}

/**
 * Compute group bounding boxes from node positions.
 */
export function computeGroups(spec, positions) {
  const { groupPad, groupLabelH } = spec.layout
  const result = {}

  for (const [gid, group] of Object.entries(spec.groups ?? {})) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of group.nodes) {
      const p = positions[id]
      if (!p) continue
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + p.w)
      maxY = Math.max(maxY, p.y + p.h)
    }
    result[gid] = {
      x: minX - groupPad,
      y: minY - groupPad - groupLabelH,
      w: maxX - minX + groupPad * 2,
      h: maxY - minY + groupPad * 2 + groupLabelH,
      label: group.label,
      stroke: group.stroke,
      labelColor: group.labelColor,
    }
  }
  return result
}

// ─── SVG primitives ───────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function nodeRect(id, pos, theme) {
  const r = 6
  const lines = pos.label?.split('\n') ?? ['']
  const lineH = 18
  const padX = 16, padY = 12
  const textY0 = pos.y + padY + 12  // first line baseline

  const textEls = lines.map((line, i) => {
    const y = textY0 + i * lineH
    return `<text x="${pos.cx}" y="${y}" text-anchor="middle" dominant-baseline="auto" fill="${theme.color}" font-size="12" font-weight="600" letter-spacing="0.06em" font-family="system-ui,sans-serif">${esc(line.toUpperCase())}</text>`
  }).join('\n    ')

  return `
  <g class="arch-node" data-id="${id}">
    <rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" rx="${r}" ry="${r}"
      fill="${theme.fill}" stroke="${theme.stroke}" stroke-width="1.5" />
    ${textEls}
  </g>`
}

function groupBox(gid, g) {
  const r = 10
  return `
  <g class="arch-group" data-group="${gid}">
    <rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="${r}" ry="${r}"
      fill="none" stroke="${g.stroke}" stroke-width="1" stroke-dasharray="4,3" />
    <text x="${g.x + 14}" y="${g.y + 18}" fill="${g.labelColor}" font-size="11" font-weight="600"
      letter-spacing="0.08em" font-family="system-ui,sans-serif">${esc(g.label.toUpperCase())}</text>
  </g>`
}

/**
 * Horizontal bezier curve from right edge of source to left edge of target.
 * Returns an SVG path `d` attribute string.
 */
export function bezierPath(x1, y1, x2, y2) {
  const dx = (x2 - x1) * 0.55
  return `M ${x1} ${y1} C ${x1+dx} ${y1} ${x2-dx} ${y2} ${x2} ${y2}`
}

function edgePath(from, to, positions, opts = {}) {
  const pf = positions[from]
  const pt = positions[to]
  if (!pf || !pt) return ''

  // Exit right edge of source, enter left edge of target
  const x1 = pf.x + pf.w, y1 = pf.cy
  const x2 = pt.x,         y2 = pt.cy
  const d  = bezierPath(x1, y1, x2, y2)
  const color      = opts.color  ?? '#818cf8'
  const filter     = opts.filter ? ` filter="url(#arch-glow)"` : ''
  const markerEnd  = ` marker-end="url(#arch-arrow)"`

  return `
  <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"${filter}${markerEnd}>
    <title>${from} → ${to}</title>
  </path>`
}

function arrowMarker(color = '#818cf8') {
  return `
  <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5"
    markerWidth="6" markerHeight="6" orient="auto">
    <path d="M0,1 L9,5 L0,9 Z" fill="${color}" />
  </marker>`
}

function glowFilter(id = 'arch-glow', blur = 3, boost = 2.5) {
  // filterUnits="userSpaceOnUse" with absolute coords — percentage-based bounds
  // collapse to 0px for horizontal paths where bounding-box height is 0.
  return `
  <filter id="${id}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="9999" height="9999" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="blur" />
    <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${boost} 0" result="glow" />
    <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`
}

// ─── main renderer ────────────────────────────────────────────────────────────

/**
 * Renders a full SVG string from a parsed + positioned spec.
 *
 * @param {object} spec        Parsed YAML
 * @param {object} positions   Output of computePositions()
 * @param {object} groupBoxes  Output of computeGroups()
 * @param {object} opts
 * @param {string}  opts.bg         Background colour; 'transparent' for web use
 * @param {boolean} opts.responsive Strip width/height attrs so CSS controls size
 */
export function renderSVG(spec, positions, groupBoxes, opts = {}) {
  const bg = opts.bg ?? 'transparent'

  // Canvas size: max x+w and max y+h across all elements
  let maxX = 0, maxY = 0
  for (const p of Object.values(positions)) {
    maxX = Math.max(maxX, p.x + p.w)
    maxY = Math.max(maxY, p.y + p.h)
  }
  for (const g of Object.values(groupBoxes)) {
    maxX = Math.max(maxX, g.x + g.w)
    maxY = Math.max(maxY, g.y + g.h)
  }
  const pad = spec.layout.groupPad
  const W = maxX + pad, H = maxY + pad

  const defs = `
<defs>
  ${arrowMarker()}
  ${glowFilter()}
</defs>`

  // Groups (behind nodes)
  const groups = Object.entries(groupBoxes)
    .map(([gid, g]) => groupBox(gid, g))
    .join('')

  // Edges — wrapped in .arch-edges so the CSS animation selector can target them
  const edges = `<g class="arch-edges">${(spec.edges ?? [])
    .map(e => edgePath(e.from, e.to, positions, { color: '#818cf8', filter: true }))
    .join('')}</g>`

  // Nodes
  const nodes = Object.entries(spec.nodes)
    .map(([id, node]) => {
      const theme = spec.themes[node.theme]
      const pos = { ...positions[id], label: node.label }
      return nodeRect(id, pos, theme)
    })
    .join('')

  const sizeAttrs = opts.responsive ? '' : ` width="${W}" height="${H}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"${sizeAttrs} role="img" aria-label="Infrawise architecture diagram">
  <title>Infrawise architecture: Your Infrastructure &amp; Code → Adapters → Graph Engine → 27 Analyzers → Cache → MCP Server → AI Coding Assistants</title>
  ${defs}
  <rect width="${W}" height="${H}" fill="${bg}" />
  ${groups}
  ${edges}
  ${nodes}
</svg>`.trim()
}

// ─── public API ───────────────────────────────────────────────────────────────

export function parseSpec(yamlContent) {
  const spec = loadYaml(yamlContent)
  if (!spec.nodes)  throw new Error('architecture.yml missing "nodes"')
  if (!spec.themes) throw new Error('architecture.yml missing "themes"')
  if (!spec.layout) throw new Error('architecture.yml missing "layout"')
  // Validate theme refs
  for (const [id, node] of Object.entries(spec.nodes)) {
    if (!spec.themes[node.theme]) throw new Error(`Node "${id}" references unknown theme "${node.theme}"`)
  }
  return spec
}

export function buildArch(inputPath, outputPath, opts = {}) {
  const yaml = readFileSync(inputPath, 'utf8')
  const spec  = parseSpec(yaml)
  const pos   = computePositions(spec)
  const grps  = computeGroups(spec, pos)
  const svg   = renderSVG(spec, pos, grps, opts)
  writeFileSync(outputPath, svg, 'utf8')
  console.log(`  build-arch: ${inputPath} → ${outputPath}`)
}

export function buildAll(inputPath = resolve(ROOT, 'docs/architecture.yml')) {
  buildArch(inputPath, resolve(ROOT, 'docs/architecture.svg'),       { bg: 'transparent' })
  buildArch(inputPath, resolve(ROOT, 'website/public/arch-web.svg'), { bg: 'transparent', responsive: true })
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const isCLI = process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('build-arch.mjs'))

if (isCLI) {
  const args = process.argv.slice(2)
  const inputArg = args.indexOf('--input')
  const onlyArg  = args.indexOf('--only')
  const input    = inputArg !== -1 ? args[inputArg + 1] : resolve(ROOT, 'docs/architecture.yml')
  const only     = onlyArg  !== -1 ? args[onlyArg  + 1] : 'both'

  try {
    if (only === 'github') {
      buildArch(input, resolve(ROOT, 'docs/architecture.svg'), { bg: 'transparent' })
    } else if (only === 'web') {
      buildArch(input, resolve(ROOT, 'website/public/arch-web.svg'), { bg: 'transparent' })
    } else {
      buildAll(input)
    }
  } catch (err) {
    console.error('build-arch error:', err.message)
    process.exit(1)
  }
}
