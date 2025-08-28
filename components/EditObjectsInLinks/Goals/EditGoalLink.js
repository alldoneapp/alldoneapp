import React, { useEffect, useState } from 'react'
import { cloneDeep, isEqual } from 'lodash'
import { useSelector } from 'react-redux'
import Backend from '../../../utils/BackendBridge'
import { StyleSheet, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import SaveButton from '../Common/SaveButton'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import NavigationService from '../../../utils/NavigationService'
import DateRangeWrapper from '../../GoalsView/EditGoalsComponents/DateRangeWrapper'
import AssigneesWrapper from '../../GoalsView/EditGoalsComponents/AssigneesWrapper'
import ProgressWrapper from '../../GoalsView/EditGoalsComponents/ProgressWrapper'
import GoalMoreButton from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Goals/GoalMoreButton'
import { checkDVLink, getDvMainTabLink } from '../../../utils/LinkingHelper'
import URLTrigger from '../../../URLSystem/URLTrigger'
import { getPathname } from '../../Tags/LinkTag'
import { COMMENT_MODAL_ID, exitsOpenModals, TAGS_EDIT_OBJECT_MODAL_ID } from '../../ModalsManager/modalsManager'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function EditGoalLink({ projectId, goalData, closeModal, objectUrl }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [goal, setGoal] = useState(cloneDeep(goalData))

    const goalHasValidChanges = () => {
        const cleanedName = goal.extendedName.trim()
        return cleanedName && cleanedName !== goalData.extendedName.trim()
    }

    const onChangeText = extendedName => {
        setGoal(goal => ({ ...goal, extendedName }))
    }

    const updateGoal = (updatedGoal, avoidFollow) => {
        Backend.updateGoal(projectId, goalData, updatedGoal, avoidFollow)
        closeModal()
    }

    const updateCurrentChanges = () => {
        goalHasValidChanges() ? updateGoal({ ...goal }) : closeModal()
    }

    const updateDateRange = (date, rangeEdgePropertyName) => {
        if (goal[rangeEdgePropertyName] !== date) {
            updateGoal({ ...goal, [rangeEdgePropertyName]: date })
        }
    }

    const updateAssignees = (assigneesIds, assigneesCapacity) => {
        if (!isEqual(goal.assigneesIds, assigneesIds) || !isEqual(goal.assigneesCapacity, assigneesCapacity)) {
            updateGoal({ ...goal, assigneesIds, assigneesCapacity })
        }
    }

    const updateProgress = (progress, addedComment) => {
        if (goal.progress !== progress) {
            updateGoal({ ...goal, progress })
        } else if (addedComment) {
            updateCurrentChanges()
        }
    }

    const updateDescription = description => {
        const cleanedDescription = description.trim()
        if (goal.description.trim() !== cleanedDescription) {
            updateGoal({ ...goal, description: cleanedDescription })
        }
    }

    const updateHighlight = color => {
        if (goal.hasStar !== color) {
            updateGoal({ ...goal, hasStar: color })
        }
    }

    const updateFollowState = () => {
        goalHasValidChanges() ? updateGoal({ ...goal }, true) : closeModal()
    }

    const openDV = () => {
        closeModal()
        checkDVLink('goal')
        const linkUrl = objectUrl != null ? getPathname(objectUrl) : getDvMainTabLink(projectId, goalData.id, 'goals')
        URLTrigger.processUrl(NavigationService, linkUrl)
    }

    const enterKeyAction = () => {
        if (!exitsOpenModals([COMMENT_MODAL_ID, TAGS_EDIT_OBJECT_MODAL_ID])) {
            updateCurrentChanges()
        }
    }

    useEffect(() => {
        const loggedUserIsGoalOwner = goal.ownerId === loggedUserId
        const loggedUserCanUpdateObject =
            loggedUserIsGoalOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

        if (!loggedUserCanUpdateObject) {
            closeModal()
            const url = getDvMainTabLink(projectId, goal.id, 'goals')
            URLTrigger.processUrl(NavigationService, url)
        }
    }, [])

    const disableButtons = !goal.extendedName.trim()
    const isGuide = !!ProjectHelper.getProjectById(projectId).parentTemplateId
    return (
        <View style={localStyles.container}>
            <View style={localStyles.inputContainer}>
                <Icon name={'target'} size={24} color={'#ffffff'} style={localStyles.icon} />
                <View style={localStyles.editorContainer}>
                    <CustomTextInput3
                        placeholder={'Type to edit the goal'}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        initialTextExtended={goal.extendedName}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton onPress={openDV} />
                    <DateRangeWrapper
                        projectId={projectId}
                        updateDateRange={updateDateRange}
                        goal={goal}
                        disabled={disableButtons}
                        inMentionModal={true}
                    />
                    <AssigneesWrapper
                        goal={goal}
                        updateAssignees={updateAssignees}
                        projectId={projectId}
                        disabled={disableButtons || isGuide}
                        inMentionModal={true}
                    />
                    <ProgressWrapper
                        goal={goal}
                        updateProgress={updateProgress}
                        inMentionModal={true}
                        projectId={projectId}
                        disabled={disableButtons}
                        closeParentModal={closeModal}
                    />
                    <GoalMoreButton
                        projectId={projectId}
                        goal={goal}
                        buttonStyle={{ marginRight: 4 }}
                        closeParent={closeModal}
                        disabled={disableButtons}
                        updateDescription={updateDescription}
                        updateCurrentChanges={updateCurrentChanges}
                        updateHighlight={updateHighlight}
                        updateFollowState={updateFollowState}
                        inMentionModal={true}
                        refKey={goal.id}
                        editingLink={true}
                    />
                </View>
                <SaveButton icon={goalHasValidChanges() ? 'save' : 'x'} onPress={updateCurrentChanges} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    editorContainer: {
        marginTop: 2,
        marginBottom: 26,
        marginLeft: 28,
        minHeight: 38,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
