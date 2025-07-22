import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Button from '../../../UIControls/Button'
import CloseButton from '../../../FollowUp/CloseButton'
import { translate } from '../../../../i18n/TranslationService'
import Line from '../../../UIComponents/FloatModals/GoalMilestoneModal/Line'

export default function RemoveSelectedUserModal({ userId, closeModal, selectedUserIds, setSelectedUsersIds }) {
    const removerUser = () => {
        const userIds = selectedUserIds.filter(id => id !== userId)
        setSelectedUsersIds(userIds)
        closeModal()
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') removerUser()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.title}>{translate('Remove Premium user')}</Text>
            <View style={localStyles.descriptionContainer}>
                <Icon name={'info'} size={16.5} color={colors.Text03} style={{ marginRight: 8.75 }} />
                <Text style={localStyles.description}>{translate('Be careful with this action')}</Text>
            </View>
            <Text style={localStyles.textBody}>
                {translate('By doing this, the user will lose all the premium features when the paid period ends')}
            </Text>
            <Line style={localStyles.line} />
            <Button
                title={translate('Remove from premium')}
                type={'danger'}
                onPress={removerUser}
                buttonStyle={{ alignSelf: 'center' }}
            />
            <CloseButton close={closeModal} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        width: 305,
    },
    title: {
        ...styles.title7,
        color: 'white',
    },
    descriptionContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
    textBody: {
        ...styles.body1,
        color: colors.Gray400,
        marginTop: 20,
    },
    line: {
        marginVertical: 16,
    },
    info: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
