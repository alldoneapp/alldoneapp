import React, { useState, useEffect } from 'react'
import { isEqual } from 'lodash'
import { StyleSheet, View } from 'react-native'

import Backend from '../../../utils/BackendBridge'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME, MENTION_MODAL_GOALS_TAB } from '../../Feeds/CommentsTextInput/textInputHelper'
import PlusButton from '../Common/PlusButton'
import { getNewDefaultGoal, getOwnerId } from '../../GoalsView/GoalsHelper'
import DateRangeWrapper from '../../GoalsView/EditGoalsComponents/DateRangeWrapper'
import AssigneesWrapper from '../../GoalsView/EditGoalsComponents/AssigneesWrapper'
import { BACKLOG_DATE_NUMERIC } from '../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../i18n/TranslationService'
import { FEED_GOAL_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import store from '../../../redux/store'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    MENTION_MODAL_ID,
    TAGS_INTERACTION_MODAL_ID,
    TASK_PARENT_GOAL_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function CreateGoal({ projectId, delalyPrivacyModalClose, selectItemToMention, modalId, mentionText }) {
    const [goal, setGoal] = useState(null)
    const [baseDate, setBaseDate] = useState(null)

    const onChangeText = extendedName => {
        setGoal(goal => ({ ...goal, extendedName }))
    }

    const addGoal = async newGoal => {
        const goal = await Backend.uploadNewGoal(projectId, newGoal, baseDate, true, false)
        if (selectItemToMention) selectItemToMention(goal, MENTION_MODAL_GOALS_TAB, projectId, true)
    }

    const updateDateRange = (date, rangeEdgePropertyName) => {
        if (goal[rangeEdgePropertyName] !== date) {
            addGoal({ ...goal, [rangeEdgePropertyName]: date })
        }
    }

    const updateAssignees = (assigneesIds, assigneesCapacity) => {
        if (assigneesIds.length > 0) {
            addGoal({
                ...goal,
                assigneesIds,
                assigneesCapacity,
                ownerId: getOwnerId(projectId, assigneesIds[0]),
            })
        }
    }

    const setPrivacy = (isPrivate, isPublicFor) => {
        if (!isEqual(goal.isPublicFor, isPublicFor)) {
            delalyPrivacyModalClose
                ? setTimeout(() => {
                      addGoal({ ...goal, isPublicFor })
                  })
                : addGoal({ ...goal, isPublicFor })
        }
    }

    useEffect(() => {
        const ownerId = getOwnerId(projectId, getNewDefaultGoal(BACKLOG_DATE_NUMERIC).assigneesIds[0])
        Backend.getActiveMilestone(projectId, ownerId).then(activeMilestone => {
            const baseDate = activeMilestone ? activeMilestone.date : BACKLOG_DATE_NUMERIC
            const goal = getNewDefaultGoal(baseDate)
            goal.ownerId = ownerId
            setBaseDate(baseDate)
            setGoal(goal)
        })
    }, [])

    const enterKeyAction = () => {
        const { mentionModalStack } = store.getState()
        if (
            mentionModalStack[0] === modalId &&
            !exitsOpenModals([MENTION_MODAL_ID, COMMENT_MODAL_ID, TAGS_INTERACTION_MODAL_ID, TASK_PARENT_GOAL_MODAL_ID])
        ) {
            addGoal({ ...goal })
        }
    }

    const disableButtons = goal && !goal.extendedName.trim()

    const isGuide = !!ProjectHelper.getProjectById(projectId)?.parentTemplateId
    return (
        goal && (
            <View style={localStyles.container}>
                <View style={localStyles.inputContainer}>
                    <Icon name={'plus-square'} size={24} color={colors.Primary100} style={localStyles.icon} />
                    <View style={localStyles.editorContainer}>
                        <CustomTextInput3
                            placeholder={translate('Type to add goal')}
                            placeholderTextColor={colors.Text03}
                            onChangeText={onChangeText}
                            multiline={true}
                            externalTextStyle={localStyles.textInputText}
                            caretColor="white"
                            autoFocus={true}
                            setMentionsModalActive={() => {}}
                            initialTextExtended={mentionText || goal.extendedName}
                            projectId={projectId}
                            styleTheme={CREATE_TASK_MODAL_THEME}
                            externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                            forceTriggerEnterActionForBreakLines={enterKeyAction}
                        />
                    </View>
                </View>
                <View style={localStyles.buttonsContainer}>
                    <View style={localStyles.buttonsLeft}>
                        <DateRangeWrapper
                            projectId={projectId}
                            updateDateRange={updateDateRange}
                            goal={goal}
                            inMentionModal={true}
                            disabled={disableButtons}
                        />
                        <AssigneesWrapper
                            goal={goal}
                            updateAssignees={updateAssignees}
                            projectId={projectId}
                            inMentionModal={true}
                            disabled={disableButtons || isGuide}
                        />
                        <PrivacyWrapper
                            object={goal}
                            objectType={FEED_GOAL_OBJECT_TYPE}
                            projectId={projectId}
                            setPrivacy={setPrivacy}
                            disabled={disableButtons}
                        />
                    </View>
                    <View>
                        <PlusButton onPress={() => addGoal({ ...goal })} disabled={disableButtons} modalId={modalId} />
                    </View>
                </View>
            </View>
        )
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
