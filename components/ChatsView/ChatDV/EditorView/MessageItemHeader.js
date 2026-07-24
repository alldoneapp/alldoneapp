import React from 'react'
import { Image, View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native'
import { useDispatch } from 'react-redux'

import global, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { getTimestampInMilliseconds, parseLastEdited } from '../../Utils/ChatHelper'
import ContactsHelper from '../../../ContactsView/Utils/ContactsHelper'
import NavigationService from '../../../../utils/NavigationService'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../../utils/TabNavigationConstants'
import { getAssistantProjectId } from '../../../AdminPanel/Assistants/assistantsHelper'
import EmailNewBadge from '../../../Tags/EmailNewBadge'

export default function MessageItemHeader({
    projectId,
    message,
    serverTime,
    creatorData,
    highlight,
    onEditPress,
    editDisabled,
    accessGranted,
    linkedEmailNew,
}) {
    const dispatch = useDispatch()

    const { lastChangeDate, creatorId, isVoiceTranscription, source } = message

    const { photoURL, displayName, isProjectUser, isUnknownUser } = creatorData

    const accurateTime = getTimestampInMilliseconds(lastChangeDate)

    const navigateToUserDv = () => {
        if (isProjectUser) {
            ContactsHelper.navigateToUserProfile(projectId, creatorId)
        } else {
            // Get the correct project ID where the assistant actually exists
            const assistantProjectId = getAssistantProjectId(creatorId, projectId)
            NavigationService.navigate('AssistantDetailedView', {
                assistantId: creatorId,
                projectId: assistantProjectId,
            })
            dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
        }
    }

    const handleEditPress = (source, event) => {
        console.log('[ChatEditDebug] header edit event', {
            source,
            messageId: message.id,
            creatorId,
            editDisabled,
            platform: Platform.OS,
        })
        event?.preventDefault?.()
        event?.stopPropagation?.()
        onEditPress()
    }

    const editButtonWebEvents =
        Platform.OS === 'web'
            ? {
                  onClick: event => handleEditPress('onClick', event),
                  onStartShouldSetResponder: () => {
                      console.log('[ChatEditDebug] header edit responder start', {
                          messageId: message.id,
                          creatorId,
                      })
                      return true
                  },
                  onResponderRelease: event => handleEditPress('onResponderRelease', event),
              }
            : {}

    return (
        <View style={localStyles.title} testID="message-item-header">
            {highlight && <View style={localStyles.dotNotification} />}
            <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center' }}
                disabled={isUnknownUser || !accessGranted}
                onPress={navigateToUserDv}
            >
                <Image source={photoURL} style={localStyles.userImage} />
                <Text style={localStyles.userName}>{displayName}</Text>
            </TouchableOpacity>
            {editDisabled ? (
                <>
                    <Text style={localStyles.datetime}> • {parseLastEdited(serverTime, accurateTime)}</Text>
                    {isVoiceTranscription && (
                        <View style={localStyles.voiceIndicator}>
                            <Icon name="mic" size={12} color={colors.Text03} />
                        </View>
                    )}
                    {source === 'whatsapp' && <Text style={localStyles.sourceLabel}> • WhatsApp</Text>}
                </>
            ) : (
                <TouchableOpacity
                    style={localStyles.editMetadata}
                    onPress={event => handleEditPress('onPress', event)}
                    {...editButtonWebEvents}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                    accessibilityLabel="Edit message"
                >
                    <Text style={localStyles.datetime}> • {parseLastEdited(serverTime, accurateTime)}</Text>
                    {isVoiceTranscription && (
                        <View style={localStyles.voiceIndicator}>
                            <Icon name="mic" size={12} color={colors.Text03} />
                        </View>
                    )}
                    {source === 'whatsapp' && <Text style={localStyles.sourceLabel}> • WhatsApp</Text>}
                    <View style={localStyles.editButton}>
                        <Icon name="edit-2" size={12} color={colors.Text03} />
                    </View>
                </TouchableOpacity>
            )}
            {linkedEmailNew && <EmailNewBadge propStyles={localStyles.linkedEmailNewBadge} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    title: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    userName: {
        ...global.subtitle2,
        marginLeft: 12,
        color: colors.Text02,
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    datetime: {
        ...global.caption2,
        color: colors.Text03,
    },
    editMetadata: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dotNotification: {
        width: 6,
        height: 6,
        backgroundColor: colors.UtilityRed200,
        borderRadius: 100,
        marginRight: 7,
        marginLeft: -13,
        alignSelf: 'center',
    },
    voiceIndicator: {
        marginLeft: 6,
        alignSelf: 'center',
    },
    sourceLabel: {
        ...global.caption2,
        color: colors.Text03,
        alignSelf: 'center',
    },
    editButton: {
        marginLeft: 2,
        padding: 4,
        opacity: 0.6,
    },
    linkedEmailNewBadge: {
        marginLeft: 'auto',
        marginRight: 8,
    },
})
