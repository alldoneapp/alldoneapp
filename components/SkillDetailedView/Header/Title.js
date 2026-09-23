import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import TitlePresentation from './TitlePresentation'
import TitleEdition from './TitleEdition'
import { DV_TAB_SKILL_CHAT, DV_TAB_SKILL_NOTE } from '../../../utils/TabNavigationConstants'

export default function Title({ projectId }) {
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const isFullScreen = useSelector(state => state.dvIsFullScreen)
    const skill = useSelector(state => state.skillInDv)
    const [editionMode, setEditionMode] = useState(false)
    const maxHeight =
        (selectedNavItem === DV_TAB_SKILL_CHAT || selectedNavItem === DV_TAB_SKILL_NOTE) && !editionMode ? 64 : 800

    const openTitleEdition = () => {
        setEditionMode(true)
    }

    const closeTitleEdition = () => {
        setEditionMode(false)
    }

    useEffect(() => {
        if (showGlobalSearchPopup && editionMode) closeTitleEdition()
    }, [showGlobalSearchPopup])

    return (
        <View style={[localStyles.titleContainer, { maxHeight: maxHeight }]}>
            {editionMode ? (
                <TitleEdition skill={skill} projectId={projectId} closeTitleEdition={closeTitleEdition} />
            ) : (
                <TitlePresentation
                    projectId={projectId}
                    openTitleEdition={openTitleEdition}
                    skill={skill}
                    hideLastEdited={isFullScreen}
                    maxHeight={maxHeight}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        marginRight: 'auto',
        flex: 1,
        maxHeight: 800,
        overflowY: 'hidden',
    },
})
