import React from 'react'
import { StyleSheet, View } from 'react-native'

import Icon from '../../../Icon'
import Spinner from '../../Spinner'

/**
 * The trailing slot of a project pick-list row: a spinner while that row's
 * selection is still being carried out, otherwise the current-selection check.
 *
 * The four row components (project, All projects, Automatic, All archived) each
 * carried their own copy of the check block, which is why a busy state could not
 * be added in one place. It matters because committing a row is not always
 * instant — a cross-project move is several seconds of work across two projects,
 * and until this the picker sat there looking untouched while it ran.
 *
 * The spinner takes the check's place rather than sitting next to it: a row that
 * is being committed is on its way to becoming the selected one, so showing both
 * at once would claim a state the row has not reached yet.
 */
export default function ProjectRowStatusIcon({ busy, checked }) {
    if (!busy && !checked) return null

    return (
        <View style={localStyles.container}>
            {busy ? (
                <Spinner containerSize={24} spinnerSize={16} containerColor={'transparent'} />
            ) : (
                <Icon name="check" size={24} color="white" />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 'auto',
    },
})
