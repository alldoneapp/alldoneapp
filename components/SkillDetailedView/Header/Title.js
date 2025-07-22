import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import TitlePresentation from './TitlePresentation'
import TitleEdition from './TitleEdition'
import { DV_TAB_SKILL_CHAT, DV_TAB_SKILL_NOTE } from '../../../utils/TabNavigationConstants'
import styles, { colors } from '../../styles/global'

export default function Title({ projectId }) {
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const selectedNavItem = useSelector(state => state.selectedNavItem)
    const skill = useSelector(state => state.skillInDv)
    const [editionMode, setEditionMode] = useState(false)
    const [showEllipsis, setShowEllipsis] = useState(false)
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

    const onTitleLayoutChange = ({ nativeEvent }) => {
        const { layout } = nativeEvent

        if (layout.height > maxHeight && !showEllipsis) {
            setShowEllipsis(true)
        } else if (layout.height <= maxHeight && showEllipsis) {
            setShowEllipsis(false)
        }
    }

    return (
        <View style={[localStyles.titleContainer, { maxHeight: maxHeight }]}>
            {editionMode ? (
                <TitleEdition skill={skill} projectId={projectId} closeTitleEdition={closeTitleEdition} />
            ) : (
                <View onLayout={onTitleLayoutChange}>
                    <TitlePresentation projectId={projectId} openTitleEdition={openTitleEdition} skill={skill} />
                </View>
            )}
            {showEllipsis && !editionMode && (
                <Text style={[localStyles.ellipsis, { right: smallScreenNavigation ? 32 : 80 }]}>...</Text>
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
    ellipsis: {
        ...styles.title4,
        color: colors.Text01,
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        position: 'absolute',
        bottom: 0,
        right: 0,
    },
})
