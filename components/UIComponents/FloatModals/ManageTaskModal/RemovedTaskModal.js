import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'

export default function RemovedTaskModal({ closeModal }) {
    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter' || 'Escape') {
            closeModal()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <Text style={localStyles.title}>Ups, object not accessible</Text>
            <Text style={localStyles.msg}>
                Looks like this task was deleted outside this note, so you cannot see it anymore. The link tag to it is
                still here, so you don’t lose the context of it.
            </Text>
            <View style={localStyles.buttonContainer}>
                <Button
                    title="Ok"
                    type={'primary'}
                    onPress={closeModal}
                    shortcutText={'Enter'}
                    shortcutStyle={{ backgroundColor: colors.Secondary200 }}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        padding: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    msg: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 16,
    },
    buttonContainer: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
})
