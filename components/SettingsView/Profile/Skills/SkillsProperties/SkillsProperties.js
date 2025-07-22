import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import SkillsDefaultPrivacy from './SkillsDefaultPrivacy'
import SkillPoints from './SkillPoints'
import useInProfileSettings from '../../useInProfileSettings'

export default function SkillsProperties({ projectId }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const inSettings = useInProfileSettings()

    return inSettings ? (
        <SkillPoints />
    ) : (
        <View style={[localStyles.userSettings, smallScreen && localStyles.userSettingsMobile]}>
            <View style={{ flex: 1, width: smallScreen ? '100%' : '50%', marginRight: smallScreen ? 0 : 36 }}>
                <SkillsDefaultPrivacy projectId={projectId} />
            </View>
            <View style={{ flex: 1, width: smallScreen ? '100%' : '50%', marginLeft: smallScreen ? 0 : 36 }}>
                <SkillPoints />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: { marginTop: 70, flex: 1 },
    userSettings: {
        flexDirection: 'row',
        marginTop: 7,
    },
    userSettingsMobile: {
        flexDirection: 'column',
    },
})
