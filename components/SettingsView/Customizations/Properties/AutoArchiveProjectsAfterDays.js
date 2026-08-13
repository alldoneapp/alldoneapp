import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import AutoArchiveProjectsAfterDaysModal from '../../../UIComponents/FloatModals/AutoArchiveProjectsAfterDaysModal'
import {
    formatAutoArchiveProjectsAfterDays,
    normalizeAutoArchiveProjectsAfterDays,
} from './autoArchiveProjectsAfterDaysHelper'

export default function AutoArchiveProjectsAfterDays({ userId, autoArchiveProjectsAfterDays }) {
    const mobile = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)
    const currentValue = normalizeAutoArchiveProjectsAfterDays(autoArchiveProjectsAfterDays)
    const { textKey, interpolations } = formatAutoArchiveProjectsAfterDays(currentValue)
    const currentLabel = translate(textKey, interpolations)

    return (
        <View style={localStyles.settingRow}>
            <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                <Icon name={'archive'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                    {translate('Auto-Archive projects')}
                </Text>
            </View>
            <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                <AppPopover
                    content={
                        <AutoArchiveProjectsAfterDaysModal
                            userId={userId}
                            autoArchiveProjectsAfterDays={currentValue}
                            closePopover={() => setOpen(false)}
                        />
                    }
                    onClickOutside={() => setOpen(false)}
                    isOpen={open}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button icon={'edit-2'} type={'ghost'} title={currentLabel} onPress={() => setOpen(true)} />
                </AppPopover>
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
