import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
    isLocalContactMovePending,
    isProjectMovePending,
    subscribeLocalContactMoves,
} from '../../utils/projectMoveState'
import Spinner from './Spinner'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function ProjectMoveIndicator({ object, projectId, showLabel = false, style }) {
    const objectId = object?.uid || object?.id
    const [localPending, setLocalPending] = useState(() => isLocalContactMovePending(projectId, objectId))

    useEffect(() => {
        const update = () => setLocalPending(isLocalContactMovePending(projectId, objectId))
        update()
        return subscribeLocalContactMoves(update)
    }, [projectId, objectId])

    if (!isProjectMovePending(object) && !localPending) return null

    return (
        <View
            pointerEvents="none"
            style={[localStyles.container, showLabel && localStyles.labeledContainer, style]}
            testID={`project-move-spinner-${object?.id || object?.uid || 'object'}`}
        >
            <Spinner containerSize={24} spinnerSize={16} containerColor={colors.Grey200} />
            {showLabel && <Text style={localStyles.label}>{translate('Moving contact...')}</Text>}
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
    labeledContainer: {
        position: 'relative',
        top: 0,
        right: 0,
        width: 'auto',
        height: 32,
        flexDirection: 'row',
        paddingHorizontal: 8,
        backgroundColor: colors.Grey200,
        borderRadius: 16,
    },
    label: {
        marginLeft: 6,
        color: colors.Text03,
    },
})
