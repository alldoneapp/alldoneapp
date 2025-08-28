import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import EditNote from '../NotesView/EditNote'
import DismissibleItem from '../UIComponents/DismissibleItem'
import AddItem from './AddItem'
import BacklinksHeader from './BacklinksHeader'
import BacklinksList from './BacklinksList'
import { useDispatch, useSelector } from 'react-redux'
import SharedHelper from '../../utils/SharedHelper'
import URLsTasks, {
    URL_TASK_DETAILS_BACKLINKS_NOTES,
    URL_TASK_DETAILS_BACKLINKS_TASKS,
} from '../../URLSystem/Tasks/URLsTasks'
import URLsNotes, {
    URL_NOTE_DETAILS_BACKLINKS_NOTES,
    URL_NOTE_DETAILS_BACKLINKS_TASKS,
} from '../../URLSystem/Notes/URLsNotes'
import URLsContacts, {
    URL_CONTACT_DETAILS_BACKLINKS_NOTES,
    URL_CONTACT_DETAILS_BACKLINKS_TASKS,
} from '../../URLSystem/Contacts/URLsContacts'
import { setBacklinkSection } from '../../redux/actions'

import URLsGoals, {
    URL_GOAL_DETAILS_BACKLINKS_NOTES,
    URL_GOAL_DETAILS_BACKLINKS_TASKS,
} from '../../URLSystem/Goals/URLsGoals'
import {
    LINKED_OBJECT_TYPE_CONTACT,
    LINKED_OBJECT_TYPE_NOTE,
    LINKED_OBJECT_TYPE_PROJECT,
    LINKED_OBJECT_TYPE_TASK,
    LINKED_OBJECT_TYPE_GOAL,
    LINKED_OBJECT_TYPE_SKILL,
    LINKED_OBJECT_TYPE_ASSISTANT,
} from '../../utils/LinkingHelper'
import URLsProjects, {
    URL_PROJECT_DETAILS_BACKLINKS_NOTES,
    URL_PROJECT_DETAILS_BACKLINKS_TASKS,
} from '../../URLSystem/Projects/URLsProjects'
import URLsSkills, {
    URL_SKILL_DETAILS_BACKLINKS_NOTES,
    URL_SKILL_DETAILS_BACKLINKS_TASKS,
} from '../../URLSystem/Skills/URLsSkills'
import URLsAssistants, {
    URL_ASSISTANT_DETAILS_BACKLINKS_NOTES,
    URL_ASSISTANT_DETAILS_BACKLINKS_TASKS,
} from '../../URLSystem/Assistants/URLsAssistants'
import EditTask from '../TaskListView/TaskItem/EditTask'

const BacklinksView = ({ project, linkedParentObject, externalStyle, parentObject }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const backlinkSection = useSelector(state => state.backlinkSection)
    const dispatch = useDispatch()
    const currentTab = backlinkSection?.section || 'Notes'
    const [amountObj, setAmountObj] = useState({ tasks: 0, notes: 0 })
    const newItemRef = useRef(null)
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)
    const responsiveMarginStyles = mobile
        ? localStyles.containerMobile
        : isMiddleScreen
        ? localStyles.containerTablet
        : undefined

    useEffect(() => {
        writeBrowserUrl()

        return () => {
            dispatch(setBacklinkSection({ index: 0, section: 'Notes' }))
        }
    }, [])

    useEffect(() => {
        writeBrowserUrl()
    }, [backlinkSection])

    const writeBrowserUrl = () => {
        const urlData = getTargetURLData(linkedParentObject.type, currentTab)
        urlData.class.push(urlData.constant, null, project.id, linkedParentObject.id, parentObject?.title || '')
    }

    return (
        <View style={[localStyles.container, responsiveMarginStyles, externalStyle || {}]}>
            <BacklinksHeader amountObj={amountObj} linkedParentObject={linkedParentObject} />

            {accessGranted && (
                <DismissibleItem
                    ref={ref => {
                        newItemRef.current = ref
                    }}
                    defaultComponent={
                        <AddItem
                            onPress={() => {
                                newItemRef.current.toggleModal()
                            }}
                            placeholder={`Type to add new linked ${currentTab
                                .substr(0, currentTab.length - 1)
                                .toLowerCase()}`}
                        />
                    }
                    modalComponent={
                        currentTab === 'Notes' ? (
                            <EditNote
                                formType={'new'}
                                project={project}
                                projectId={project.id}
                                onCancelAction={() => {
                                    newItemRef.current.toggleModal()
                                }}
                                defaultDate={Date.now()}
                                linkedParentObject={linkedParentObject}
                            />
                        ) : (
                            <EditTask
                                adding={true}
                                projectId={project.id}
                                onCancelAction={() => {
                                    newItemRef?.current?.toggleModal()
                                }}
                                defaultDate={Date.now()}
                                linkedParentObject={linkedParentObject}
                            />
                        )
                    }
                />
            )}

            {project?.id && (
                <BacklinksList
                    listType={currentTab}
                    project={project}
                    linkedParentObject={linkedParentObject}
                    setAmountObj={setAmountObj}
                />
            )}
        </View>
    )
}

const getTargetURLData = (parentType, tab) => {
    let data = { class: '', constant: '' }
    switch (parentType) {
        case LINKED_OBJECT_TYPE_TASK:
            data.class = URLsTasks
            data.constant = tab === 'Notes' ? URL_TASK_DETAILS_BACKLINKS_NOTES : URL_TASK_DETAILS_BACKLINKS_TASKS
            return data
        case LINKED_OBJECT_TYPE_NOTE:
            data.class = URLsNotes
            data.constant = tab === 'Notes' ? URL_NOTE_DETAILS_BACKLINKS_NOTES : URL_NOTE_DETAILS_BACKLINKS_TASKS
            return data
        case LINKED_OBJECT_TYPE_CONTACT:
            data.class = URLsContacts
            data.constant = tab === 'Notes' ? URL_CONTACT_DETAILS_BACKLINKS_NOTES : URL_CONTACT_DETAILS_BACKLINKS_TASKS
            return data
        case LINKED_OBJECT_TYPE_PROJECT:
            data.class = URLsProjects
            data.constant = tab === 'Notes' ? URL_PROJECT_DETAILS_BACKLINKS_NOTES : URL_PROJECT_DETAILS_BACKLINKS_TASKS
            return data
        case LINKED_OBJECT_TYPE_GOAL:
            data.class = URLsGoals
            data.constant = tab === 'Notes' ? URL_GOAL_DETAILS_BACKLINKS_NOTES : URL_GOAL_DETAILS_BACKLINKS_TASKS
            return data
        case LINKED_OBJECT_TYPE_SKILL:
            data.class = URLsSkills
            data.constant = tab === 'Notes' ? URL_SKILL_DETAILS_BACKLINKS_NOTES : URL_SKILL_DETAILS_BACKLINKS_TASKS
            return data
        case LINKED_OBJECT_TYPE_ASSISTANT:
            data.class = URLsAssistants
            data.constant =
                tab === 'Notes' ? URL_ASSISTANT_DETAILS_BACKLINKS_NOTES : URL_ASSISTANT_DETAILS_BACKLINKS_TASKS
            return data
    }
}

export default BacklinksView

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
        flexDirection: 'column',
    },
    containerTablet: {
        marginHorizontal: 56,
    },
    containerMobile: {
        marginHorizontal: 0,
    },
})
