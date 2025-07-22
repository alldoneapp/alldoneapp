import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'
import CustomScrollView from '../UIControls/CustomScrollView'
import global from '../styles/global'
import styles, { colors } from '../styles/global'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME } from '../Feeds/CommentsTextInput/textInputHelper'
import Button from '../UIControls/Button'
import Backend from '../../utils/BackendBridge'
import FileTag from '../Tags/FileTag'
import Hotkeys from 'react-hot-keys'
import Icon from '../Icon'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import { updateGoogleMeetNotificationModalData } from '../../redux/actions'

const RejectMeetReasonsModal = ({ projectId, userEmail, roomId }) => {
    const dispatch = useDispatch()
    const [reasons, setReasons] = useState('')
    const [isPrivate, setPrivacy] = useState(false)
    const [isLiked, setLike] = useState(false)
    const [files, setIsFiles] = useState([])

    const reject = projectId => {
        Backend.rejectJoinEvent(projectId, roomId, userEmail, reasons, () => {})
        dispatch(updateGoogleMeetNotificationModalData(false, '', '', null))
    }
    const onChooseFile = () => {
        let input = document.createElement('input')
        input.type = 'file'
        input.onchange = event => {
            let newFiles = [...files]
            for (let i = 0; i < event.target.files.length; i++) {
                newFiles.push({ index: i, file: event.target.files[i] })
            }
            setIsFiles(newFiles)
        }
        input.click()
    }
    const removeFile = index => {
        const newFiles = [...files]
        newFiles.splice(index, 1)
        setIsFiles(newFiles)
    }

    return (
        <View style={[localStyles.parent, applyPopoverWidth()]}>
            <CustomScrollView style={localStyles.innerContainer2} showsVerticalScrollIndicator={false}>
                <View>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>Comment</Text>
                        <Text style={[global.body2, { color: colors.Text03, width: 273 }]}>
                            Comment below why you cannot join the meeting.
                        </Text>
                    </View>
                    <View style={localStyles.container}>
                        <View style={localStyles.inputContainer}>
                            <View style={{ marginBottom: 8, minHeight: 38 }}>
                                <CustomTextInput3
                                    ref={this.inputTask}
                                    placeholder={'Type your reasons'}
                                    placeholderTextColor={colors.Text03}
                                    onChangeText={value => setReasons(value)}
                                    multiline={true}
                                    externalTextStyle={localStyles.textInputText}
                                    caretColor="white"
                                    autoFocus={true}
                                    externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                                    initialTextExtended={reasons}
                                    projectId={projectId}
                                    styleTheme={CREATE_TASK_MODAL_THEME}
                                    setMentionsModalActive={() => {}}
                                />
                            </View>

                            {files.length > 0 && (
                                <View style={{ flexDirection: 'row', overflow: 'hidden', flexWrap: 'wrap' }}>
                                    {files.map((file, i) => {
                                        return (
                                            <View key={i} style={{ marginRight: i % 2 === 0 ? 4 : 0, marginBottom: 8 }}>
                                                <FileTag
                                                    key={i}
                                                    file={file}
                                                    canBeRemoved={true}
                                                    onCloseFile={() => removeFile(i)}
                                                    textStyle={{ maxWidth: 66 }}
                                                />
                                            </View>
                                        )
                                    })}
                                </View>
                            )}
                        </View>
                        <View style={localStyles.buttonsContainer}>
                            <View style={localStyles.buttonsLeft}>
                                <Hotkeys keyName={'alt+p'} onKeyDown={() => setPrivacy(!isPrivate)} filter={e => true}>
                                    <Button
                                        icon={'users'}
                                        iconColor={colors.Text04}
                                        title={'Privacy'}
                                        titleStyle={{ color: colors.Text04 }}
                                        buttonStyle={{
                                            backgroundColor: !isPrivate ? colors.Secondary200 : colors.Secondary400,
                                            marginRight: 4,
                                        }}
                                        onPress={() => setPrivacy(!isPrivate)}
                                        shortcutText={'P'}
                                        forceShowShortcut={true}
                                    />
                                </Hotkeys>
                                <Hotkeys keyName={'alt+u'} onKeyDown={() => onChooseFile()} filter={e => true}>
                                    <Button
                                        icon={'folder-plus'}
                                        iconColor={colors.Text04}
                                        buttonStyle={{ backgroundColor: colors.Secondary200, marginRight: 4 }}
                                        onPress={() => onChooseFile()}
                                        shortcutText={'U'}
                                        forceShowShortcut={true}
                                    />
                                </Hotkeys>
                                <Hotkeys keyName={'alt+l'} onKeyDown={() => setLike(!isLiked)} filter={e => true}>
                                    <Button
                                        icon={'thumbs-up'}
                                        iconColor={colors.Text04}
                                        buttonStyle={{
                                            backgroundColor: !isLiked ? colors.Secondary200 : colors.Secondary400,
                                        }}
                                        onPress={() => setLike(!isLiked)}
                                        shortcutText={'L'}
                                        forceShowShortcut={true}
                                    />
                                </Hotkeys>
                            </View>
                            <View style={localStyles.buttonsRight}>
                                <Hotkeys
                                    keyName={'alt+enter,enter'}
                                    onKeyDown={() => reject(projectId)}
                                    filter={e => true}
                                >
                                    <Button
                                        disabled={!reasons}
                                        icon={'plus'}
                                        iconColor={'#ffffff'}
                                        type={'primary'}
                                        onPress={() => reject(projectId)}
                                        shortcutText={'Enter'}
                                        forceShowShortcut={true}
                                    />
                                </Hotkeys>
                            </View>
                        </View>
                    </View>
                </View>
            </CustomScrollView>
            <View style={localStyles.closeContainer}>
                <Hotkeys keyName={'alt+esc,esc'} onKeyDown={(sht, event) => reject(projectId)} filter={e => true}>
                    <TouchableOpacity
                        accessibilityLabel={'social-text-block'}
                        style={localStyles.closeButton}
                        onPress={() => reject(projectId)}
                    >
                        <Icon accessibilityLabel={'social-text-block'} name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        flex: 1,
        zIndex: 1,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        maxWidth: 305,
        minWidth: 305,
        height: 'auto',
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    innerContainer2: {
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: 13,
        right: 13,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 8,
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
})

export default RejectMeetReasonsModal
