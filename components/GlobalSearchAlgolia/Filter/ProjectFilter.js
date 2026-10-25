import React from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import ScopeTag from './ScopeTag'
import styles from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function ProjectFilter({ setShowSelectProjectModal, selectedProject, containerStyle, disabled, text }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const currentText = text ? text : smallScreenNavigation ? 'Select scope' : 'Select search scope'
    return (
        <TouchableOpacity
            disabled={disabled}
            onPress={setShowSelectProjectModal}
            style={[localStyles.container, containerStyle]}
            testID="project-filter"
        >
            <View style={[localStyles.rowContainer, localStyles.content]} testID="project-filter-content">
                <View style={[localStyles.rowContainer, localStyles.label]} testID="project-filter-label">
                    <Icon name="icon-circle" size={24} color="#ffffff" />
                    <Text style={localStyles.text}>{translate(currentText)}</Text>
                </View>
                <View style={[localStyles.rowContainer, localStyles.scope]} testID="project-filter-scope">
                    <ScopeTag selectedProject={selectedProject} />
                </View>
            </View>
            <Hotkeys keyName={'alt+1'} onKeyDown={setShowSelectProjectModal} filter={e => true} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        alignItems: 'flex-start',
        marginTop: 20,
        marginBottom: 8,
        paddingBottom: 8,
    },
    rowContainer: {
        flexDirection: 'row',
    },
    content: {
        flex: 1,
        minWidth: 0,
        justifyContent: 'flex-start',
    },
    label: {
        flexShrink: 0,
        marginTop: 8,
        marginRight: 16,
    },
    scope: {
        flexShrink: 1,
        minWidth: 0,
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 8,
    },
})
