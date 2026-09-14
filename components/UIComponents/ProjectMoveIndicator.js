import React from 'react'
import { StyleSheet, View } from 'react-native'

import { isProjectMovePending } from '../../utils/projectMoveState'
import Spinner from './Spinner'
import { colors } from '../styles/global'

export default function ProjectMoveIndicator({ object, style }) {
    if (!isProjectMovePending(object)) return null

    return (
        <View
            pointerEvents="none"
            style={[localStyles.container, style]}
            testID={`project-move-spinner-${object?.id || object?.uid || 'object'}`}
        >
            <Spinner containerSize={24} spinnerSize={16} containerColor={colors.Grey200} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 7,
        right: 8,
        zIndex: 20,
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
