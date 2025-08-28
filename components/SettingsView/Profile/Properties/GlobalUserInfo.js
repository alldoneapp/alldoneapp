import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import ChangeContactInfoModal from '../../../UIComponents/FloatModals/ChangeContactInfoModal'
import Button from '../../../UIControls/Button'
import ProjectHelper from '../../ProjectsSettings/ProjectHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function GlobalUserInfo({ userId, role, company, description }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)

    const userInfo =
        !role && !company
            ? description
                ? description
                : ''
            : `${role ? role : ''}${role && company ? ' • ' : ''}${company ? company : ''}`

    const changeData = async info => {
        await ProjectHelper.setUserInfoGlobally(userId, info.role, info.company, info.description)
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
                <Icon name={'info'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                {smallScreenNavigation ? (
                    <Text style={styles.body1} numberOfLines={1}>
                        {userInfo}
                    </Text>
                ) : (
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate('Info')}
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
                        {userInfo}
                    </Text>
                )}
                <Popover
                    content={
                        <ChangeContactInfoModal
                            closePopover={() => setOpen(false)}
                            onSaveData={changeData}
                            currentRole={role}
                            currentCompany={company}
                            currentDescription={description}
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
