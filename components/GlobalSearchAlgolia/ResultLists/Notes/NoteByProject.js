import React, { useRef } from 'react'
import { View } from 'react-native'
import ProjectHeader from '../Common/ProjectHeader'
import MentionsItems from '../../../Feeds/CommentsTextInput/MentionsModal/MentionsItems'
import { convertNoteObjectType, goToObjectDetailView, goToObjectNoteView } from '../../searchFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function NoteByProject({ project, notes, activeTab, activeItemIndex, activeItemRef }) {
    const itemsComponentsRefs = useRef([])

    const goToDetailView = note => {
        const { parentObject } = note
        const { inactive, projectType } = ProjectHelper.checkIfProjectIdBelongsToInactiveProject(project.id)
        if (inactive) {
            const url = parentObject
                ? `/projects/${project.id}/${convertNoteObjectType(parentObject.type)}/${parentObject.id}/note`
                : `/projects/${project.id}/notes/${note.id}/editor`
            ProjectHelper.navigateToInactiveProject(projectType, url)
        } else {
            parentObject
                ? goToObjectNoteView(project.id, parentObject)
                : goToObjectDetailView(project.id, note.id, 'notes', 'note')
        }
    }

    return notes.length > 0 ? (
        <View>
            <ProjectHeader project={project} amount={notes.length} />

            <View style={{ marginHorizontal: -8 }}>
                <MentionsItems
                    selectItemToMention={goToDetailView}
                    items={notes}
                    activeItemIndex={activeItemIndex}
                    itemsComponentsRefs={itemsComponentsRefs}
                    projectId={project.id}
                    activeTab={activeTab}
                    activeItemRef={activeItemRef}
                    externalContainerStyle={{ paddingHorizontal: 16 }}
                />
            </View>
        </View>
    ) : null
}
