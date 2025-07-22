import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../../styles/global'
import Icon from '../../Icon'
import ChatIndicator from '../../ChatsView/ChatIndicator'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import { PROJECT_TYPE_SHARED } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'
import TasksAmount from './SectionItems/TasksAmount'
import ChatsAmount from './SectionItems/ChatsAmount'
import { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function SectionItemLayoutHeader({
    icon,
    text,
    onPress,
    selected,
    lowSelected,
    projectColor,
    inTasks,
    projectId,
    projectSelected,
    inAllProjects,
    inChats,
}) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const { expanded } = useCollapsibleSidebar()
    const { hover, onHover, offHover } = useOnHover()

    const theme = getTheme(
        Themes,
        themeName,
        'CustomSideMenu.ProjectList.ProjectItem.ProjectSectionList.ProjectSectionItem.SectionItemLayout'
    )

    const isShared = selectedTypeOfProject === PROJECT_TYPE_SHARED && checkIfSelectedProject(selectedProjectIndex)

    return (
        <TouchableOpacity onPress={onPress} accessible={false} disabled={isShared}>
            <View
                style={[
                    localStyles.container,
                    selected ? theme.containerActive(projectColor) : theme.container(projectColor),
                    !expanded && localStyles.containerCollapsed,
                    !selected && !lowSelected && hover && theme.containerActive(projectColor),
                    lowSelected && theme.containerSelected(projectColor),
                ]}
                onMouseEnter={onHover}
                onMouseLeave={offHover}
            >
                <View style={localStyles.innerContainer}>
                    <Icon
                        size={20}
                        name={icon}
                        color={selected || lowSelected ? theme.iconActive : theme.icon}
                        style={{ marginRight: 10 }}
                    />
                    {expanded && (
                        <Text
                            style={[localStyles.text, selected || lowSelected ? theme.textActive : theme.text]}
                            numberOfLines={1}
                        >
                            {text}
                        </Text>
                    )}
                </View>

                <View style={expanded ? localStyles.tasksAmountContainer : localStyles.tasksAmountCollapsed}>
                    <>
                        {inChats && <ChatsAmount inAllProjects={inAllProjects} projectId={projectId} />}
                        {inTasks && (
                            <TasksAmount
                                projectId={projectId}
                                projectSelected={projectSelected}
                                selected={selected}
                                lowSelected={lowSelected}
                            />
                        )}
                    </>
                </View>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'space-between',
        flexDirection: 'row',
        paddingLeft: 26,
        height: 48,
        minHeight: 48,
        maxHeight: 48,
    },
    containerCollapsed: {
        paddingLeft: 18,
    },
    innerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    tasksAmountContainer: {
        flexDirection: 'row',
        paddingRight: 24,
    },
    tasksAmountCollapsed: {
        top: 3,
        right: 9,
        position: 'absolute',
        flexDirection: 'row',
    },
    text: {
        ...styles.body2,
    },
})
