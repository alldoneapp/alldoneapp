import React, { useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import Icon from '../../../Icon'
import CloseButton from '../../../FollowUp/CloseButton'
import { translate } from '../../../../i18n/TranslationService'
import {
    PROJECT_PRIVATE,
    PROJECT_PUBLIC,
    PROJECT_RESTRICTED,
} from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_PRIVACY_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { setProjectIsShared } from '../../../../utils/backends/Projects/projectsFirestore'

const ProjectPrivacyModal = ({ setIsOpen, project, setSharedProperty }) => {
    const setSharedState = sharedValue => {
        if (setSharedProperty) {
            setSharedProperty(sharedValue)
        } else {
            setProjectIsShared(project, sharedValue)
        }
        setIsOpen(false)
    }

    useEffect(() => {
        storeModal(PROJECT_PRIVACY_MODAL_ID)
        return () => removeModal(PROJECT_PRIVACY_MODAL_ID)
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={{ paddingHorizontal: 16 }}>
                <View style={{ marginBottom: 24 }}>
                    <Text style={[styles.title7, { color: '#fff' }]}>{translate('Project privacy')}</Text>
                    <Text style={localStyles.subtitle}>
                        {translate('Choose what people with the project link can do')}
                    </Text>
                </View>

                <TouchableOpacity onPress={() => setSharedState(PROJECT_PUBLIC)}>
                    <View style={localStyles.options}>
                        <Icon name="edit-4" size={24} color="#fff" style={{ marginRight: 16 }} />
                        <Text style={localStyles.itemHeader}>{translate('With link')}</Text>
                        {project.isShared === PROJECT_PUBLIC && (
                            <Icon name="check" size={24} color="#fff" style={{ marginLeft: 'auto' }} />
                        )}
                    </View>
                    <View>
                        <Text style={localStyles.itemDescription}>
                            {translate('People can join the project and edit')}
                        </Text>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setSharedState(PROJECT_RESTRICTED)} style={{ marginTop: 16 }}>
                    <View style={localStyles.options}>
                        <Icon name="eye" size={24} color="#fff" style={{ marginRight: 16 }} />
                        <Text style={localStyles.itemHeader}>{translate('Restricted')}</Text>
                        {project.isShared === PROJECT_RESTRICTED && (
                            <Icon name="check" size={24} color="#fff" style={{ marginLeft: 'auto' }} />
                        )}
                    </View>
                    <View>
                        <Text style={localStyles.itemDescription}>
                            {translate('People can view and duplicate the project')}
                        </Text>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setSharedState(PROJECT_PRIVATE)} style={{ marginTop: 16 }}>
                    <View style={localStyles.options}>
                        <Icon name="lock" size={24} color="#fff" style={{ marginRight: 16 }} />
                        <Text style={localStyles.itemHeader}>{translate('Private')}</Text>
                        {project.isShared === PROJECT_PRIVATE && (
                            <Icon name="check" size={24} color="#fff" style={{ marginLeft: 'auto' }} />
                        )}
                    </View>
                    <View>
                        <Text style={localStyles.itemDescription}>
                            {translate('Only invited people by email can see/join')}
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

export default ProjectPrivacyModal
