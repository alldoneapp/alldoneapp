import React from 'react'
import { StyleSheet, View } from 'react-native'
import PropTypes from 'prop-types'

import TasksMultiToggleSwitch from '../TasksMultiToggleSwitch'
import MainSectionTabsHeader from './MainSectionTabsHeader'

const UserTasksHeader = ({ showSectionToggle }) => {
    return (
        <View style={localStyles.container}>
            <MainSectionTabsHeader
                showSectionToggle={showSectionToggle}
                renderSectionToggle={() => <TasksMultiToggleSwitch />}
            />
        </View>
    )
}

UserTasksHeader.propTypes = {
    style: PropTypes.any,
    showSectionToggle: PropTypes.bool,
}

UserTasksHeader.defaultProps = {
    showSectionToggle: true,
}

export function getFormattedName(fullName) {
    if (fullName === 'Loading...') {
        return fullName
    }

    let name = fullName.split(' ')[0]

    if (name[name.length - 1] === 's') {
        return name + `' tasks`
    }

    return name + `'s tasks`
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
})

export default UserTasksHeader
