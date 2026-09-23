import React from 'react'
import { StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import CommentElementsParser from '../../Feeds/TextParser/CommentElementsParser'
import DvTitleLayout from '../../UIComponents/DvTitleLayout'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

export default function TitlePresentation({ openTitleEdition, skill, projectId, hideLastEdited }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const isSkillsOwner = !isAnonymous && skill.userId === loggedUserId
    const { extendedName, lastEditionDate, lastEditorId } = skill
    const editor = getUserPresentationDataInProject(projectId, lastEditorId)

    return (
        <DvTitleLayout
            onPress={openTitleEdition}
            disabled={!isSkillsOwner}
            typeLabel="SKILL"
            typeIcon="star"
            lastEditionDate={lastEditionDate}
            editorName={editor.displayName}
            shortEditorName={editor.shortName?.split(' ')[0]}
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
