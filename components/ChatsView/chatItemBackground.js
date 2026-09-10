import { colors } from '../styles/global'

export const getChatItemBackgroundColor = (hasStar, inCommentPopup, surfaceColor = '#ffffff') =>
    inCommentPopup ? colors.Secondary200 : hasStar.toLowerCase() === '#ffffff' ? surfaceColor : hasStar
