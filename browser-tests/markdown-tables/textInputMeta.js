// Only editor metadata is needed by quill2Setup in this isolated table harness.
// Backend-driven mentions/attachments are outside the cell editing path.
export const getPlaceholderData = () => ({ editorType: 1 })
export const isEncodedPlaceholder = () => false
export const QUILL_EDITOR_TEXT_INPUT_TYPE = 0
