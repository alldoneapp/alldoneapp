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
        >
            <View style={[localStyles.rowContainer, { flexWrap: 'wrap', flex: 1, justifyContent: 'space-between' }]}>
                <View style={[localStyles.rowContainer, { marginTop: 8 }]}>
                    <Icon name="icon-circle" size={24} color="#ffffff" />
                    <Text style={localStyles.text}>{translate(currentText)}</Text>
                </View>
                <ScopeTag selectedProject={selectedProject} />
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
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 8,
    },
})
