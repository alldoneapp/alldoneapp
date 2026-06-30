export const shouldProcessObjectLinkSnapshot = (objectData, metadata) => {
    return objectData != null || metadata?.fromCache !== true
}
