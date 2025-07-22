import React, { useEffect } from 'react'
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import Icon from '../../../Icon'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import {
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_CONTACTS_TAB,
} from '../textInputHelper'
import ObjectHeaderParser from '../../TextParser/ObjectHeaderParser'
import AssigneesIcon from '../../../GoalsView/EditGoalsComponents/AssigneesIcon'
import GoalProgress from './GoalProgress'
import { isEmpty } from 'lodash'
import { isWorkstream } from '../../../Workstreams/WorkstreamHelper'
import { getAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function MentionsItems({
    selectItemToMention,
    items,
    activeItemIndex,
    itemsComponentsRefs,
    projectId,
    activeTab,
    activeItemRef,
    externalContainerStyle,
    currentlyAssignedGoal,
}) {
    const getItemData = item => {
        const { id, name, extendedName, extendedTitle, userId, assigneesIds, progress, dynamicProgress } = item

        let photoURL = ''
        let userIsWorkstream = false

        if (activeTab === MENTION_MODAL_TASKS_TAB || activeTab === MENTION_MODAL_NOTES_TAB) {
            if (isWorkstream(userId)) {
                userIsWorkstream = true
            } else {
                const owner = TasksHelper.getPeopleById(userId, projectId) || getAssistant(userId)
                photoURL = owner ? owner.photoURL : ''
            }
        }

        if (activeTab === MENTION_MODAL_TASKS_TAB) {
            return { id, extendedName, photoURL, userIsWorkstream }
        } else if (activeTab === MENTION_MODAL_NOTES_TAB) {
            return { id, extendedName: extendedTitle, photoURL }
        } else if (activeTab === MENTION_MODAL_TOPICS_TAB) {
            return { id: item.id, extendedName: name }
        } else if (activeTab === MENTION_MODAL_GOALS_TAB) {
            return { id, extendedName, assigneesIds, progress, dynamicProgress }
        } else if (activeTab === MENTION_MODAL_CONTACTS_TAB) {
            return { id, extendedName, photoURL, userIsWorkstream }
        }
    }

    const getItemIco = item => {
        if (activeTab === MENTION_MODAL_TASKS_TAB) {
            const { done, userIds, parentId } = item

            if (parentId != null) {
                if (done) {
                    return 'square-checked-gray-Sub'
                } else {
                    return 'square-Sub'
                }
            } else {
                if (done) {
                    return 'square-checked-gray'
                } else if (userIds?.length > 1) {
                    return 'clock'
                }
                return 'square'
            }
        } else if (activeTab === MENTION_MODAL_NOTES_TAB) {
            return 'file-text'
        } else if (activeTab === MENTION_MODAL_TOPICS_TAB) {
            return 'comments-thread'
        } else if (activeTab === MENTION_MODAL_CONTACTS_TAB) {
            return 'users'
        }
    }

    const getActiveItemId = () => {
        return items.length > 0 && items[activeItemIndex]
            ? items[activeItemIndex].id
                ? items[activeItemIndex].id
                : activeTab === MENTION_MODAL_TOPICS_TAB
                ? items[activeItemIndex].id
                : ''
            : ''
    }

    const isCurrentlyAssignedGoal = itemId => {
        return activeTab === MENTION_MODAL_GOALS_TAB && currentlyAssignedGoal && currentlyAssignedGoal.id === itemId
    }

    const isKeyboardHighlighted = itemId => {
        return itemId === getActiveItemId()
    }

    useEffect(() => {
        if (activeItemRef) {
            const activeItemId = getActiveItemId()
            if (activeItemId) {
                activeItemRef.current = itemsComponentsRefs.current[activeItemId]
            }
        }
    }, [activeItemIndex])

    return (
        <View style={externalContainerStyle}>
            {items.map(item => {
                const {
                    id,
                    extendedName,
                    photoURL,
                    assigneesIds,
                    progress,
                    dynamicProgress,
                    userIsWorkstream,
                } = getItemData(item)

                const isAssigned = isCurrentlyAssignedGoal(id)
                const isHighlighted = isKeyboardHighlighted(id)
                return isEmpty(item) ? null : (
                    <TouchableOpacity
                        key={id}
                        ref={ref => (itemsComponentsRefs.current[id] = ref)}
                        style={[
                            localStyles.container,
                            isAssigned && localStyles.assignedGoalContainer,
                            isHighlighted && localStyles.keyboardHighlightContainer,
                            isAssigned && isHighlighted && localStyles.assignedAndHighlightedContainer,
                        ].filter(Boolean)}
                        onPress={() => {
                            selectItemToMention(item, activeTab, projectId)
                        }}
                    >
                        {activeTab === MENTION_MODAL_GOALS_TAB ? (
                            <GoalProgress progress={progress} projectId={projectId} dynamicProgress={dynamicProgress} />
                        ) : (
                            <Icon name={getItemIco(item)} size={24} color="#ffffff" />
                        )}
                        <ObjectHeaderParser
                            text={extendedName}
                            projectId={projectId}
                            entryExternalStyle={localStyles.text}
                            containerExternalStyle={localStyles.textContainer}
                            inMentionModal={true}
                            dotsBackgroundColor={{
                                backgroundColor: isAssigned
                                    ? colors.Primary200
                                    : isHighlighted
                                    ? colors.Primary300
                                    : colors.Secondary400,
                            }}
                            disebledTags={true}
                            maxHeight={48}
                            shortTags={true}
                        />
                        {activeTab === MENTION_MODAL_GOALS_TAB ? (
                            assigneesIds.length > 0 ? (
                                <AssigneesIcon
                                    workstreamBackgroundColor={'transparent'}
                                    assigneesIds={assigneesIds}
                                    disableModal={true}
                                    maxUsersToShow={1}
                                    projectId={projectId}
                                />
                            ) : null
                        ) : (
                            <View style={[localStyles.avatar, localStyles.userPhoto]}>
                                {userIsWorkstream ? (
                                    <Icon size={24} name="workstream" color={colors.Text03} />
                                ) : photoURL ? (
                                    <Image source={{ uri: photoURL }} style={localStyles.avatar} />
                                ) : (
                                    activeTab !== MENTION_MODAL_TOPICS_TAB && (
                                        <SVGGenericUser width={24} height={24} svgid={`ci_p_${item.id}_${projectId}`} />
                                    )
                                )}
                            </View>
                        )}
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 8,
    },
    // Currently assigned parent goal (solid green background)
    assignedGoalContainer: {
        backgroundColor: colors.UtilityGreen200,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.UtilityGreen100,
    },
    // Keyboard navigation highlight (blue background with dashed border)
    keyboardHighlightContainer: {
        backgroundColor: colors.Primary300,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.UtilityBlue150,
        borderStyle: 'dashed',
    },
    // Both assigned and highlighted (green background with blue dashed border)
    assignedAndHighlightedContainer: {
        backgroundColor: colors.UtilityGreen200,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.Primary100,
        borderStyle: 'dashed',
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 100,
        overflow: 'hidden',
    },
    userPhoto: {
        overflow: 'hidden',
    },
    name: {
        ...styles.body1,
        color: '#FFFFFF',
        marginHorizontal: 8,
        flex: 1,
    },
    text: {
        color: '#FFFFFF',
    },
    textContainer: {
        maxHeight: 48,
        overflow: 'hidden',
        marginHorizontal: 8,
    },
})
