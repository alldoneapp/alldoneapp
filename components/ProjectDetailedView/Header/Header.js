import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import ProjectTitle from './ProjectTitle'
import Indicator from './Indicator'
import BackButton from './BackButton'
import MyPlatform from '../../MyPlatform'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import TagList from './TagList'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import { Dismissible } from 'react-dismissible'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'
import SharedHelper from '../../../utils/SharedHelper'
import { setProjectName } from '../../../utils/backends/Projects/projectsFirestore'

const Header = ({ project }) => {
    const [inputWidth, setInputWidth] = useState(0)
    const [editTitle, setEditTitle] = useState(false)
    const [focused, setFocused] = useState(true)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const mobile = useSelector(state => state.isMiddleScreen)
    const loggedUser = useSelector(state => state.loggedUser)
    const [projectTitle, setProjectTitle] = useState(project.name)
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)

    const inputText = useRef()
    const mainContainer = useRef()
    const buttonsContainer = useRef()

    useEffect(() => {
        if (showGlobalSearchPopup && editTitle) {
            cancelEditForm()
        }
    }, [showGlobalSearchPopup, editTitle])

    const onFocus = () => {
        setFocused(true)
    }

    const onBlur = () => {
        setFocused(false)
    }

    const updateInputWidth = async () => {
        if (mainContainer?.current !== undefined) {
            const containerWidth = await MyPlatform.getElementWidth(mainContainer.current)
            const buttonsContainerWidth = await MyPlatform.getElementWidth(buttonsContainer.current)
            setInputWidth(containerWidth - buttonsContainerWidth)
        }
    }

    const onChangeText = value => {
        setProjectTitle(value)
    }

    const cancelEditForm = () => {
        setProjectTitle(project.name)
        setEditTitle(false)
    }

    const applyTitleChanges = () => {
        if (projectTitle.trim() !== '') {
            setProjectName(project, projectTitle.trim())
        } else {
            setProjectTitle(project.name)
        }
        setEditTitle(false)
    }

    const onInputKeyPress = key => {
        if (key === 'Enter') {
            applyTitleChanges()
        } else if (key === 'Escape') {
            cancelEditForm()
        }
    }

    let disabledBtn = project.name === projectTitle
    const projectId = project.id

    return (
        <View style={localStyles.container}>
            <View style={localStyles.upperHeader}>
                {mobile && accessGranted && (
                    <View style={localStyles.backButtonMobile}>
                        <BackButton project={project} />
                    </View>
                )}

                {!editTitle ? (
                    <TouchableOpacity style={[localStyles.upperHeader, { flex: 1 }]} onPress={() => setEditTitle(true)}>
                        <View style={[localStyles.upperHeader, { flex: 1 }]}>
                            <View style={{ marginRight: 'auto', flex: 1 }}>
                                <ProjectTitle project={project} />
                            </View>
                            <View>
                                <Indicator />
                            </View>
                        </View>
                    </TouchableOpacity>
                ) : (
                    <View ref={mainContainer} style={[localStyles.inputContainer]} onLayout={updateInputWidth}>
                        <View
                            style={[
                                localStyles.textInputContainer,
                                focused ? localStyles.inputContainerFocused : localStyles.inputContainerBlurred,
                                { width: inputWidth },
                            ]}
                        >
                            <Dismissible
                                disabled={exitsOpenModals()}
                                click={true}
                                escape={true}
                                onDismiss={cancelEditForm}
                            >
                                <CustomTextInput3
                                    ref={inputText}
                                    numberOfLines={1}
                                    autoFocus={true}
                                    initialTextExtended={projectTitle}
                                    onKeyPress={onInputKeyPress}
                                    placeholderTextColor={colors.Text03}
                                    containerStyle={[
                                        localStyles.textInput,
                                        !focused ? localStyles.inputTextBlurred : undefined,
                                        { width: inputWidth },
                                    ]}
                                    onFocus={onFocus}
                                    onBlur={onBlur}
                                    onChangeText={onChangeText}
                                    projectId={projectId}
                                    projectIndex={project.index}
                                    placeholder={translate('Write the name of the project')}
                                    singleLine={true}
                                    disabledTags={true}
                                    forceTriggerEnterActionForBreakLines={applyTitleChanges}
                                />
                            </Dismissible>
                        </View>

                        <View ref={buttonsContainer} style={localStyles.buttonsContainer}>
                            <Button
                                type={'secondary'}
                                icon={'x'}
                                buttonStyle={localStyles.secondaryBtn}
                                onPress={cancelEditForm}
                            />
                            <Button type={'primary'} icon={'save'} disabled={disabledBtn} onPress={applyTitleChanges} />
                        </View>
                    </View>
                )}
            </View>

            <View style={localStyles.bottomHeader}>
                <TagList project={project} />
            </View>
        </View>
    )
}

export default Header

const localStyles = StyleSheet.create({
    container: {
        minHeight: 140,
        flexDirection: 'column',
        justifyContent: 'space-between',
        paddingBottom: 24,
    },
    upperHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    bottomHeader: {
        flexDirection: 'row',
    },
    backButtonMobile: {
        left: -16,
    },

    // input styles
    inputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 28,
    },
    textInputContainer: {
        flex: 1,
        height: 40,
        borderWidth: 2,
        borderRadius: 4,
        overflow: 'hidden',
        flexDirection: 'row',
        alignItems: 'center',
    },
    inputContainerFocused: {
        borderWidth: 2,
        borderColor: colors.UtilityBlue200,
    },
    inputContainerBlurred: {
        borderWidth: 1,
        height: 42,
        borderColor: colors.Grey400,
    },
    inputTextBlurred: {
        height: 24,
        left: -1,
        color: colors.Text03,
    },
    textInput: {
        paddingHorizontal: 14,
        paddingTop: 0,
        height: 24,
    },
    buttonsContainer: {
        flexDirection: 'row',
    },
    secondaryBtn: {
        marginLeft: 8,
        marginRight: 8,
    },
})
