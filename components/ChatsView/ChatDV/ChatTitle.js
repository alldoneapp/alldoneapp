import React from 'react'
import { StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'
import styles, { colors } from '../../styles/global'
import CommentElementsParser from '../../Feeds/TextParser/CommentElementsParser'
import DvTitleLayout from '../../UIComponents/DvTitleLayout'
import useGetUserPresentationData from '../../ContactsView/Utils/useGetUserPresentationData'

export default function ChatTitle({ openTitleEdition, title, projectId, chat, disabled, hideLastEdited, maxHeight }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const editor = useGetUserPresentationData(!disabled && !hideLastEdited && !mobile ? chat.lastEditorId : null)

    return (
        <DvTitleLayout
            onPress={openTitleEdition}
            disabled={disabled}
            typeLabel="TOPIC"
            typeIcon="comments-thread"
            lastEditionDate={chat.lastEditionDate}
            editorName={editor.displayName}
            shortEditorName={editor.displayName?.split(' ')[0]}
            hideLastEdited={hideLastEdited}
            maxHeight={maxHeight}
        >
            <CommentElementsParser
                comment={title}
                entryStyle={localStyles.text}
                projectId={projectId}
                elementSpace={{ marginRight: 4 }}
                inDetaliedView={true}
            />
        </DvTitleLayout>
    )
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.title4,
        color: colors.Text01,
    },
})
