import React, { useRef } from 'react'
import { View } from 'react-native'

import ProjectHeader from '../Common/ProjectHeader'
import MentionsContacts from '../../../Feeds/CommentsTextInput/MentionsModal/MentionsContacts'
import { goToObjectDetailView } from '../../searchFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { getDvMainTabLink } from '../../../../utils/LinkingHelper'

export default function ContactByProject({ project, contacts, activeItemIndex, activeItemRef }) {
    const itemsComponentsRefs = useRef([])

    const goToDetailView = contact => {
        const { inactive, projectType } = ProjectHelper.checkIfProjectIdBelongsToInactiveProject(project.id)
        if (inactive) {
            const url = getDvMainTabLink(project.id, contact.uid, contact.recorderUserId ? 'contacts' : 'users')
            ProjectHelper.navigateToInactiveProject(projectType, url)
        } else {
            goToObjectDetailView(project.id, contact.uid, 'contacts', 'people')
        }
    }

    return contacts.length > 0 ? (
        <View>
            <ProjectHeader project={project} amount={contacts.length} />

            <View style={{ marginHorizontal: -8 }}>
                <MentionsContacts
                    projectId={project.id}
                    selectUserToMention={goToDetailView}
                    users={contacts}
                    activeUserIndex={activeItemIndex}
                    usersComponentsRefs={itemsComponentsRefs}
                    activeItemRef={activeItemRef}
                    externalContainerStyle={{ paddingHorizontal: 16 }}
                />
            </View>
        </View>
    ) : null
}
