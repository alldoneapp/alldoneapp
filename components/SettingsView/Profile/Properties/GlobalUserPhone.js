import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import ChangePhoneModal from '../../../UIComponents/FloatModals/ChangePhoneModal'
import Button from '../../../UIControls/Button'
import { setUserPhone } from '../../../../utils/backends/Users/usersFirestore'
import { translate } from '../../../../i18n/TranslationService'
import { getDisplayPhoneNumber } from '../../../../utils/phoneValidation'

export default function GlobalUserPhone({ userId, phone }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)

    const phoneDisplay = phone
        ? getDisplayPhoneNumber(phone) || phone
        : translate('No phone number') || 'No phone number'

    const changePhone = async newPhone => {
        await setUserPhone(userId, newPhone)
    }

    return (
        <View style={localStyles.settingRow}>
            <View
                style={[
                    localStyles.settingRowSection,
                    localStyles.settingRowLeft,
                    !smallScreenNavigation && { marginRight: 24 },
                ]}
            >
                <Icon name={'phone'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {smallScreenNavigation ? (
                    <Text style={styles.body1} numberOfLines={1}>
                        {phoneDisplay}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate('Phone')}
                    </Text>
                )}
            </View>
            <View
                style={[
                    localStyles.settingRowSection,
                    localStyles.settingRowRight,
                    smallScreenNavigation ? { marginLeft: 32 } : null,
                ]}
            >
                {!smallScreenNavigation && (
                    <Text style={[styles.body1, { marginHorizontal: 8 }]} numberOfLines={1}>
                        {phoneDisplay}
                    </Text>
                )}
                <Popover
                    content={
                        <ChangePhoneModal
                            closePopover={() => setOpen(false)}
                            onSaveData={changePhone}
                            currentPhone={phone}
                        />
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={smallScreen ? null : undefined}
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
        flex: 1,
        justifyContent: 'flex-end',
    },
})
