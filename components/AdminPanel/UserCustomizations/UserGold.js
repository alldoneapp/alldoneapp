import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles, { colors } from '../../styles/global'
import ChangeNumberTodayTasks from '../../UIComponents/FloatModals/ChangeNumberTodayTasks'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'
import Gold from '../../../assets/svg/Gold'
import { setUserGold } from '../../../utils/backends/Users/usersFirestore'

export default function UserGold({ userId, gold }) {
    const mobile = useSelector(state => state.smallScreen)
    const mobileNav = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)

    const changeData = gold => {
        setUserGold(userId, gold)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft, { paddingLeft: 8 }]}>
                <Gold width={24} height={24} id="statisticsSection" />
                {mobileNav ? (
                    <Text style={[styles.body1, { marginLeft: 8 }]} numberOfLines={1}>
                        {gold}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03, marginLeft: 8 }]} numberOfLines={1}>
                        {translate('Gold points')}
                    </Text>
                )}
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                {!mobileNav && (
                    <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                        {gold}
                    </Text>
                )}
                <Popover
                    content={
                        <ChangeNumberTodayTasks
                            closePopover={() => setOpen(false)}
                            onSaveData={changeData}
                            currentValue={gold}
                            windowSize
                            customTitle={translate('Gold points')}
                            customSubtitle={translate('This is the current gold of the user')}
                            hideUnlimitedButton={true}
                            allowZeroValue={true}
                            customPropertyName={translate('Gold')}
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
