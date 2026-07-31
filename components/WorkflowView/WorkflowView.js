import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import WorkflowHeader from './WorkflowHeader'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import WorkflowStep from './WorkflowStep'
import AddNewStep from './AddNewStep'
import EditStep from './EditStep'
import DismissibleItem from '../UIComponents/DismissibleItem'
import Backend from '../../utils/BackendBridge'
import { TouchableOpacity } from 'react-native-gesture-handler'
import URLsPeople, { URL_PEOPLE_DETAILS_WORKFLOW } from '../../URLSystem/People/URLsPeople'
import { getWorkflowStepsIdsSorted } from '../../utils/HelperFunctions'
import { useSelector, useStore } from 'react-redux'
import { DV_TAB_ASSISTANT_WORKFLOW, DV_TAB_USER_WORKFLOW } from '../../utils/TabNavigationConstants'
import { translate } from '../../i18n/TranslationService'
import { reorderUserWorkflowSteps } from '../../utils/backends/Users/usersFirestore'
import {
    ensureAssistantWorkflowFirstStep,
    reorderAssistantWorkflowSteps,
} from '../../utils/backends/Assistants/assistantsFirestore'
import { ASSISTANT_WORKFLOW_FIRST_STEP_ID } from '../../utils/assistantWorkflow'
import URLsAssistants, { URL_ASSISTANT_DETAILS_WORKFLOW } from '../../URLSystem/Assistants/URLsAssistants'

const WorkflowView = ({ user, projectIndex, ownerType = 'user', projectId: explicitProjectId }) => {
    const [steps, setSteps] = useState([])
    const selectedTab = useSelector(state => state.selectedNavItem)
    const [updatingStep, setUpdatingStep] = useState(-1)
    const [reordering, setReordering] = useState(false)
    const newItemRef = useRef(null)
    const dismissibleRefs = useRef([])
    const store = useStore()
    const isAssistantWorkflow = ownerType === 'assistant'

    const getProjectId = () => explicitProjectId || store.getState().loggedUserProjects[projectIndex].id

    const onNewStep = steps => {
        const projectId = getProjectId()
        const projectSteps = steps ? { ...steps[projectId] } : {}
        const stepIds = getWorkflowStepsIdsSorted(projectSteps)
        const newSteps = []
        for (let id of stepIds) {
            newSteps.push({
                ...projectSteps[id],
                id: id,
            })
        }
        setSteps(newSteps)
    }

    const getFormattedName = fullName => {
        if (fullName === store.getState().loggedUser.displayName) {
            return translate('WF your tasks')
        }
        let name = fullName.split(' ')[0]
        if (name[name.length - 1] === 's') {
            return translate("WF' tasks", { name: name })
        }

        return translate("WF's tasks", { name: name })
    }

    const writeBrowserURL = () => {
        const projectId = getProjectId()
        if (isAssistantWorkflow && selectedTab === DV_TAB_ASSISTANT_WORKFLOW) {
            const data = { projectId, assistantId: user.uid }
            URLsAssistants.push(URL_ASSISTANT_DETAILS_WORKFLOW, data, projectId, user.uid)
        } else if (!isAssistantWorkflow && selectedTab === DV_TAB_USER_WORKFLOW) {
            const data = { projectId: projectId, userId: user.uid }
            URLsPeople.push(URL_PEOPLE_DETAILS_WORKFLOW, data, projectId, user.uid)
        }
    }

    const moveStep = async (index, offset) => {
        const targetIndex = index + offset
        if (reordering || targetIndex < 0 || targetIndex >= steps.length) return

        const previousSteps = steps
        const reorderedSteps = [...steps]
        ;[reorderedSteps[index], reorderedSteps[targetIndex]] = [reorderedSteps[targetIndex], reorderedSteps[index]]

        setSteps(reorderedSteps)
        setReordering(true)
        try {
            const projectId = getProjectId()
            const orderedStepIds = reorderedSteps.map(step => step.id)
            await (isAssistantWorkflow
                ? reorderAssistantWorkflowSteps(projectId, user.uid, orderedStepIds)
                : reorderUserWorkflowSteps(projectId, user.uid, orderedStepIds))
        } catch (error) {
            setSteps(previousSteps)
            console.error('Could not reorder workflow steps', error)
        } finally {
            setReordering(false)
        }
    }

    useEffect(() => {
        if (isAssistantWorkflow) {
            ensureAssistantWorkflowFirstStep(getProjectId(), user).catch(error =>
                console.error('Could not initialize assistant workflow', error)
            )
            onNewStep(user.workflow)
        } else {
            Backend.onUserWorkflowChange(user.uid, onNewStep)
        }
        writeBrowserURL()

        return () => {
            if (!isAssistantWorkflow) Backend.offOnUserWorkflowChange()
        }
    }, [])

    useEffect(() => {
        if (isAssistantWorkflow) onNewStep(user.workflow)
    }, [isAssistantWorkflow, explicitProjectId, user.workflow])

    return (
        <View style={localStyles.container}>
            <WorkflowHeader stepsAmount={steps.length} />
            <View style={localStyles.infoStepsContainer}>
                <Icon name="info" size={16} color={colors.Text03} style={{ alignSelf: 'center' }} />
                <View style={{ marginLeft: 8 }}>
                    <Text style={[styles.caption2, { color: colors.Text03 }]}>
                        {isAssistantWorkflow
                            ? translate('Customize the steps assistant workflow tasks execute')
                            : translate('Customize the steps User will go through when marked as completed', {
                                  user: getFormattedName(user.displayName),
                              })}
                    </Text>
                </View>
            </View>

            {!isAssistantWorkflow && (
                <View style={localStyles.openTaskContainer}>
                    <Icon name="square" size={24} color={colors.Gray400} />
                    <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Open task')}</Text>
                    </View>
                </View>
            )}

            <View style={localStyles.stepsContainer}>
                {steps.map((step, index) => {
                    const lockedFirstStep = isAssistantWorkflow && step.id === ASSISTANT_WORKFLOW_FIRST_STEP_ID
                    return (
                        <DismissibleItem
                            key={step.id}
                            ref={ref => {
                                dismissibleRefs.current[index] = ref
                            }}
                            defaultComponent={
                                <TouchableOpacity
                                    onPress={() => {
                                        for (let i = 0; i < steps.length; ++i) {
                                            dismissibleRefs?.current[i]?.closeModal()
                                        }
                                        newItemRef.current.closeModal()
                                        dismissibleRefs?.current[index]?.openModal()
                                    }}
                                >
                                    <WorkflowStep
                                        stepNumber={index + 1}
                                        step={step}
                                        updatingStep={updatingStep === index}
                                        canMoveUp={!reordering && index > (isAssistantWorkflow ? 1 : 0)}
                                        canMoveDown={!lockedFirstStep && !reordering && index < steps.length - 1}
                                        onMoveUp={() => moveStep(index, -1)}
                                        onMoveDown={() => moveStep(index, 1)}
                                    />
                                </TouchableOpacity>
                            }
                            modalComponent={
                                <EditStep
                                    stepNumber={index + 1}
                                    step={step}
                                    steps={steps}
                                    user={user}
                                    formType={'edit'}
                                    projectIndex={projectIndex}
                                    ownerType={ownerType}
                                    lockedReviewer={lockedFirstStep}
                                    lockedStep={lockedFirstStep}
                                    onCancelAction={() => {
                                        dismissibleRefs?.current[index]?.toggleModal()
                                    }}
                                    startUpdatingStepIndicator={() => setUpdatingStep(index)}
                                    onDoneUpdatingStep={() => setUpdatingStep(-1)}
                                />
                            }
                        />
                    )
                })}
            </View>
            <View>
                <DismissibleItem
                    ref={ref => {
                        newItemRef.current = ref
                    }}
                    defaultComponent={
                        <AddNewStep
                            onPress={() => {
                                for (let i = 0; i < steps.length; ++i) {
                                    dismissibleRefs?.current[i]?.closeModal()
                                }
                                newItemRef?.current?.toggleModal()
                            }}
                        />
                    }
                    modalComponent={
                        <EditStep
                            user={user}
                            formType={'new'}
                            projectIndex={projectIndex}
                            ownerType={ownerType}
                            onCancelAction={() => {
                                newItemRef?.current?.toggleModal()
                            }}
                        />
                    }
                />
            </View>

            <View style={[localStyles.openTaskContainer, { marginTop: 16 }]}>
                <Icon name="check-square" size={24} color={colors.Gray400} />
                <View style={{ marginLeft: 8 }}>
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Done task')}</Text>
                </View>
            </View>
        </View>
    )
}
export default WorkflowView

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'column',
    },
    openTaskContainer: {
        flexDirection: 'row',
        height: 56,
        alignItems: 'center',
        paddingLeft: 10,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
    },
    infoStepsContainer: {
        flexDirection: 'row',
        height: 40,
        paddingTop: 8,
        paddingBottom: 12,
    },
    stepsContainer: {
        flexDirection: 'column',
        marginTop: 16,
    },
})
