import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import v4 from 'uuid/v4'

import store from '../../redux/store'
import styles, { colors } from '../styles/global'
import NoteMoreButton from '../UIComponents/FloatModals/MorePopupsOfMainViews/Notes/NoteMoreButton'
import { ALL_PROJECTS_INDEX, checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import ChangeObjectListModal from '../UIComponents/FloatModals/ChangeObjectListModal'
import { translate } from '../../i18n/TranslationService'
import {
    unwatchNotesAmount,
    watchAllNotesAmount,
    watchFollowedNotesAmount,
} from '../../utils/backends/Notes/noteNumbers'
import { FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'

export default function NotesHeader() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const currentUser = useSelector(state => state.currentUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const notesActiveTab = useSelector(state => state.notesActiveTab)
    const loggedUserProjectsAmount = useSelector(state => state.loggedUserProjects.length)
    const archivedProjectIdsAmount = useSelector(state => state.loggedUser.archivedProjectIds.length)
    const templateProjectIdsAmount = useSelector(state => state.loggedUser.templateProjectIds.length)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [projectIds, setProjectIds] = useState([])
    const [open, setOpen] = useState(false)
    const [notesAmount, setNotesAmount] = useState(0)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    const project = inAllProjects ? ALL_PROJECTS_INDEX : loggedUserProjects[selectedProjectIndex]

    const accessGranted = !isAnonymous && (inAllProjects || (project && realProjectIds.includes(project.id)))

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
            <View style={localStyles.info}>
                <View>
                    <Popover
                        content={<ChangeObjectListModal closePopover={() => setOpen(false)} />}
                        onClickOutside={() => setOpen(false)}
                        isOpen={open}
                        position={['bottom', 'left', 'right', 'top']}
                        padding={4}
                        align={'start'}
                        contentLocation={mobile ? null : undefined}
                    >
                        <TouchableOpacity disabled={!accessGranted} accessible={false} onPress={() => setOpen(true)}>
                            <Text style={[styles.title5, { color: colors.Text01 }]}>{translate('Notes')}</Text>
                        </TouchableOpacity>
                    </Popover>
                </View>
                <View style={{ top: 2 }}>
                    <NoteMoreButton projectId={project?.id} user={currentUser} />
                </View>
                <View>
                    {notesAmount > 0 && (
                        <Text style={[styles.caption2, { color: colors.Text02 }]}>
                            {translate(notesAmount === 1 ? 'Amount note' : `Amount notes`, {
                                amount: notesAmount,
                            })}
                        </Text>
                    )}
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxHeight: 80,
        height: 80,
        minHeight: 80,
        paddingTop: 40,
        paddingBottom: 8,
    },
    info: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
})
