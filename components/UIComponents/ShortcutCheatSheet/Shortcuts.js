import React from 'react'
import { useSelector } from 'react-redux'

import CheatSheet from './CheatSheet'
import GeneralAppShortcuts from './GeneralAppShortcuts'

export default function Shortcuts() {
    const activeDragTaskModeInDate = useSelector(state => state.activeDragTaskModeInDate)
    return (
        <>
            <CheatSheet />
            {!activeDragTaskModeInDate && <GeneralAppShortcuts />}
        </>
    )
}
