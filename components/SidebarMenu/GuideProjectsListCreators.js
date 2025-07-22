import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import v4 from 'uuid/v4'

import ProjectList from './ProjectList'
import { PROJECT_TYPE_GUIDE } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { unwatch, watchGuides } from '../../utils/backends/firestore'
import { checkIfUserIsGuideAdmin } from '../Guides/guidesHelper'

import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { translate } from '../../i18n/TranslationService'
import styles from '../styles/global'
import Icon from '../Icon'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'

export default function GuideProjectsListCreators({ navigation }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const activeGuideId = useSelector(state => state.activeGuideId)
    const amountOfLoggedProjects = useSelector(state => state.loggedUserProjects.length)
    const [guides, setGuides] = useState([])
    const [showGuides, setShowGuides] = useState(!!activeGuideId)

    const { expanded } = useCollapsibleSidebar()

    const theme = getTheme(Themes, loggedUser.themeName, 'CustomSideMenu.GuideProjects')

    const sortedProjectsData = ProjectHelper.sortProjects(guides, loggedUserId).map((project, index) => {
        if (checkIfUserIsGuideAdmin(loggedUser)) {
            if (activeGuideId === project.id)
                return { ...project, index: ProjectHelper.getProjectById(project.id).index }
            return { ...project, index: amountOfLoggedProjects + index }
        } else {
            return { ...project, index: ProjectHelper.getProjectById(project.id).index }
        }
    })

    useEffect(() => {
        if (showGuides) {
            const watcherKey = v4()
            watchGuides(loggedUserId, watcherKey, setGuides)
            return () => {
                unwatch(watcherKey)
                setGuides([])
            }
        }
    }, [showGuides])

    const toogleGuidesList = () => {
        setShowGuides(state => !state)
    }

    return (
        <View>
            <TouchableOpacity
                onPress={toogleGuidesList}
                style={[localStyles.titleContainer, !expanded ? { paddingLeft: 18 } : null]}
            >
                {expanded ? (
                    <Text style={[localStyles.text, theme.text]}>{translate('Creator Communities')}</Text>
                ) : (
                    <Icon name={'map'} color={theme.text.color} size={20} />
                )}
            </TouchableOpacity>
            {!!showGuides && (
                <ProjectList
                    projectsData={sortedProjectsData}
                    projectType={PROJECT_TYPE_GUIDE}
                    navigation={navigation}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 32,
        paddingLeft: 24,
        paddingBottom: 4,
        marginTop: 32,
        alignItems: 'center',
    },
    text: {
        ...styles.body1,
    },
})
