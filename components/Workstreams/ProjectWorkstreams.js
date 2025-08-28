import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import store from '../../redux/store'
import { sortBy } from 'lodash'
import DismissibleItem from '../UIComponents/DismissibleItem'
import URLsProjects, { URL_PROJECT_DETAILS_WORKSTREAMS } from '../../URLSystem/Projects/URLsProjects'
import { DV_TAB_PROJECT_WORKSTREAMS, DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import { useSelector } from 'react-redux'
import ProjectWStreamHeader from './ProjectWStreamHeader'
import ProjectWorkstreamItem from './ProjectWorkstreamItem'
import AddWorkstream from './AddWorkstream'
import { dismissAllPopups, isInputsFocused } from '../../utils/HelperFunctions'
import EditWorkstream from './EditWorkstream'
import { DEFAULT_WORKSTREAM_ID, isSomeStreamEditOpen, setWorkstreamLastVisitedBoardDate } from './WorkstreamHelper'
import SharedHelper from '../../utils/SharedHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { setSelectedSidebarTab, setSelectedTypeOfProject, storeCurrentUser } from '../../redux/actions'
import NavigationService from '../../utils/NavigationService'

const ProjectWorkstreams = ({ project }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const workstreams = useSelector(state => state.projectWorkstreams[project.id])
    const projectId = project.id
    const dismissibleRefs = useRef({}).current
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const newItemRef = useRef()

    useEffect(() => {
        writeBrowserURL()
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_PROJECT_WORKSTREAMS) {
            const data = { projectId: projectId }
            URLsProjects.push(URL_PROJECT_DETAILS_WORKSTREAMS, data, projectId)
        }
    }

    const onKeyDown = e => {
        if (!store.getState().blockShortcuts && accessGranted) {
            const dismissItems = document.querySelectorAll('[aria-label="dismissible-edit-item"]')
            if (e.key === '+' && dismissItems.length === 0 && !isInputsFocused()) {
                e.preventDefault()
                e.stopPropagation()
                newItemRef?.current?.toggleModal()
            }
        }
    }

    const openDetailedView = workstream => {
        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
        setWorkstreamLastVisitedBoardDate(projectId, workstream, 'lastVisitBoard')

        store.dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            storeCurrentUser(workstream),
            setSelectedTypeOfProject(projectType),
        ])
        NavigationService.navigate('Root')
    }

    const sortedWorkstreams = sortBy(workstreams, [stream => stream.displayName.toLowerCase()])

    return (
        <View style={localStyles.container}>
            <ProjectWStreamHeader amount={sortedWorkstreams.length} />

            {accessGranted && (
                <DismissibleItem
                    ref={newItemRef}
                    defaultComponent={
                        <AddWorkstream
                            onPress={() => {
                                if (!isSomeStreamEditOpen()) {
                                    newItemRef?.current?.toggleModal()
                                    for (let key in dismissibleRefs) {
                                        dismissibleRefs[key]?.closeModal()
                                    }
                                } else {
                                    dismissAllPopups()
                                }
                            }}
                        />
                    }
                    modalComponent={
                        <EditWorkstream
                            adding={true}
                            projectId={projectId}
                            projectIndex={project.index}
                            onCancelAction={() => newItemRef?.current?.toggleModal()}
                        />
                    }
                />
            )}

            <View style={{ flex: 1 }}>
                {sortedWorkstreams.map(workstream => {
                    return workstream.uid === DEFAULT_WORKSTREAM_ID ? (
                        <ProjectWorkstreamItem
                            key={workstream.uid}
                            projectId={projectId}
                            workstream={workstream}
                            openEditModal={() => openDetailedView(workstream)}
                        />
                    ) : (
                        <DismissibleItem
                            key={workstream.uid}
                            ref={ref => (dismissibleRefs[`${workstream.uid}`] = ref)}
                            defaultComponent={
                                <ProjectWorkstreamItem
                                    projectId={projectId}
                                    workstream={workstream}
                                    openEditModal={() => {
                                        if (!isSomeStreamEditOpen()) {
                                            for (let key in dismissibleRefs) {
                                                dismissibleRefs[key]?.closeModal()
                                            }
                                            newItemRef?.current?.closeModal()
                                            dismissibleRefs[`${workstream.uid}`]?.openModal()
                                        } else {
                                            dismissAllPopups()
                                        }
                                    }}
                                />
                            }
                            modalComponent={
                                <EditWorkstream
                                    stream={workstream}
                                    projectId={projectId}
                                    projectIndex={project.index}
                                    onCancelAction={() => dismissibleRefs[`${workstream.uid}`]?.toggleModal()}
                                />
                            }
                        />
                    )
                })}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})

export default ProjectWorkstreams
