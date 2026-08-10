import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View, TextInput } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles from '../styles/global'
import Icon from '../Icon'
import AddButton from './AddButton'
import ColorButton from './ColorButton'
import { setAddProjectStatus, startLoadingData, stopLoadingData, setSidebarInputOpenType } from '../../redux/actions'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../SidebarMenu/Themes'
import { PROJECT_COLOR_BLUE } from '../../Themes/Modern/ProjectColors'
import { translate } from '../../i18n/TranslationService'
import ProjectHelper, { PROJECT_PUBLIC } from '../SettingsView/ProjectsSettings/ProjectHelper'
import PrivacyButton from './PrivacyButton'
import { uploadNewProject } from '../../utils/backends/firestore'

export default function AddProjectForm({ closeForm, scrollToBottom, addingTemplate }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const [privacy, setPrivacy] = useState(PROJECT_PUBLIC)
    const [color, setColor] = useState(PROJECT_COLOR_BLUE)
    const [name, setName] = useState('')
    const inputText = useRef()
    const projectDataRef = useRef({ name, color, privacy })
    let inProgress = useRef(false).current

    const theme = getTheme(Themes, loggedUser.themeName, 'CustomSideMenu.AddProject.AddProjectForm')

    useEffect(() => {
        dispatch(setSidebarInputOpenType(addingTemplate ? 'template' : 'normal'))
        return () => {
            dispatch(setSidebarInputOpenType(null))
        }
    }, [])

    useEffect(() => {
        inputText.current.focus()
        document.addEventListener('keydown', onPressEnter)

        return () => {
            document.removeEventListener('keydown', onPressEnter)
            dispatch(setAddProjectStatus(false))
        }
    }, [])

    useEffect(() => {
        projectDataRef.current = { name, color, privacy }
    }, [name, color, privacy])

    const setProjectColor = color => {
        inputText.current.focus()
        setColor(color)
    }

    const setProjectPrivacy = privacy => {
        inputText.current.focus()
        setPrivacy(privacy)
    }

    const onPressEnter = e => {
        if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            addNewProject()
        }
    }

    const addNewProject = () => {
        const pData = projectDataRef.current
        if (pData.name.trim().length > 0 && !inProgress) {
            inProgress = true
            const project = ProjectHelper.getNewDefaultProject()
            project.name = pData.name.trim()
            project.color = pData.color
            project.isShared = pData.privacy
            if (addingTemplate) {
                project.isTemplate = true
                project.templateCreatorId = loggedUser.uid
            }

            dispatch(startLoadingData())
            uploadNewProject(project, loggedUser, [], false, addingTemplate).then(() => {
                dispatch(stopLoadingData())
                inProgress = false
            })
            closeForm()
        }
    }

    return (
        <View style={[localStyles.container, theme.container]}>
            <View style={localStyles.inputContainer}>
                <Icon size={22} name={'plus-square'} color={theme.icon} />
                <TextInput
                    ref={inputText}
                    value={name}
                    onChangeText={text => setName(text)}
                    style={[localStyles.textInput, theme.textInput]}
                    numberOfLines={1}
                    multiline={false}
                    placeholder={translate(addingTemplate ? 'Add new template' : 'Add new project')}
                    placeholderTextColor={theme.placeholderText}
                    onFocus={e => {
                        if (e) {
                            e.preventDefault()
                            e.stopPropagation()
                        }
                    }}
                />
            </View>
            <View style={[localStyles.buttonsContainer, theme.buttonsContainer]}>
                <View style={localStyles.subBtn}>
                    <ColorButton
                        value={color}
                        setColor={setProjectColor}
                        style={{ marginRight: 4 }}
                        scrollToBottom={scrollToBottom}
                        disabled={inProgress}
                    />
                    <PrivacyButton value={privacy} setPrivacy={setProjectPrivacy} disabled={inProgress} />
                </View>
                <View style={localStyles.subBtn}>
                    <AddButton
                        successAction={name && name.trim() !== ''}
                        onPress={name && name.trim() !== '' ? addNewProject : closeForm}
                        style={theme.addButton}
                        disabled={inProgress}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderRadius: 4,
        minHeight: 110,
        marginHorizontal: 12,
        overflow: 'hidden',
    },
    inputContainer: {
        flexDirection: 'row',
        paddingHorizontal: 11,
        alignItems: 'center',
        height: 54,
    },
    textInput: {
        ...styles.body1,
        width: 186,
        marginLeft: 8,
    },
    buttonsContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 11,
        padding: 8,
    },
    subBtn: {
        flexDirection: 'row',
    },
})
