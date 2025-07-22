import React, { useRef } from 'react'
import { View } from 'react-native'
import ProjectHeader from '../Common/ProjectHeader'
import MentionsItems from '../../../Feeds/CommentsTextInput/MentionsModal/MentionsItems'
import { goToObjectDetailView } from '../../searchFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { getDvMainTabLink } from '../../../../utils/LinkingHelper'

export default function ChatsByProject({ project, chats, activeTab, activeItemIndex, activeItemRef }) {
    const itemsComponentsRefs = useRef([])

    const goToDetailView = chat => {
        const { inactive, projectType } = ProjectHelper.checkIfProjectIdBelongsToInactiveProject(project.id)
        if (inactive) {
            const url = getDvMainTabLink(project.id, chat.id, 'chats')
            ProjectHelper.navigateToInactiveProject(projectType, url)
        } else {
            goToObjectDetailView(project.id, chat.id, 'chats', 'chat')
        }
    }
    return chats.length > 0 ? (
        <View>
            <ProjectHeader project={project} amount={chats.length} />

            <View style={{ marginHorizontal: -8 }}>
                <MentionsItems
                    selectItemToMention={goToDetailView}
                    items={chats}
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
