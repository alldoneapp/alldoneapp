import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import ProjectList from './ProjectList'
import { PROJECT_TYPE_TEMPLATE } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import styles from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../hooks/UseOnHover'
import ProjectHelper, { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import AddProject from '../AddNewProject/AddProject'
import { unwatch, watchTemplates } from '../../utils/backends/firestore'

export default function TemplateProjects({ navigation, scrollToBottom }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)
    const amountOfLoggedProjects = useSelector(state => state.loggedUserProjects.length)
    const userIdsAllowedToCreateTemplates = useSelector(state => state.userIdsAllowedToCreateTemplates)
    const activeTemplateId = useSelector(state => state.activeTemplateId)

    const [templates, setTemplates] = useState([])
    const [showTemplates, setShowTemplates] = useState(!!activeTemplateId)

    const { expanded } = useCollapsibleSidebar()
    const { hover } = useOnHover()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.TemplateProjects')
    let active = checkIfSelectedProject(selectedProjectIndex) && selectedTypeOfProject === PROJECT_TYPE_TEMPLATE

    const sortedProjectsData = ProjectHelper.sortProjects(templates, loggedUserId).map((project, index) => {
        if (activeTemplateId === project.id)
            return { ...project, index: ProjectHelper.getProjectById(project.id).index }
        return { ...project, index: amountOfLoggedProjects + index }
    })

    useEffect(() => {
        if (showTemplates) {
            const watcherKey = v4()
            watchTemplates(loggedUserId, watcherKey, setTemplates)
            return () => {
                unwatch(watcherKey)
                setTemplates([])
            }
        }
    }, [showTemplates])

    const toogleTemplatesList = () => {
        setShowTemplates(state => !state)
    }

    return (
        <View>
            <View>
                <TouchableOpacity
                    style={[
                        localStyles.container,
                        !expanded && localStyles.containerCollapsed,
                        hover && theme.containerHover,
                    ]}
                    onPress={toogleTemplatesList}
                >
                    <View style={localStyles.titleContainer}>
                        <View style={localStyles.innerContainer}>
                            <Icon
                                size={22}
                                name={'map'}
                                color={active ? theme.textActive.color : theme.text.color}
                                style={{
                                    marginRight: 10,
                                    opacity: active ? theme.textActive.opacity : theme.text.opacity,
                                }}
                            />
                            {expanded && (
                                <Text style={[localStyles.text, active ? theme.textActive : theme.text]}>
                                    {translate('Templates')}
                                </Text>
                            )}
                        </View>
                    </View>
                </TouchableOpacity>
                {!!showTemplates && (
                    <>
                        <ProjectList
                            projectsData={sortedProjectsData}
                            projectType={PROJECT_TYPE_TEMPLATE}
                            navigation={navigation}
                        />
                        {userIdsAllowedToCreateTemplates.includes(loggedUserId) && (
                            <AddProject scrollToBottom={scrollToBottom} addingTemplate={true} />
                        )}
                    </>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingLeft: 24,
        justifyContent: 'center',
        height: 56,
    },
    containerCollapsed: {
        paddingLeft: 17,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    text: {
        ...styles.body1,
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
    innerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
