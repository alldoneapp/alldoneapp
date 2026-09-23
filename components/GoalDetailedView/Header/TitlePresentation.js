import React from 'react'
import { StyleSheet } from 'react-native'
import styles, { colors } from '../../styles/global'
import CommentElementsParser from '../../Feeds/TextParser/CommentElementsParser'
import DvTitleLayout from '../../UIComponents/DvTitleLayout'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function TitlePresentation({ openTitleEdition, goal, projectId, disabled = false, hideLastEdited }) {
    const { extendedName, lastEditionDate, lastEditorId } = goal
    const { displayName, shortName } = getUserPresentationDataInProject(projectId, lastEditorId)

    return (
        <DvTitleLayout
            onPress={openTitleEdition}
            disabled={disabled}
            typeLabel="GOAL"
            typeIcon="target"
            lastEditionDate={lastEditionDate}
            editorName={displayName}
            shortEditorName={shortName}
            hideLastEdited={hideLastEdited}
        >
            <CommentElementsParser
                comment={extendedName}
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
