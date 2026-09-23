import React from 'react'
import { StyleSheet } from 'react-native'
import styles, { colors } from '../../styles/global'
import CommentElementsParser from '../../Feeds/TextParser/CommentElementsParser'
import DvTitleLayout from '../../UIComponents/DvTitleLayout'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function NoteTitlePresentation({ openTitleEdition, note, projectId, disabled = false, hideLastEdited }) {
    const { extendedTitle, lastEditionDate, lastEditorId } = note
    const { displayName } = getUserPresentationDataInProject(projectId, lastEditorId)

    return (
        <DvTitleLayout
            onPress={openTitleEdition}
            disabled={disabled}
            typeLabel="NOTE"
            typeIcon="file-text"
            lastEditionDate={lastEditionDate}
            editorName={displayName}
            shortEditorName={displayName.split(' ')[0]}
            hideLastEdited={hideLastEdited}
        >
            <CommentElementsParser
                comment={extendedTitle}
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
