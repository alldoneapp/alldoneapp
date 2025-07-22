import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Dimensions } from 'react-native-web'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import TaskEditForm from './TaskEditForm'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import ModalHeader from '../ModalHeader'
import AssigneeArea from './AssigneeArea'
import { translate } from '../../../../i18n/TranslationService'
import ProjectFilter from '../../../GlobalSearchAlgolia/Filter/ProjectFilter'

export default function MainModal({
    projectId,
    closeModal,
    modalTitle,
    task,
    showAssigneeModal,
    showDueDate,
    showEstimation,
    showParentGoal,
    showPrivacy,
    showAssignee,
    showSelectProject,
    createTask,
    setTask,
    showMoreOptions,
    selectedProject,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [screenDimensions, setScreenDimensions] = useState(Dimensions.get('window'))
    const [mentions, setMentions] = useState([])

    const setDimensions = e => {
        setScreenDimensions(e.window)
    }

    useEffect(() => {
        Dimensions.addEventListener('change', setDimensions)
        return () => {
            Dimensions.removeEventListener('change', setDimensions)
        }
    })

    const title = modalTitle || translate('Add task')

    return (
        <View
            style={[
                localStyles.container,
                applyPopoverWidth(),
                smallScreenNavigation && { minWidth: 315 },
                { maxHeight: screenDimensions.height - 32 },
            ]}
        >
            <ModalHeader closeModal={closeModal} title={title} description="" />
            {selectedProject && (
                <ProjectFilter
                    setShowSelectProjectModal={() => {
                        showSelectProject(true)
                    }}
                    selectedProject={selectedProject}
                    containerStyle={{ marginBottom: 16, marginTop: 0, paddingLeft: 0 }}
                    text="Select project"
                />
            )}
            <AssigneeArea
                projectId={projectId}
                task={task}
                showAssignee={showAssignee}
                containerStyle={{ top: selectedProject ? 106 : 50 }}
            />
            <TaskEditForm
                projectId={projectId}
                isAssigneeVisible={showAssigneeModal}
                task={task}
                setTask={setTask}
                onSuccess={createTask}
                mentions={mentions}
                setMentions={setMentions}
                showDueDate={showDueDate}
                showPrivacy={showPrivacy}
                showEstimation={showEstimation}
                showParentGoal={showParentGoal}
                showMoreOptions={showMoreOptions}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        height: 'auto',
    },
})
