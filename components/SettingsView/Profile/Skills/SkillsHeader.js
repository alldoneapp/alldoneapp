import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import { translate } from '../../../../i18n/TranslationService'
import styles from '../../../styles/global'
import useInProfileSettings from '../useInProfileSettings'
import ProjectHeaderMoreButton from './SkillsByProject/Sorting/ProjectHeaderMoreButton'

export default function SkillsHeader({ projectId, userId }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const inSettings = useInProfileSettings()

    const isSkillsOwner = !isAnonymous && userId === loggedUserId

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.text}>{translate('Skills')}</Text>
            {isSkillsOwner && !inSettings && (
                <View style={{ marginTop: 4, marginLeft: 8 }}>
                    <ProjectHeaderMoreButton projectId={projectId} modalAlign={'start'} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
    },
    text: {
        ...styles.title6,
    },
})
