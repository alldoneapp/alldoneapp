import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Button from '../../../UIControls/Button'
import ProjectPrivacyModal from './ProjectPrivacyModal'
import styles, { colors, em2px } from '../../../styles/global'
import { StyleSheet, Text, View } from 'react-native'
import { translate } from '../../../../i18n/TranslationService'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import Icon from '../../../Icon'

const PrivacyProperty = ({ project, disabled }) => {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <View style={localStyles.propertyRow}>
            <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                <Icon name={'lock'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Project privacy')}</Text>
            </View>
            <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                <Popover
                    isOpen={isOpen}
                    onClickOutside={() => setIsOpen(false)}
                    align={'center'}
                    position={['left', 'bottom', 'top']}
                    content={<ProjectPrivacyModal setIsOpen={setIsOpen} project={project} />}
                >
                    <Button
                        title={translate(ProjectHelper.getProjectIsSharedTitle(project.isShared))}
                        icon={
                            <Icon
                                name={ProjectHelper.getProjectPrivacyIcon(project.isShared)}
                                size={24}
                                color={colors.Text03}
                            />
                        }
                        type="ghost"
                        onPress={() => setIsOpen(!isOpen)}
                        disabled={disabled}
                    />
                </Popover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    text: {
        fontFamily: 'Roboto-Regular',
        fontSize: 12,
        lineHeight: 14,
        letterSpacing: em2px(0.03),
        color: colors.Text03,
        maxWidth: 142,
    },
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

export default PrivacyProperty
