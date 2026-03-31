import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import ChangeNumberTodayTasks from '../../../UIComponents/FloatModals/ChangeNumberTodayTasks'
import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import { updateAssistantHeartbeatSettings } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'

export default function HeartbeatChanceProperty({ disabled, projectId, assistant }) {
    const mobile = useSelector(state => state.smallScreen)
    const mobileNav = useSelector(state => state.smallScreenNavigation)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const [open, setOpen] = useState(false)

    const isDefaultAssistantInDefaultProject = assistant.isDefault && projectId === defaultProjectId
    const chancePercent = assistant.heartbeatChancePercent ?? (isDefaultAssistantInDefaultProject ? 10 : 0)

    const changeData = percent => {
        const value = percent > 100 ? 100 : percent < 0 ? 0 : percent
        updateAssistantHeartbeatSettings(projectId, assistant, { heartbeatChancePercent: value })
    }

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'zap'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {mobileNav ? (
                    <Text style={[styles.body1]} numberOfLines={1}>
                        {`${chancePercent}%`}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate('Execution chance')}
                    </Text>
                )}
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                {!mobileNav && (
                    <Text style={[styles.body1, { marginRight: 8 }]} numberOfLines={1}>
                        {`${chancePercent}%`}
                    </Text>
                )}
                <Popover
                    content={
                        <ChangeNumberTodayTasks
                            customTitle={translate('Heartbeat execution chance')}
                            customSubtitle={translate(
                                'Percent chance the heartbeat prompt will execute each 30-minute interval'
                            )}
                            closePopover={() => setOpen(false)}
                            onSaveData={changeData}
                            currentValue={chancePercent}
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
                    <Button icon={'edit-2'} type={'ghost'} onPress={() => setOpen(true)} disabled={disabled} />
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
