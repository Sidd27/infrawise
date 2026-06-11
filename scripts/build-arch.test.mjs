import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseSpec,
  computePositions,
  computeGroups,
  renderSVG,
  bezierPath,
} from './build-arch.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ─── fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL_YAML = `
version: 1
layout:
  nodeW: 120
  nodeH: 40
  lineH: 16
  colGap: 30
  rowGap: 16
  groupPad: 16
  groupLabelH: 24
themes:
  a: { fill: "#000", stroke: "#fff", color: "#eee" }
  b: { fill: "#111", stroke: "#aaa", color: "#ddd" }
nodes:
  N1: { label: "Node One",   theme: a, col: 0, row: 0 }
  N2: { label: "Node Two",   theme: a, col: 0, row: 1 }
  N3: { label: "Node Three", theme: b, col: 1, row: 0 }
edges:
  - { from: N1, to: N3 }
  - { from: N2, to: N3 }
`

function loadSpec(yaml = MINIMAL_YAML) {
  return parseSpec(yaml)
}

// ─── parseSpec ────────────────────────────────────────────────────────────────

describe('parseSpec', () => {
  it('parses valid YAML', () => {
    const spec = loadSpec()
    expect(spec.nodes).toBeDefined()
    expect(Object.keys(spec.nodes)).toHaveLength(3)
  })

  it('throws on missing nodes', () => {
    expect(() => parseSpec('version: 1\nthemes: {}\nlayout: {}')).toThrow('"nodes"')
  })

  it('throws on missing themes', () => {
    expect(() => parseSpec('version: 1\nnodes: {}\nlayout: {}')).toThrow('"themes"')
  })

  it('throws on unknown theme reference', () => {
    const bad = MINIMAL_YAML.replace('theme: a', 'theme: unknown')
    expect(() => parseSpec(bad)).toThrow('unknown theme "unknown"')
  })

  it('parses the real architecture.yml without error', () => {
    const yaml = readFileSync(resolve(ROOT, 'docs/architecture.yml'), 'utf8')
    expect(() => parseSpec(yaml)).not.toThrow()
  })
})

// ─── computePositions ─────────────────────────────────────────────────────────

describe('computePositions', () => {
  it('returns a position for every node', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    expect(Object.keys(pos)).toEqual(expect.arrayContaining(['N1', 'N2', 'N3']))
  })

  it('nodes in the same column share the same x', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    expect(pos.N1.x).toBe(pos.N2.x)
  })

  it('nodes in different columns have different x', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    expect(pos.N1.x).not.toBe(pos.N3.x)
    expect(pos.N3.x).toBeGreaterThan(pos.N1.x)
  })

  it('later rows have greater y than earlier rows in same column', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    expect(pos.N2.y).toBeGreaterThan(pos.N1.y)
  })

  it('two-line nodes are taller than single-line nodes', () => {
    const yaml = `
version: 1
layout:
  nodeW: 120
  nodeH: 40
  lineH: 16
  colGap: 30
  rowGap: 16
  groupPad: 16
  groupLabelH: 24
themes:
  a: { fill: "#000", stroke: "#fff", color: "#eee" }
nodes:
  SL: { label: "Single",        theme: a, col: 0, row: 0 }
  ML: { label: "Multi\\nLine",  theme: a, col: 0, row: 1, lines: 2 }
edges: []
`
    const spec = parseSpec(yaml)
    const pos  = computePositions(spec)
    expect(pos.ML.h).toBeGreaterThan(pos.SL.h)
  })

  it('cx is the horizontal centre of the node', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    for (const p of Object.values(pos)) {
      expect(p.cx).toBe(p.x + p.w / 2)
    }
  })

  it('cy is the vertical centre of the node', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    for (const p of Object.values(pos)) {
      expect(p.cy).toBe(p.y + p.h / 2)
    }
  })

  it('no two nodes in the same column overlap vertically', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    const col0 = ['N1','N2'].map(id => pos[id])
    expect(col0[0].y + col0[0].h).toBeLessThan(col0[1].y)
  })

  it('nodes at the same row in different columns share the same y (global row alignment)', () => {
    // N1 is col:0 row:0, N3 is col:1 row:0 — both row 0 → same y
    const spec = loadSpec()
    const pos  = computePositions(spec)
    expect(pos.N1.y).toBe(pos.N3.y)
  })

  it('processes real architecture.yml without overlaps in col 0', () => {
    const yaml = readFileSync(resolve(ROOT, 'docs/architecture.yml'), 'utf8')
    const spec = parseSpec(yaml)
    const pos  = computePositions(spec)
    const col0 = ['D','L','S','P','M','T','C']
    for (let i = 0; i < col0.length - 1; i++) {
      const a = pos[col0[i]], b = pos[col0[i+1]]
      expect(a.y + a.h).toBeLessThan(b.y)
    }
  })
})

// ─── computeGroups ────────────────────────────────────────────────────────────

describe('computeGroups', () => {
  const GROUPED_YAML = MINIMAL_YAML + `
groups:
  G1:
    label: "Group One"
    nodes: [N1, N2]
    stroke: "#555"
    labelColor: "#888"
`
  it('returns bounding box for a group', () => {
    const spec = parseSpec(GROUPED_YAML)
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    expect(grps.G1).toBeDefined()
    expect(grps.G1.w).toBeGreaterThan(0)
    expect(grps.G1.h).toBeGreaterThan(0)
  })

  it('group box contains all its nodes', () => {
    const spec = parseSpec(GROUPED_YAML)
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const g    = grps.G1
    for (const id of ['N1','N2']) {
      const p = pos[id]
      expect(p.x).toBeGreaterThanOrEqual(g.x)
      expect(p.y).toBeGreaterThanOrEqual(g.y)
      expect(p.x + p.w).toBeLessThanOrEqual(g.x + g.w)
      expect(p.y + p.h).toBeLessThanOrEqual(g.y + g.h)
    }
  })
})

// ─── bezierPath ───────────────────────────────────────────────────────────────

describe('bezierPath', () => {
  it('starts at the given start point', () => {
    const d = bezierPath(10, 20, 100, 60)
    expect(d).toMatch(/^M 10 20/)
  })

  it('ends at the given end point', () => {
    const d = bezierPath(10, 20, 100, 60)
    expect(d).toMatch(/100 60$/)
  })

  it('uses cubic bezier syntax (C)', () => {
    const d = bezierPath(0, 0, 100, 0)
    expect(d).toContain('C ')
  })
})

// ─── renderSVG ────────────────────────────────────────────────────────────────

describe('renderSVG', () => {
  it('returns a string starting with <svg', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const svg  = renderSVG(spec, pos, grps)
    expect(svg).toMatch(/^<svg /)
  })

  it('contains an element for each node', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const svg  = renderSVG(spec, pos, grps)
    expect(svg).toContain('data-id="N1"')
    expect(svg).toContain('data-id="N2"')
    expect(svg).toContain('data-id="N3"')
  })

  it('contains an edge path for each edge', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const svg  = renderSVG(spec, pos, grps)
    // Two edges defined: N1→N3, N2→N3
    const pathCount = (svg.match(/<path /g) ?? []).length
    expect(pathCount).toBeGreaterThanOrEqual(2)
  })

  it('includes a glow filter definition', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const svg  = renderSVG(spec, pos, grps)
    expect(svg).toContain('id="arch-glow"')
    expect(svg).toContain('feGaussianBlur')
  })

  it('respects the bg option', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const svg  = renderSVG(spec, pos, grps, { bg: 'transparent' })
    expect(svg).toContain('fill="transparent"')
  })

  it('has a viewBox attribute', () => {
    const spec = loadSpec()
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const svg  = renderSVG(spec, pos, grps)
    expect(svg).toContain('viewBox=')
  })

  it('escapes special chars in labels', () => {
    const yaml = MINIMAL_YAML.replace('Node One', 'A & B <test>')
    const spec = parseSpec(yaml)
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const svg  = renderSVG(spec, pos, grps)
    expect(svg).not.toContain('A & B <test>')
    expect(svg).toContain('&amp;')
  })

  it('renders the real architecture.yml to valid SVG', () => {
    const yaml = readFileSync(resolve(ROOT, 'docs/architecture.yml'), 'utf8')
    const spec = parseSpec(yaml)
    const pos  = computePositions(spec)
    const grps = computeGroups(spec, pos)
    const svg  = renderSVG(spec, pos, grps, { bg: 'transparent' })
    expect(svg).toMatch(/^<svg /)
    // All 14 nodes present
    for (const id of ['D','L','S','P','M','T','C','A','G','AN','CA','MCP','CC','CU','WS']) {
      expect(svg).toContain(`data-id="${id}"`)
    }
    // All 3 groups present
    for (const gid of ['IN','SV','AI']) {
      expect(svg).toContain(`data-group="${gid}"`)
    }
  })
})
