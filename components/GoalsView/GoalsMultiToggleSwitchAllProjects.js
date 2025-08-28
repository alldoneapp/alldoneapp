import React from 'react'
import { StyleSheet } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import MultiToggleSwitch from '../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import { setGoalsActiveTab } from '../../redux/actions'

export default function GoalsMultiToggleSwitchAllProjects() {
    const dispatch = useDispatch()
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const openGoalsAmount = useSelector(state => state.openGoalsAmountByProject.total)
    const doneGoalsAmount = useSelector(state => state.doneGoalsAmountByProject.total)

    const updateGoalsActiveTab = activeTab => {
        dispatch(setGoalsActiveTab(activeTab))
    }

    return (
        <MultiToggleSwitch
            options={[
                {
                    icon: 'square',
                    text: 'Open',
                    badge: openGoalsAmount,
                },
                {
                    icon: 'square-checked-gray',
                    text: 'Done',
                    badge: doneGoalsAmount,
                },
            ]}
            currentIndex={goalsActiveTab}
            onChangeOption={updateGoalsActiveTab}
            containerStyle={localStyles.toggleSwitch}
        />
    )
}

const localStyles = StyleSheet.create({
    toggleSwitch: {
        position: 'absolute',
        right: 0,
        top: 44,
        zIndex: 10,
    },
})
