import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import Icon from '../Icon'
import global, { colors } from '../styles/global'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'
import { markMessagesAsRead } from '../../utils/backends/Chats/chatsComments'

const MarkAsRead = ({ projectId, userId }) => {
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const markRead = () => {
        markMessagesAsRead(projectId, userId, chatsActiveTab)
    }

    return (
        <TouchableOpacity style={localStyles.container} onPress={markRead}>
            <Icon name="double-check" size={16} color={colors.Text03} />
            <Text style={localStyles.text} numberOfLines={1}>
                {translate('mark as read')}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 4,
        borderColor: colors.Text03,
        borderWidth: 1,
        height: 28,
        paddingVertical: 0,
        paddingLeft: 6,
        paddingRight: 10,
    },
    text: {
        ...global.caption1,
        color: colors.Text03,
        marginLeft: 6,
        flexShrink: 0,
    },
})

export default MarkAsRead
