// Be tolerant of compact delimiter cells emitted by assistants (for example `--:`),
// while still requiring a delimiter-only cell rather than arbitrary pipe-delimited text.
const REGEX_TABLE_SEPARATOR_CELL = /^:?-{2,}:?$/
const TABLE_CELL_MIN_WIDTH = 96
const TABLE_CELL_MAX_WIDTH = 360
const TABLE_CELL_CHARACTER_WIDTH = 9
const TABLE_CELL_HORIZONTAL_PADDING = 32

const hasUnescapedPipe = line => {
    let backslashCount = 0

    for (let i = 0; i < line.length; i++) {
        const char = line[i]

        if (char === '\\') {
            backslashCount += 1
        } else {
            if (char === '|' && backslashCount % 2 === 0) {
                return true
            }
            backslashCount = 0
        }
    }

    return false
}

const endsWithUnescapedPipe = line => {
    const trimmed = line.trim()
    if (!trimmed.endsWith('|')) return false

    let backslashCount = 0
    for (let i = trimmed.length - 2; i >= 0 && trimmed[i] === '\\'; i--) {
        backslashCount += 1
    }
    return backslashCount % 2 === 0
}

const trimOuterTablePipes = line => {
    let trimmed = line.trim()

    if (trimmed.startsWith('|')) {
        trimmed = trimmed.substring(1)
    }
    if (endsWithUnescapedPipe(trimmed)) {
        trimmed = trimmed.substring(0, trimmed.length - 1)
    }

    return trimmed
}

export const splitMarkdownTableRow = line => {
    const row = trimOuterTablePipes(line)
    const cells = []
    let cell = ''

    for (let i = 0; i < row.length; i++) {
        const char = row[i]
        const nextChar = row[i + 1]

        if (char === '\\' && nextChar === '|') {
            cell += '|'
            i += 1
        } else if (char === '|') {
            cells.push(cell.trim())
            cell = ''
        } else {
            cell += char
        }
    }

    cells.push(cell.trim())
    return cells
}

const parseTableRow = line => {
    if (!hasUnescapedPipe(line)) return null

    const cells = splitMarkdownTableRow(line)
    return cells.length > 1 ? cells : null
}

const parseTableAlignments = line => {
    const cells = parseTableRow(line)
    if (!cells || cells.length < 2) return null

    const alignments = []

    for (const cell of cells) {
        const trimmed = cell.trim()
        if (!REGEX_TABLE_SEPARATOR_CELL.test(trimmed)) {
            return null
        }

        const isLeftAligned = trimmed.startsWith(':')
        const isRightAligned = trimmed.endsWith(':')
        alignments.push(
            isLeftAligned && isRightAligned ? 'center' : isRightAligned ? 'right' : isLeftAligned ? 'left' : null
        )
    }

    return alignments
}

const normalizeTableRow = (row, columnCount) => {
    const normalized = row.slice(0, columnCount)
    while (normalized.length < columnCount) {
        normalized.push('')
    }
    return normalized
}

export const getMarkdownTableAt = (lines, startIndex) => {
    if (startIndex + 1 >= lines.length) return null

    const headerCells = parseTableRow(lines[startIndex])
    const alignments = parseTableAlignments(lines[startIndex + 1])
    if (!headerCells || !alignments) return null

    const columnCount = Math.max(headerCells.length, alignments.length)
    const rows = [normalizeTableRow(headerCells, columnCount)]
    let endIndex = startIndex + 1

    for (let lineIndex = startIndex + 2; lineIndex < lines.length; lineIndex++) {
        const rowCells = parseTableRow(lines[lineIndex])

        if (!rowCells || parseTableAlignments(lines[lineIndex])) {
            break
        }

        rows.push(normalizeTableRow(rowCells, columnCount))
        endIndex = lineIndex
    }

    return {
        type: 'table',
        rows,
        alignments: normalizeTableRow(alignments, columnCount),
        endIndex,
    }
}

export const findMarkdownTable = lines => {
    for (let i = 0; i < lines.length - 1; i++) {
        if (getMarkdownTableAt(lines, i)) {
            return true
        }
    }
    return false
}

export const getMarkdownTableColumnWidths = rows => {
    if (!Array.isArray(rows) || rows.length === 0) return []

    const columnCount = Math.max(...rows.map(row => row.length))
    const widths = []

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const maxCharacters = rows.reduce((max, row) => {
            const cell = row[columnIndex] || ''
            return Math.max(max, cell.length)
        }, 0)
        const calculatedWidth = maxCharacters * TABLE_CELL_CHARACTER_WIDTH + TABLE_CELL_HORIZONTAL_PADDING
        widths.push(Math.max(TABLE_CELL_MIN_WIDTH, Math.min(TABLE_CELL_MAX_WIDTH, calculatedWidth)))
    }

    return widths
}
