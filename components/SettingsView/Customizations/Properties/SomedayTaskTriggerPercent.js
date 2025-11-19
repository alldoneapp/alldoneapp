import React, { useState } from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import ChangeNumberTodayTasks from '../../../UIComponents/FloatModals/ChangeNumberTodayTasks'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { setSomedayTaskTriggerPercent } from '../../../../utils/backends/Users/usersFirestore'
import { selectRandomSomedayTask } from '../../../../utils/backends/Tasks/randomSomedayTask'
import Icon from '../../../Icon'

export default function SomedayTaskTriggerPercent({ userId, somedayTaskTriggerPercent }) {
    const mobile = useSelector(state => state.smallScreen)
    const mobileNav = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)

    const changeData = somedayPercent => {
        const percent = somedayPercent > 100 ? 100 : somedayPercent < 0 ? 0 : somedayPercent
        setSomedayTaskTriggerPercent(userId, percent)
    }

    return (
        <View style={localStyles.settingRow}>
            <TouchableOpacity
                style={[localStyles.settingRowSection, localStyles.settingRowLeft]}
                onPress={() => selectRandomSomedayTask(userId)}
            >
                <Icon name={'shuffle'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {mobileNav ? (
                    <Text style={[styles.body1]} numberOfLines={1}>
                        {`${somedayTaskTriggerPercent}%`}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate(`Random someday task`)}
                    </Text>
                )}
            </TouchableOpacity>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                {!mobileNav && (
                    <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                        {`${somedayTaskTriggerPercent}%`}
                    </Text>
                )}
                <Popover
                    content={
                        <ChangeNumberTodayTasks
                            customTitle={translate('Chance for random someday task')}
                            customSubtitle={translate(
                                'Percent chance to select a random task from someday when starting a new day'
                            )}
                            closePopover={() => setOpen(false)}
                            onSaveData={changeData}
                            currentValue={somedayTaskTriggerPercent}
                            hideUnlimitedButton={true}
                            allowZeroValue={true}
                            customPropertyName="Percent"
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
