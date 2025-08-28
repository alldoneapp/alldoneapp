import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../UIControls/Button'
import NotificationSettingsModal from './NotificationSettingsModal'
import { colors, em2px } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { popoverToCenter } from '../../../utils/HelperFunctions'

const NotificationSettings = () => {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { receiveEmails, pushNotificationsStatus } = useSelector(state => state.loggedUser)
    const [isOpen, setIsOpen] = useState(false)

    const getTitle = () => {
        switch (true) {
            case receiveEmails && pushNotificationsStatus:
                return translate('Push and Email notifications')
            case receiveEmails && !pushNotificationsStatus:
                return translate('Email notifications')
            case !receiveEmails && pushNotificationsStatus:
                return translate('Push notifications')
            case !receiveEmails && !pushNotificationsStatus:
                return translate('Notifications disabled')
        }
    }

    return (
        <Popover
            isOpen={isOpen}
            onClickOutside={() => setIsOpen(false)}
            disableReposition={smallScreenNavigation}
            contentLocation={smallScreenNavigation && popoverToCenter}
            align={'center'}
            position={['left', 'bottom', 'top']}
            content={<NotificationSettingsModal setIsOpen={setIsOpen} />}
        >
            <Button
                title={getTitle()}
                type="ghost"
                onPress={() => setIsOpen(!isOpen)}
                numberTitleLines={2}
                titleStyle={localStyles.text}
                buttonStyle={{ width: 124 }}
            />
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    text: {
        fontFamily: 'Roboto-Regular',
        fontSize: 12,
        lineHeight: 14,
        letterSpacing: em2px(0.03),
        color: colors.Text03,
        maxWidth: 142,
    },
})

export default NotificationSettings
