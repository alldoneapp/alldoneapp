import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import HeaderTab from '../AssigneeAndObserversModal/Header/HeaderTab'
import { translate } from '../../../../i18n/TranslationService'

export const CURRENT_MILESTONE = 0
export const ALL_MILESTONES = 1

export default function TabsHeader({ setActiveTab, activeTab, currentMilestoneGoalsAmount, allMilestonesGoalsAmount }) {
    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Tab') {
            setActiveTab(activeTab === CURRENT_MILESTONE ? ALL_MILESTONES : CURRENT_MILESTONE)
        }
    }

    const activeCurrentMilestoneTab = () => {
        setActiveTab(CURRENT_MILESTONE)
    }

    const activeAllMilestonesTab = () => {
        setActiveTab(ALL_MILESTONES)
    }

    return (
        <View style={localStyles.container}>
            <HeaderTab
                text={translate('Current milestone')}
                onPress={activeCurrentMilestoneTab}
                isActive={activeTab === CURRENT_MILESTONE}
                isNextShortcutTab={activeTab === ALL_MILESTONES}
                badgeValue={currentMilestoneGoalsAmount}
            />
            <HeaderTab
                text={translate('All milestones')}
                onPress={activeAllMilestonesTab}
                isActive={activeTab === ALL_MILESTONES}
                isNextShortcutTab={activeTab === CURRENT_MILESTONE}
                badgeValue={allMilestonesGoalsAmount}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 8,
    },
})
