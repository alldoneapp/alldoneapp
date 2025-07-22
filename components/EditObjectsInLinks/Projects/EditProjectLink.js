import React, { useRef, useState } from 'react'
import { checkDVLink } from '../../../utils/LinkingHelper'
import URLTrigger from '../../../URLSystem/URLTrigger'
import NavigationService from '../../../utils/NavigationService'
import { StyleSheet, View } from 'react-native'
import Icon from '../../Icon'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import styles, { colors } from '../../styles/global'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import SaveButton from '../Common/SaveButton'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import ColorButton from '../../AddNewProject/ColorButton'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { getPathname } from '../../Tags/LinkTag'
import { COMMENT_MODAL_ID, exitsOpenModals, TAGS_EDIT_OBJECT_MODAL_ID } from '../../ModalsManager/modalsManager'
import { setProjectColor, setProjectName } from '../../../utils/backends/Projects/projectsFirestore'

export default function EditProjectLink({ containerStyle, projectData, closeModal, objectUrl }) {
    const projectId = projectData.id
    const [project, setProject] = useState(ProjectHelper.getProjectById(projectData.id))
    const inputText = useRef()

    const cleanedTitle = project.name.trim()

    const needBeUpdated = () => {
        return project.name.trim() !== projectData.name.trim()
    }

    const setColor = color => {
        setProjectColor(project, color)
        closeModal()
    }

    const onChangeText = name => {
        setProject(project => ({ ...project, name }))
    }

    const updateProject = (openDetails = false) => {
        if (project.name.trim().length > 0) {
            setProjectName(projectData, project.name.trim())

            if (openDetails) {
                openDV()
            } else {
                closeModal()
            }
        }
    }

    const openDV = () => {
        closeModal()

        setTimeout(() => {
            checkDVLink('project')
            const linkUrl = objectUrl != null ? getPathname(objectUrl) : `/project/${projectId}/properties`
            URLTrigger.processUrl(NavigationService, linkUrl)
        }, 400)
    }

    const enterKeyAction = () => {
        if (!exitsOpenModals([COMMENT_MODAL_ID, TAGS_EDIT_OBJECT_MODAL_ID])) {
            needBeUpdated() ? updateProject() : closeModal()
        }
    }

    const userIsNormalUserInGuide = ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return !project ? null : (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <Icon name={'circle'} size={24} color={'#ffffff'} style={localStyles.icon} />
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={'Type to edit the project'}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        disabledTags={true}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={project.name}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                        disabledEdition={userIsNormalUserInGuide}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton
                        onPress={needBeUpdated() ? () => updateProject(true) : openDV}
                        disabled={!cleanedTitle}
                    />

                    {!userIsNormalUserInGuide && <ColorButton value={project.color} setColor={setColor} />}
                </View>
                <View style={localStyles.buttonsRight}>
                    <SaveButton
                        icon={(!needBeUpdated() || !cleanedTitle) && 'x'}
                        onPress={needBeUpdated() && !userIsNormalUserInGuide ? () => updateProject() : closeModal}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
    buttonsRight: {},
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
