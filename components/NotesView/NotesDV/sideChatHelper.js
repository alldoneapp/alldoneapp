export const SIDE_CHAT_WIDTH_PERCENT = 0.3
export const SIDE_CHAT_MIN_WIDTH = 360
export const SIDE_CHAT_MIN_CONTENT_WIDTH = 970

export const getNoteSideChatWidth = contentWidth =>
    Math.max(contentWidth * SIDE_CHAT_WIDTH_PERCENT, SIDE_CHAT_MIN_WIDTH)

export const canShowNoteSideChat = ({ mobile, contentWidth }) => {
    return !mobile && contentWidth >= SIDE_CHAT_MIN_CONTENT_WIDTH
}

export const canOpenNoteSideChat = ({
    mobile,
    contentWidth,
    objectType,
    objectId,
    noteId,
    toolbarProjectId,
    projectId,
}) => {
    return (
        canShowNoteSideChat({ mobile, contentWidth }) &&
        objectType === 'notes' &&
        objectId === noteId &&
        toolbarProjectId === projectId
    )
}
