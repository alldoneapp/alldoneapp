import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import { sortBy } from 'lodash'

import { DV_TAB_ROOT_TASKS } from '../../../../utils/TabNavigationConstants'
import UserItem from '../../Items/UserItem'
import ShowMoreButton from '../../../UIControls/ShowMoreButton'
import WorkstreamItem from '../../Items/WorkstreamItem'
import { WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'
import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import InvitePeopleWrapper from '../InvitePeople/InvitePeopleWrapper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import ContactItem from '../../Items/ContactItem'
import AssistantItem from '../../Items/AssistantItem'

export default function TasksBoards({
    projectId,
    projectColor,
    projectIndex,
    projectType,
    isShared,
    globalAssistantIds,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const numberUsersSidebar = useSelector(state => state.loggedUser.numberUsersSidebar)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const contactsInProject = useSelector(state => state.projectContacts[projectId])
    const workstreamsInProject = useSelector(state => state.projectWorkstreams[projectId])

    const contactsWithOpenTasks = contactsInProject.filter(contact => contact.openTasksAmount > 0)

    const assistantsInProject = useSelector(state => state.projectAssistants[projectId])
    const globalAssistants = useSelector(state => state.globalAssistants)

    const [pressedShowMore, setPressedShowMore] = useState(false)

    const project = ProjectHelper.getProjectById(projectId)
    const isTemplate = project.isTemplate
    const isGuideProject = !!project.parentTemplateId

    const assistants = globalAssistants
        .filter(assistant => globalAssistantIds.includes(assistant.uid))
        .concat(assistantsInProject)

    const users = sortBy(usersInProject.concat(contactsWithOpenTasks).concat(assistants).concat(workstreamsInProject), [
        user => user?.uid !== loggedUserId,
        user => (user?.lastVisitBoard?.[projectId]?.[loggedUserId] || 0) * -1,
    ])

    let numberOfUsersToShow =
        numberUsersSidebar >= users.length || numberUsersSidebar === 0 ? users.length : numberUsersSidebar

    const theme = getTheme(
        Themes,
        themeName,
        'CustomSideMenu.ProjectList.ProjectItem.ProjectSectionList.ProjectSectionItem'
    )

    const currentUserIndex = users.findIndex(user => user.uid === currentUserId)

    const contractTasks = e => {
        e?.preventDefault()
        setPressedShowMore(false)
    }
    const expandTasks = e => {
        e?.preventDefault()
        setPressedShowMore(true)
    }

    return (
        <View style={[localStyles.userList, theme.userList(projectColor)]}>
            {users.length > 0 &&
                users.map((item, index) => {
                    if (!item) return
                    const shortcut =
                        !isShared && users.length > 1
                            ? index === currentUserIndex - 1 || (index === users.length - 1 && currentUserIndex === 0)
                                ? '>'
                                : index === currentUserIndex + 1 ||
                                  (index === 0 && currentUserIndex === users.length - 1)
                                ? '<'
                                : null
                            : null

                    return (
                        (pressedShowMore || index < numberOfUsersToShow) &&
                        (!isShared || item.uid === currentUserId) &&
                        (item.uid.startsWith(WORKSTREAM_ID_PREFIX) ? (
                            <WorkstreamItem
                                key={item.uid}
                                workstream={item}
                                projectType={projectType}
                                isShared={isShared}
                                shortcut={shortcut}
                                navItem={DV_TAB_ROOT_TASKS}
                                projectId={projectId}
                                projectColor={projectColor}
                            />
                        ) : !!item.recorderUserId ? (
                            <ContactItem
                                key={item.uid}
                                contact={item}
                                projectType={projectType}
                                projectId={projectId}
                                projectColor={projectColor}
                                isShared={isShared}
                                navItem={DV_TAB_ROOT_TASKS}
                            />
                        ) : !!item.temperature ? (
                            <AssistantItem
                                key={item.uid}
                                assistant={item}
                                projectType={projectType}
                                projectId={projectId}
                                projectColor={projectColor}
                                isShared={isShared}
                                navItem={DV_TAB_ROOT_TASKS}
                            />
                        ) : (
                            <UserItem
                                key={item.uid}
                                user={item}
                                projectType={projectType}
                                isShared={isShared}
                                shortcut={shortcut}
                                navItem={DV_TAB_ROOT_TASKS}
                                showIndicator={loggedUserId === item.uid}
                                projectId={projectId}
                                projectColor={projectColor}
                                projectIndex={projectIndex}
                            />
                        ))
                    )
                })}

            {!isTemplate &&
                !isGuideProject &&
                !isShared &&
                (pressedShowMore || users.length <= numberOfUsersToShow) && (
                    <InvitePeopleWrapper projectColor={projectColor} projectIndex={projectIndex} />
                )}

            {users.length > numberOfUsersToShow && (
                <View style={theme.showMore(projectColor)}>
                    <ShowMoreButton
                        expanded={pressedShowMore}
                        contract={contractTasks}
                        expand={expandTasks}
                        style={{ opacity: 0.48 }}
                    />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    userList: {
        borderTopWidth: 2,
        borderBottomWidth: 2,
    },
})
