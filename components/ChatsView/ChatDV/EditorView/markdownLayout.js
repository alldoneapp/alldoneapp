export const MARKDOWN_HEADING_TOP_MARGIN = 16

const hasVisibleContent = line => line.type !== 'text' || line.text.trim().length > 0

export const hasContentBeforeLine = (lines, lineIndex, hasEarlierContent = false) =>
    hasEarlierContent || lines.slice(0, lineIndex).some(hasVisibleContent)
