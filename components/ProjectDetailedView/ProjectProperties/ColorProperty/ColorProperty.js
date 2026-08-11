import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import Popover from 'react-tiny-popover'
import ColorPickerModal from '../../../UIComponents/FloatModals/ColorPickerModal'
import Button from '../../../UIControls/Button'
import { PROJECT_COLORS } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { useSelector } from 'react-redux'
import { translate } from '../../../../i18n/TranslationService'
import { setProjectColor } from '../../../../utils/backends/Projects/projectsFirestore'

export default function ColorProperty({ project, disabled }) {
    const mobile = useSelector(state => state.smallScreen)
    const [showColorPicker, setShowColorPicker] = useState(false)

    const changeColor = color => {
        setProjectColor(project, color)
    }

    return (
        <View style={localStyles.propertyRow}>
            <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                <Icon name={'palette'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Project color')}</Text>
            </View>
            <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                <Popover
                    content={
                        <ColorPickerModal
                            color={project.color}
                            selectColor={changeColor}
                            closePopover={() => setShowColorPicker(false)}
                        />
                    }
                    onClickOutside={() => setShowColorPicker(false)}
                    isOpen={showColorPicker}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'end'}
                    contentLocation={mobile ? null : undefined}
                >
                    <Button
                        icon={'circle-poject_color'}
                        iconColor={project.color}
                        title={PROJECT_COLORS[project.color]}
                        type={'ghost'}
                        onPress={() => setShowColorPicker(true)}
                        disabled={disabled}
                    />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    propertyRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    propertyRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    propertyRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    propertyRowRight: {
        justifyContent: 'flex-end',
    },
})
