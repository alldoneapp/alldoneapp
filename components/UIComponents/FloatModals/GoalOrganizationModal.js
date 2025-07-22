import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import styles, { colors } from '../../styles/global'
import useWindowSize from '../../../utils/useWindowSize'
import ModalHeader from './ModalHeader'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { translate } from '../../../i18n/TranslationService'

export default function GoalOrganizationModal({
    closeModal,
    organizeOnlyThisMilestoneGoals,
    organizeOnlyThisAndLaterMilestonesGoals,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [width, height] = useWindowSize()

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <ModalHeader
                closeModal={closeModal}
                title={translate('Organise goals')}
                description={translate('Select the date range to organise')}
            />
            <TouchableOpacity style={localStyles.option} onPress={organizeOnlyThisMilestoneGoals}>
                <Hotkeys keyName="1" onKeyDown={organizeOnlyThisMilestoneGoals} filter={e => true}>
                    <Text style={localStyles.text}>{translate('All of this milestone')}</Text>
                    <View>{!smallScreenNavigation && <Shortcut text="1" theme={SHORTCUT_LIGHT} />}</View>
                </Hotkeys>
            </TouchableOpacity>
            <TouchableOpacity style={localStyles.option} onPress={organizeOnlyThisAndLaterMilestonesGoals}>
                <Hotkeys keyName="2" onKeyDown={() => {}} filter={e => true}>
                    <Text style={localStyles.text}>{translate('All of this milestone and later')}</Text>
                    <View>{!smallScreenNavigation && <Shortcut text="2" theme={SHORTCUT_LIGHT} />}</View>
                </Hotkeys>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        padding: 16,
        paddingBottom: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    option: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
