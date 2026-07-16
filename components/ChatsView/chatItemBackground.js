import { colors } from '../styles/global'

export const getChatItemBackgroundColor = (hasStar, inCommentPopup) =>
    inCommentPopup ? colors.Secondary200 : hasStar.toLowerCase() === '#ffffff' ? '#ffffff' : hasStar
