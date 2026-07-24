import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import CloseButton from '../../../FollowUp/CloseButton'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import { COPY_PROJECT_OPTIONS } from './CopyProjectOptions'
import CopyProjectItem from './CopyProjectItem'
import { COPY_PROJECT_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { duplicateProject } from '../../../../utils/backends/firestore'
import NavigationService from '../../../../utils/NavigationService'
import { navigateToSettings } from '../../../../redux/actions'
import LogInButton from '../../../UIControls/LogInButton'
import { DV_TAB_SETTINGS_PROJECTS } from '../../../../utils/TabNavigationConstants'

const CopyProjectModal = ({ setIsOpen, project }) => {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [selectedOptions, setSelectedOptions] = useState(new Map(COPY_PROJECT_OPTIONS.map(it => [it.value, true])))
    const selectedOptionsRef = useRef(selectedOptions)
    const dispatch = useDispatch()

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        storeModal(COPY_PROJECT_MODAL_ID)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            removeModal(COPY_PROJECT_MODAL_ID)
        }
    }, [])

    useEffect(() => {
        selectedOptionsRef.current = selectedOptions
    }, [selectedOptions])

    const onPressOption = option => {
        const tmpOptions = new Map(selectedOptions)
        if (tmpOptions.has(option)) {
            tmpOptions.delete(option)
        } else {
            tmpOptions.set(option)
        }
        setSelectedOptions(tmpOptions)
    }

    const onDone = () => {
        const options = Array.from(selectedOptions.keys())
        duplicateProject(project.id, options)

        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROJECTS }))
        NavigationService.navigate('SettingsView')
        setIsOpen(false)
    }

    const onKeyDown = ({ key }) => {
        if (key === 'Enter' && selectedOptionsRef.current.size > 0) {
            onDone()
        } else if (key === 'Escape') {
            setIsOpen(false)
        }
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={{ paddingHorizontal: 16 }}>
                <View style={{ marginBottom: 24 }}>
                    <Text style={[styles.title7, { color: '#fff' }]}>{translate('Duplicate project')}</Text>
                    <Text style={localStyles.subtitle}>{translate('Duplicate project description')}</Text>
                    <Text style={localStyles.subtitle2}>
                        {translate(isAnonymous ? 'Duplicate project description3' : 'Duplicate project description2')}
                    </Text>
                </View>

                {!isAnonymous && (
                    <View>
                        {COPY_PROJECT_OPTIONS.map((option, i) => {
                            return (
                                <CopyProjectItem
                                    key={i}
                                    name={option.name}
                                    description={option.description}
                                    icon={option.icon}
                                    style={i > 0 && { marginTop: 16 }}
                                    isActive={selectedOptions.has(option.value)}
                                    onPress={() => onPressOption(option.value)}
                                />
                            )
                        })}
                    </View>
                )}
            </View>

            <CloseButton close={() => setIsOpen(false)} style={{ top: 8, right: 8 }} />

            <View style={localStyles.sectionSeparator} />

            <View style={localStyles.bottomSection}>
                {isAnonymous ? (
                    <LogInButton btnId={'google-sign-in-btn22'} />
                ) : (
                    <Button
                        disabled={selectedOptions.size === 0}
                        title={translate('Duplicate project')}
                        type="primary"
                        buttonStyle={{ marginLeft: 8 }}
                        onPress={onDone}
                        shortcutText={'Enter'}
                    />
                )}
            </View>
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
    subtitle2: {
        ...styles.body2,
        color: colors.Gray200,
        paddingTop: 8,
    },
    sectionSeparator: {
        height: 1,
        width: '100%',
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 16,
    },
    bottomSection: {
        flex: 1,
        minHeight: 40,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
})

export default CopyProjectModal
