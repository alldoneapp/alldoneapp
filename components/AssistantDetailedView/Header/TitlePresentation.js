import React from 'react'
import { StyleSheet } from 'react-native'
import styles, { colors } from '../../styles/global'
import CommentElementsParser from '../../Feeds/TextParser/CommentElementsParser'
import DvTitleLayout from '../../UIComponents/DvTitleLayout'
import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'

export default function TitlePresentation({ openTitleEdition, assistant, disabled, hideLastEdited, maxHeight }) {
    const { displayName, lastEditionDate, lastEditorId } = assistant
    const editor = getUserPresentationData(lastEditorId)

    return (
        <DvTitleLayout
            onPress={openTitleEdition}
            disabled={disabled}
            typeLabel="Assistant"
            typeIcon="cpu"
            lastEditionDate={lastEditionDate}
            editorName={editor.displayName}
            shortEditorName={editor.shortName}
            hideLastEdited={hideLastEdited}
            maxHeight={maxHeight}
        >
            <CommentElementsParser
                comment={displayName}
                entryStyle={localStyles.text}
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
