import React, { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native'
import Icon from '../Icon'
import global, { colors } from '../styles/global'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'
import { markMessagesAsRead } from '../../utils/backends/Chats/chatsComments'

const MarkAsRead = ({ projectId, projectIds, userId, containerStyle }) => {
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(false)
    const idsToMark = projectIds || (projectId ? [projectId] : [])
    const disabled = loading || idsToMark.length === 0

    const markRead = async () => {
        if (disabled) return

        setLoading(true)
        setError(false)
        try {
            const failures = []
            await Promise.all(
                idsToMark.map(async id => {
                    try {
                        await markMessagesAsRead(id, userId, chatsActiveTab)
                    } catch (projectError) {
                        failures.push({ id, error: projectError })
                    }
                })
            )
            if (failures.length > 0) throw failures[0].error
        } catch (markReadError) {
            console.error('Failed to mark chat messages as read', markReadError)
            setError(true)
        } finally {
            setLoading(false)
        }
    }

    return (
        <TouchableOpacity
            accessibilityLabel={translate(error ? 'Could not mark as read. Try again' : 'mark as read')}
            accessibilityRole="button"
            accessibilityState={{ busy: loading, disabled }}
            style={[
                localStyles.container,
                disabled && localStyles.disabled,
                error && localStyles.errorContainer,
                containerStyle,
            ]}
            onPress={markRead}
            disabled={disabled}
        >
            {loading ? (
                <ActivityIndicator size="small" color={colors.Text03} />
            ) : (
                <Icon name="double-check" size={16} color={error ? colors.UtilityRed200 : colors.Text03} />
            )}
            <Text style={[localStyles.text, error && localStyles.errorText]} numberOfLines={1}>
                {translate(error ? 'try again' : 'mark as read')}
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
    disabled: {
        opacity: 0.6,
    },
    errorContainer: {
        borderColor: colors.UtilityRed200,
    },
    errorText: {
        color: colors.UtilityRed200,
    },
})

export default MarkAsRead
