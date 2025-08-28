import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import NothingToShow from '../../../UIComponents/NothingToShow'
import useInProfileSettings from '../useInProfileSettings'
import EmptySkillsAreaTags from './EmptySkillsAreaTags'

export default function EmptySkillsArea() {
    const skillsAmount = useSelector(state => state.skillsByProject.total)
    const inSettings = useInProfileSettings()

    return (
        skillsAmount === 0 && (
            <View style={{ alignItems: 'center' }}>
                <NothingToShow
                    mainText="Add skills to journal the progress"
                    hideButton={true}
                    hideSecondaryText={true}
                    containerStyle={!inSettings && { marginBottom: 32 }}
                    hideImage={true}
                />
                {inSettings && <EmptySkillsAreaTags />}
            </View>
        )
    )
}
