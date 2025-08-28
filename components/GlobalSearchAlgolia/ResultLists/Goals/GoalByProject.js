import React, { useRef } from 'react'
import { View } from 'react-native'
import ProjectHeader from '../Common/ProjectHeader'
import MentionsItems from '../../../Feeds/CommentsTextInput/MentionsModal/MentionsItems'
import { goToObjectDetailView } from '../../searchFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { getDvMainTabLink } from '../../../../utils/LinkingHelper'

export default function GoalByProject({ project, goals, activeTab, activeItemIndex, activeItemRef }) {
    const itemsComponentsRefs = useRef([])

    const goToDetailView = goal => {
        const { inactive, projectType } = ProjectHelper.checkIfProjectIdBelongsToInactiveProject(project.id)
        if (inactive) {
            const url = getDvMainTabLink(project.id, goal.id, 'goals')
            ProjectHelper.navigateToInactiveProject(projectType, url)
        } else {
            goToObjectDetailView(project.id, goal.id, 'goals', 'goal')
        }
    }

    return goals.length > 0 ? (
        <View>
            <ProjectHeader project={project} amount={goals.length} />

            <View style={{ marginHorizontal: -8 }}>
                <MentionsItems
                    selectItemToMention={goToDetailView}
                    items={goals}
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
