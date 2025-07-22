import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import Icon from '../../../Icon'
import CloseButton from '../../../FollowUp/CloseButton'
import { translate } from '../../../../i18n/TranslationService'
import { PROJECT_ESTIMATION_TYPE_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { ESTIMATION_TYPE_POINTS, ESTIMATION_TYPE_TIME } from '../../../../utils/EstimationHelper'
import { setProjectEstimationType } from '../../../../utils/backends/Projects/projectsFirestore'

const ProjectEstimationTypeModal = ({ setIsOpen, project, setEstimationTypeProperty }) => {
    const setEstimationType = type => {
        if (setEstimationTypeProperty) {
            setEstimationTypeProperty(type)
        } else {
            setProjectEstimationType(project, type)
        }
        setIsOpen(false)
    }

    useEffect(() => {
        storeModal(PROJECT_ESTIMATION_TYPE_MODAL_ID)
        return () => removeModal(PROJECT_ESTIMATION_TYPE_MODAL_ID)
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={{ paddingHorizontal: 16 }}>
                <View style={{ marginBottom: 24 }}>
                    <Text style={[styles.title7, { color: '#fff' }]}>{translate('Project estimation type')}</Text>
                    <Text style={localStyles.subtitle}>
                        {translate('Choose the type of estimation to use in this project')}
                    </Text>
                </View>

                <TouchableOpacity onPress={() => setEstimationType(ESTIMATION_TYPE_POINTS)}>
                    <View style={localStyles.options}>
                        <Icon name="story-point" size={24} color="#fff" style={{ marginRight: 16 }} />
                        <Text style={localStyles.itemHeader}>{translate('Points')}</Text>
                        {project.estimationType === ESTIMATION_TYPE_POINTS && (
                            <Icon name="check" size={24} color="#fff" style={{ marginLeft: 'auto' }} />
                        )}
                    </View>
                    <View>
                        <Text style={localStyles.itemDescription}>
                            {translate('Estimates will be based on points')}
                        </Text>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setEstimationType(ESTIMATION_TYPE_TIME)} style={{ marginTop: 16 }}>
                    <View style={localStyles.options}>
                        <Icon name="clock" size={24} color="#fff" style={{ marginRight: 16 }} />
                        <Text style={localStyles.itemHeader}>{translate('Time')}</Text>
                        {project.estimationType === ESTIMATION_TYPE_TIME && (
                            <Icon name="check" size={24} color="#fff" style={{ marginLeft: 'auto' }} />
                        )}
                    </View>
                    <View>
                        <Text style={localStyles.itemDescription}>
                            {translate('Estimates will be based on minutes, hours, and days')}
                        </Text>
                    </View>
                </TouchableOpacity>
            </View>

            <CloseButton close={() => setIsOpen(false)} style={{ top: 8, right: 8 }} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 432,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        paddingVertical: 16,
    },
    subtitle: {
        ...styles.body2,
        color: colors.Text03,
    },
    options: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 8,
    },
    itemHeader: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    itemDescription: {
        ...styles.caption1,
        color: colors.Text03,
        paddingLeft: 40,
    },
})

export default ProjectEstimationTypeModal
