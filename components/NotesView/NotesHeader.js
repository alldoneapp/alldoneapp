import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import store from '../../redux/store'
import styles, { colors } from '../styles/global'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../../i18n/TranslationService'
import {
    unwatchNotesAmount,
    watchAllNotesAmount,
    watchFollowedNotesAmount,
} from '../../utils/backends/Notes/noteNumbers'
import { FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

export default function NotesHeader() {
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const notesActiveTab = useSelector(state => state.notesActiveTab)
    const loggedUserProjectsAmount = useSelector(state => state.loggedUserProjects.length)
    const archivedProjectIdsAmount = useSelector(state => state.loggedUser.archivedProjectIds.length)
    const templateProjectIdsAmount = useSelector(state => state.loggedUser.templateProjectIds.length)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const [projectIds, setProjectIds] = useState([])
    const [notesAmount, setNotesAmount] = useState(0)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    useEffect(() => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const { templateProjectIds, archivedProjectIds } = loggedUser
        const projects = loggedUserProjects.filter(
            project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
        )
        const projectIds = inAllProjects
            ? projects.map(project => project.id)
            : [loggedUserProjects[selectedProjectIndex].id]
        setProjectIds(projectIds)
    }, [loggedUserProjectsAmount, selectedProjectIndex, templateProjectIdsAmount, archivedProjectIdsAmount])

    useEffect(() => {
        const watcherKeys = projectIds.map(() => v4())
        notesActiveTab === FOLLOWED_TAB
            ? watchFollowedNotesAmount(projectIds, watcherKeys, setNotesAmount)
            : watchAllNotesAmount(projectIds, watcherKeys, setNotesAmount)
        return () => {
            unwatchNotesAmount(watcherKeys)
        }
    }, [notesActiveTab, projectIds])

    return (
        <View style={localStyles.container}>
            {notesAmount > 0 && (
                <Text style={[styles.caption2, localStyles.amountText, { color: colors.Text02 }]}>
                    {translate(notesAmount === 1 ? 'Amount note' : 'Amount notes', {
                        amount: notesAmount,
                    })}
                </Text>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    amountText: {
        textAlign: 'left',
        alignSelf: 'flex-start',
        marginTop: -8,
        paddingLeft: 12,
    },
})
