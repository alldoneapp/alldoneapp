import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Popover from 'react-tiny-popover'
import Button from '../../../UIControls/Button'
import { useSelector } from 'react-redux'
import Backend from '../../../../utils/BackendBridge'
import ChangeTextFieldModal from '../../../UIComponents/FloatModals/ChangeTextFieldModal'
import { translate } from '../../../../i18n/TranslationService'
import { setUserNotificationEmail } from '../../../../utils/backends/Users/usersFirestore'

export default function NotificationEmail({ userId, email, notificationEmail }) {
    const mobile = useSelector(state => state.smallScreen)
    const mobileNav = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)

    const changeData = email => {
        setUserNotificationEmail(userId, email)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'notification-mail'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {mobileNav ? (
                    <Text style={[styles.body1]} numberOfLines={1}>
                        {email}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate('Notification email')}
                    </Text>
                )}
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                {!mobileNav && (
                    <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                        {notificationEmail !== '' ? notificationEmail : email}
                    </Text>
                )}

                <Popover
                    content={
                        <ChangeTextFieldModal
                            header={'Edit notification email'}
                            subheader={'Notification email subtitle'}
                            label={'Email'}
                            placeholder={'Type email'}
                            closePopover={() => setOpen(false)}
                            onSaveData={changeData}
                            currentValue={notificationEmail !== '' ? notificationEmail : email}
                        />
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button icon={'edit'} type={'ghost'} onPress={() => setOpen(true)} />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
})
