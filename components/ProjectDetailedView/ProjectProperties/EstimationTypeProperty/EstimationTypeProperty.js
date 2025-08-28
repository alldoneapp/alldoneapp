import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Button from '../../../UIControls/Button'
import ProjectEstimationTypeModal from './ProjectEstimationTypeModal'
import styles, { colors, em2px } from '../../../styles/global'
import { StyleSheet, Text, View } from 'react-native'
import { translate } from '../../../../i18n/TranslationService'
import Icon from '../../../Icon'
import { ESTIMATION_TYPE_POINTS } from '../../../../utils/EstimationHelper'

const EstimationTypeProperty = ({ project, disabled }) => {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <View style={localStyles.propertyRow}>
            <View style={[localStyles.propertyRowSection, localStyles.propertyRowLeft]}>
                <Icon name={'timer'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Estimation type')}</Text>
            </View>
            <View style={[localStyles.propertyRowSection, localStyles.propertyRowRight]}>
                <Popover
                    isOpen={isOpen}
                    onClickOutside={() => setIsOpen(false)}
                    align={'center'}
                    position={['left', 'bottom', 'top']}
                    content={<ProjectEstimationTypeModal setIsOpen={setIsOpen} project={project} />}
                >
                    <Button
                        title={translate(project.estimationType === ESTIMATION_TYPE_POINTS ? 'Points' : 'Time')}
                        icon={
                            <Icon
                                name={project.estimationType === ESTIMATION_TYPE_POINTS ? 'story-point' : 'clock' }
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

export default EstimationTypeProperty
