export interface ParsedStyleRule {
  selector: string
  specificity: [number, number, number]
  order: number
  declarations: Record<string, string>
}

/**
 * Splits a declaration block on ';', then each part at the FIRST ':'.
 * Trims property and value, skips empty/invalid parts, strips trailing
 * `!important`. Properties are NOT lowercased — callers compare
 * case-insensitively.
 */
function parseDeclarations(text: string): Record<string, string> {
  const declarations: Record<string, string> = {}
  for (const part of text.split(';')) {
    const colonIdx = part.indexOf(':')
    if (colonIdx === -1) continue
    const property = part.slice(0, colonIdx).trim()
    if (!property) continue
    let value = part.slice(colonIdx + 1).trim()
    if (!value) continue
    value = value.replace(/\s*!\s*important\s*$/i, '')
    declarations[property] = value
  }
  return declarations
}

export function parseStyleAttr(style: string | undefined): Record<string, string> {
  if (!style) return {}
  return parseDeclarations(style)
}

/**
 * Splits a comma-separated selector list on commas that are NOT inside
 * parentheses or brackets (so `:not(.a, .b)` stays one selector).
 */
function splitSelectors(selectorText: string): string[] {
  const parts: string[] = []
  let current = ''
  let parenDepth = 0
  let bracketDepth = 0
  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText.charAt(i)
    if (ch === '(') parenDepth++
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (ch === '[') bracketDepth++
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      const part = current.trim()
      if (part) parts.push(part)
      current = ''
      continue
    }
    current += ch
  }
  const last = current.trim()
  if (last) parts.push(last)
  return parts
}

export function parseStyleSheet(cssText: string): ParsedStyleRule[] {
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: ParsedStyleRule[] = []
  let order = 0
  let pos = 0
  while (pos < text.length) {
    const openIdx = text.indexOf('{', pos)
    if (openIdx === -1) break
    const selectorText = text.slice(pos, openIdx).trim()
    // Match the outermost '{' ... '}' pair, tracking nested braces so
    // values like url("#a{b}") are consumed entirely.
    let depth = 1
    let i = openIdx + 1
    while (i < text.length && depth > 0) {
      const ch = text.charAt(i)
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    if (depth > 0) break // unbalanced braces — stop scanning
    const declarationText = text.slice(openIdx + 1, i - 1)
    if (selectorText) {
      const declarations = parseDeclarations(declarationText)
      for (const selector of splitSelectors(selectorText)) {
        rules.push({ selector, specificity: computeSpecificity(selector), order, declarations })
      }
      order++
    }
    pos = i
  }
  return rules
}

export function computeSpecificity(selector: string): [number, number, number] {
  if (!selector) return [0, 0, 0]
  // Ignore attribute selectors and pseudo-classes, then count the rest.
  const cleaned = selector.replace(/\[[^\]]*\]/g, '').replace(/::?[a-zA-Z-]+(?:\([^)]*\))?/g, '')
  const idCount = (cleaned.match(/#/g) || []).length
  const classCount = (cleaned.match(/\./g) || []).length
  // Tags are identifier runs not introduced by '#' or '.', excluding '*'.
  const tagCount = (cleaned.match(/(?<![.#])(?![0-9-])[a-zA-Z0-9_-]+/g) || []).length
  return [idCount, classCount, tagCount]
}

const SUPPORTED_STYLE_PROPERTIES = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-opacity',
  'fill-opacity',
  'fill-rule',
  'opacity',
  'color',
  'display',
  'visibility',
  'stop-color',
  'stop-opacity',
])

export function isStylePropertySupported(property: string): boolean {
  return SUPPORTED_STYLE_PROPERTIES.has(property.trim().toLowerCase())
}
