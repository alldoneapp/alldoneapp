import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Popover from 'react-tiny-popover'
import ChangeNumberTodayTasks from '../../../UIComponents/FloatModals/ChangeNumberTodayTasks'
import Button from '../../../UIControls/Button'
import { useSelector } from 'react-redux'
import Backend from '../../../../utils/BackendBridge'
import { translate } from '../../../../i18n/TranslationService'
import { setNumberTodayTasks } from '../../../../utils/backends/Users/usersFirestore'

export default function MaxNumberTasksToday({ userId, numberTodayTasks }) {
    const mobile = useSelector(state => state.smallScreen)
    const mobileNav = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)

    const changeData = todayTasks => {
        setNumberTodayTasks(userId, todayTasks)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'check-square'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {mobileNav ? (
                    <Text style={[styles.body1]} numberOfLines={1}>
                        {numberTodayTasks == 0 ? 'Unlimited' : numberTodayTasks}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate('Max number of tasks in today')}
                    </Text>
                )}
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                {!mobileNav && (
                    <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                        {numberTodayTasks == 0 ? 'Unlimited' : numberTodayTasks}
                    </Text>
                )}
                <Popover
                    content={
                        <ChangeNumberTodayTasks
                            closePopover={() => setOpen(false)}
                            onSaveData={changeData}
                            currentValue={numberTodayTasks}
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
