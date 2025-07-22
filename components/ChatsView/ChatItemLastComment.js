import React from 'react'
import { StyleSheet } from 'react-native'

import styles, { colors } from '../styles/global'
import SocialText from '../UIControls/SocialText/SocialText'
import useGetUserPresentationData from '../ContactsView/Utils/useGetUserPresentationData'
import { CHAT_LAST_COMMENT_PREVIEW_CHARACTER_LIMIT, shrinkTagText } from '../../functions/Utils/parseTextUtils'

export default function ChatItemLastComment({ projectId, commentOwnerId, comment }) {
    const editorData = useGetUserPresentationData(commentOwnerId)

    return (
        <SocialText
            style={localStyles.lastCommentPreview}
            textStyle={localStyles.text}
            normalStyle={{ whiteSpace: 'normal' }}
            wrapText
            numberOfLines={1}
            projectId={projectId}
        >
            {`${editorData.displayName}: ${shrinkTagText(comment, CHAT_LAST_COMMENT_PREVIEW_CHARACTER_LIMIT)}`}
        </SocialText>
    )
}

const localStyles = StyleSheet.create({
    lastCommentPreview: {
        marginTop: 6,
    },
    text: {
        ...styles.caption2,
        color: colors.Text03,
        alignItems: 'flex-start',
    },
})
