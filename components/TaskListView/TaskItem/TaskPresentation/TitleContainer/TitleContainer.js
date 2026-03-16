import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../../styles/global'
import SocialText from '../../../../UIControls/SocialText/SocialText'
import Icon from '../../../../Icon'
import { getGmailTaskWebUrl, isGmailLabelFollowUpTask } from '../../../../../utils/Gmail/gmailTaskUtils'

function openGmailTaskLink(task) {
    const webUrl = getGmailTaskWebUrl(task)
    if (webUrl) return window.open(webUrl, '_blank')
}

export default function TitleContainer({
    task,
    projectId,
    isObservedTask,
    toggleModal,
    backColorHighlight,
    backColor,
    hasStar,
    inMyDayAndNotSubtask,
    blockOpen,
    tagsExpandedHeight,
    showVerticalEllipsisInByTime,
}) {
    return (
        <View
            style={[
                localStyles.descriptionContainer,
                task.isSubtask ? localStyles.descriptionContainerSubtask : undefined,
            ]}
        >
            {isGmailLabelFollowUpTask(task) && (
                <TouchableOpacity style={localStyles.gmailIconContainer} onPress={() => openGmailTaskLink(task)}>
                    <Icon name={'envelope-open'} size={11} color={colors.Text03} />
                </TouchableOpacity>
            )}
            <SocialText
                elementId={`social_text_${projectId}_${task.id}_${isObservedTask}`}
                style={[
                    task.isSubtask ? styles.body2 : styles.body1,
                    localStyles.descriptionText,
                    task.isSubtask ? localStyles.descriptionTextSubtask : undefined,
                    task.isSubtask && task.done ? { color: colors.Text03 } : undefined,
                ]}
                onPress={toggleModal}
                numberOfLines={3}
                wrapText={true}
                hasLinkBack={task.linkBack !== undefined && task.linkBack.length > 0}
                task={task}
                hasStar={hasStar}
                isSubtask={task.isSubtask}
                bgColor={hasStar ? backColorHighlight : backColor}
                projectId={projectId}
                blockOpen={blockOpen}
                activeCalendarStyle={inMyDayAndNotSubtask}
                tagsExpandedHeight={tagsExpandedHeight}
                isObservedTask={isObservedTask}
                showVerticalEllipsisInByTime={showVerticalEllipsisInByTime}
                dotsStyle={inMyDayAndNotSubtask && { paddingLeft: 6, bottom: 12 }}
            >
                {task !== undefined && task.name != null && task.extendedName != null
                    ? task.extendedName !== ''
                        ? task.extendedName
                        : task.name
                    : ''}
            </SocialText>
        </View>
    )
}

const localStyles = StyleSheet.create({
    descriptionContainer: {
        flexGrow: 1,
        paddingLeft: 12,
        flex: 1,
        position: 'relative',
    },
    descriptionContainerSubtask: {
        paddingLeft: 10,
    },
    descriptionText: {
        display: 'flex',
        marginTop: 5,
        marginBottom: 5,
        alignItems: 'flex-start',
        maxHeight: 90,
    },
    descriptionTextSubtask: {
        marginTop: 6,
        marginBottom: 6,
        maxHeight: 90,
    },
    gmailIconContainer: {
        position: 'absolute',
        left: -4,
        top: 14,
        zIndex: 1,
    },
})
