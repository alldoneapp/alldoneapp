// Backwards-compatible exports for callers that still use the original image-only component name.
export {
    default,
    addDroppedFilesToEditor,
    addDroppedFilesToEditor as addDroppedImagesToEditor,
    eventContainsFiles,
    getDroppedFiles,
} from './AttachmentDropZone'
