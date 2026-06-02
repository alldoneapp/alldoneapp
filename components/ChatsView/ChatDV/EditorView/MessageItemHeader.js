import React from 'react'
import { Image, View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import global, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { getTimestampInMilliseconds, parseLastEdited } from '../../Utils/ChatHelper'
import ContactsHelper from '../../../ContactsView/Utils/ContactsHelper'
import NavigationService from '../../../../utils/NavigationService'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../../utils/TabNavigationConstants'
import { getAssistantProjectId } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function MessageItemHeader({
    projectId,
    message,
    serverTime,
    creatorData,
    highlight,
    onEditPress,
    editDisabled,
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

    return (
        <View style={localStyles.title}>
            {highlight && <View style={localStyles.dotNotification} />}
            <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center' }}
                disabled={isUnknownUser}
                onPress={navigateToUserDv}
            >
                <Image source={photoURL} style={localStyles.userImage} />
                <Text style={localStyles.userName}>{displayName}</Text>
            </TouchableOpacity>
            <Text style={localStyles.datetime}> • {parseLastEdited(serverTime, accurateTime)}</Text>
            {isVoiceTranscription && (
                <View style={localStyles.voiceIndicator}>
                    <Icon name="mic" size={12} color={colors.Text03} />
                </View>
            )}
            {source === 'whatsapp' && <Text style={localStyles.sourceLabel}> • WhatsApp</Text>}
            {!editDisabled && (
                <TouchableOpacity
                    style={localStyles.editButton}
                    onPress={onEditPress}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                    accessibilityLabel="Edit message"
                >
                    <Icon name="edit-2" size={12} color={colors.Text03} />
                </TouchableOpacity>
            )}
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
})
