import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import ChangeNumberTodayTasks from '../../../UIComponents/FloatModals/ChangeNumberTodayTasks'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import { setBotAdvaiceTriggerPercent } from '../../../../utils/backends/Users/usersFirestore'
import Icon from '../../../Icon'

export default function BotAdvaiceTriggerPercent({ userId, botAdvaiceTriggerPercent }) {
    const mobile = useSelector(state => state.smallScreen)
    const mobileNav = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)

    const changeData = botAdvaicePercent => {
        const percent = botAdvaicePercent > 100 ? 100 : botAdvaicePercent < 0 ? 0 : botAdvaicePercent
        setBotAdvaiceTriggerPercent(userId, percent)
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'cpu'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {mobileNav ? (
                    <Text style={[styles.body1]} numberOfLines={1}>
                        {`${botAdvaiceTriggerPercent}%`}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate(`Proactive comments`)}
                    </Text>
                )}
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                {!mobileNav && (
                    <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                        {`${botAdvaiceTriggerPercent}%`}
                    </Text>
                )}
                <Popover
                    content={
                        <ChangeNumberTodayTasks
                            customTitle={translate('Percent of proactive comments')}
                            customSubtitle={translate('Percent for receive a comment when create an object')}
                            closePopover={() => setOpen(false)}
                            onSaveData={changeData}
                            currentValue={botAdvaiceTriggerPercent}
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
