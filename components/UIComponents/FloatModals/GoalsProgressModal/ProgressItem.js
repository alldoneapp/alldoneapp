import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { translate } from '../../../../i18n/TranslationService'
import { PROJECT_COLOR_SYSTEM } from '../../../../Themes/Modern/ProjectColors'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ProgressItem({
    progressData,
    setSelectedProgress,
    selectedProgress,
    useProjectColor,
    projectId,
    disabledShorcut,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    let { circleBorderColor, circleBackgroundColor, text, percent, shortcutKey } = progressData
    if (useProjectColor && percent === 0) {
        const projectColor = ProjectHelper.getProjectColorById(projectId)
        circleBorderColor = PROJECT_COLOR_SYSTEM[projectColor].MARKER
        circleBackgroundColor = PROJECT_COLOR_SYSTEM[projectColor].PROJECT_ITEM_SECTION_ITEM_ACTIVE
    }
    const selectProgress = () => {
        setSelectedProgress(percent)
    }
    return (
        <TouchableOpacity style={localStyles.container} onPress={selectProgress}>
            <Hotkeys keyName={shortcutKey} onKeyDown={selectProgress} filter={e => true} disabled={disabledShorcut}>
                <View style={localStyles.containerOption}>
                    <View
                        style={[
                            localStyles.circle,
                            { backgroundColor: circleBackgroundColor, borderColor: circleBorderColor },
                        ]}
                    >
                        {selectedProgress === percent && <Icon name="check-small" color="#ffffff" size={24} />}
                    </View>
                    <Text style={localStyles.text}>{translate(text)}</Text>
                </View>
                <View style={{ justifyContent: 'center' }}>
                    {!smallScreenNavigation && <Shortcut text={shortcutKey} theme={SHORTCUT_LIGHT} />}
                </View>
            </Hotkeys>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 40,
        paddingVertical: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    containerOption: {
        flexDirection: 'row',
    },
    circle: {
        height: 24,
        width: 24,
        borderWidth: 2,
        borderRadius: 1000,
        marginRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
