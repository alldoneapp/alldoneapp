import React, { Component } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import styles, { colors, em2px } from './styles/global'
import Icon from './Icon'
import store from '../redux/store'
import { setTaskTitleInEditMode, showConfirmPopup } from '../redux/actions'
import MyPlatform from './MyPlatform'
import { CONFIRM_POPUP_TRIGGER_DELETE_TASK } from './UIComponents/ConfirmPopup'
import { REGEX_EMAIL, REGEX_HASHTAG, REGEX_MENTION, REGEX_URL } from './Feeds/Utils/HelperFunctions'
import { DV_TAB_ROOT_TASKS } from '../utils/TabNavigationConstants'

class ParsingTextInput extends Component {
    constructor(props) {
        super(props)
        this._isMounted = false

        this.state = {
            text: [],
            innerText: this.props.value || '',
            originalText: this.props.value || '',
            inputWidth: 0,
            taskTitleInEditMode: store.getState().taskTitleInEditMode,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.inputText = React.createRef()
        this.visibleText = React.createRef()
        this.mainContainer = React.createRef()
        this.buttonsContainer = React.createRef()
    }

    // This function is used in EditTask to clear the TextInput when upload a new task
    // Without it the text will remain in text input after upload the task
    clear = () => {
        this.inputText.current.clear()
    }

    componentDidMount() {
        this._isMounted = true
        const vals = this.props.value.split(' ')

        this.focus()
        const wordList = this.htmlFormat(vals)
        this.setState({ text: wordList, innerText: this.props.value.trim() })
    }

    componentWillUnmount() {
        const { unsubscribe } = this.state
        if (typeof unsubscribe === 'function') {
            unsubscribe()
        }
        this._isMounted = false
        store.dispatch(setTaskTitleInEditMode(false))
    }

    htmlFormat = vals => {
        const wordList = []
        for (let i = 0; i < vals.length; ++i) {
            if (vals[i].startsWith('#') && REGEX_HASHTAG.test(vals[i])) {
                wordList.push(
                    <Text key={i} style={{ ...styles.body1, color: '#702EE6' }}>
                        {vals[i]}
                    </Text>
                )
                wordList.push(<Text key={'s' + i}> </Text>)
            } else if (vals[i].startsWith('@') && REGEX_MENTION.test(vals[i])) {
                wordList.push(
                    <Text key={i} style={{ ...styles.body1, color: '#07A873' }}>
                        {vals[i]}
                    </Text>
                )
                wordList.push(<Text key={'s' + i}> </Text>)
            } else if (vals[i].startsWith('http') && REGEX_URL.test(vals[i])) {
                wordList.push(
                    <Text key={i} style={{ ...styles.body1, color: '#5AACFF' }}>
                        {vals[i]}
                    </Text>
                )
                wordList.push(<Text key={'s' + i}> </Text>)
            } else if (vals[i].includes('@') && REGEX_EMAIL.test(vals[i])) {
                wordList.push(
                    <Text key={i} style={{ ...styles.body1, color: '#F58E0A' }}>
                        {vals[i]}
                    </Text>
                )
                wordList.push(<Text key={'s' + i}> </Text>)
            } else {
                wordList.push(
                    <Text key={i} style={styles.body1}>
                        {vals[i]}
                    </Text>
                )
                wordList.push(<Text key={'s' + i}> </Text>)
            }
        }

        return wordList
    }

    onLayout = async () => {
        if (this.visibleText !== undefined) {
            const inputWidth = await MyPlatform.getElementWidth(this.visibleText.current)
            if (!this._isMounted) return
            this.setState({ inputWidth })
        }
    }

    focus = () => {
        if (this.inputText && !this.inputText.current.isFocused()) {
            this.inputText.current.focus()
        }
    }

    render() {
        return (
            <View ref={this.mainContainer} style={{ flexDirection: 'row' }}>
                <TouchableOpacity
                    style={[{ flex: 1 }, this.state.taskTitleInEditMode && localStyles.textInputFocused]}
                    onPress={this.focus}
                    activeOpacity={1}
                >
                    <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                        <View>
                            <TextInput
                                ref={this.inputText}
                                autoFocus
                                onFocus={this.props.onFocus}
                                selectionColor="transparent"
                                value={this.state.innerText}
                                onSubmitEditing={e => {
                                    if (this.state.taskTitleInEditMode && this.state.innerText === '') {
                                        this.deleteTask()
                                    } else {
                                        this.submitEditing()
                                    }
                                }}
                                onChangeText={value => {
                                    const vals = value.split(' ')

                                    const wordList = this.htmlFormat(vals)
                                    this.setState({ text: wordList, innerText: value })
                                    this.props.onChangeSocialText(value)
                                }}
                                style={[
                                    localStyles.textInput,
                                    { width: this.state.inputWidth },
                                    textInputCaret,
                                    this.props.inputStyle,
                                ]}
                                {...this.props}
                            />
                            <Text ref={this.visibleText} onLayout={this.onLayout} style={localStyles.visibleText}>
                                {this.state.text.map(word => word)}
                            </Text>
                        </View>
                    </ScrollView>
                </TouchableOpacity>

                {this.state.taskTitleInEditMode ? (
                    <View ref={this.buttonsContainer} style={{ flexDirection: 'row' }}>
                        <TouchableOpacity
                            onPress={() => {
                                store.dispatch(setTaskTitleInEditMode(false))
                                this.props.onChangeSocialText(this.state.originalText)
                            }}
                            style={localStyles.buttonX}
                        >
                            <Icon name="x" size={24} color={colors.Text02} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => {
                                if (this.state.innerText === '') {
                                    this.deleteTask()
                                } else {
                                    this.submitEditing()
                                }
                            }}
                            style={[
                                localStyles.buttonSave,
                                this.state.originalText !== this.state.innerText
                                    ? localStyles.buttonSaveActive
                                    : undefined,
                                this.state.innerText === '' ? localStyles.buttonSaveDelete : undefined,
                            ]}
                            accessible={false}
                        >
                            <Icon name={this.state.innerText === '' ? 'trash-2' : 'save'} size={24} color="white" />
                        </TouchableOpacity>
                    </View>
                ) : null}
            </View>
        )
    }
    updateState = () => {
        if (!this._isMounted) return
        this.setState({
            taskTitleInEditMode: store.getState().taskTitleInEditMode,
        })
    }

    deleteTask = () => {
        store.dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_TASK,
                object: {
                    task: this.props.task,
                    projectId: this.props.projectId,
                    navigation: DV_TAB_ROOT_TASKS,
                    originalTaskName: this.props.task.name,
                },
            })
        )
    }

    submitEditing = () => {
        if (this.props.customOnSubmitEditing !== undefined) {
            this.props.customOnSubmitEditing(this.state.innerText)
            store.dispatch(setTaskTitleInEditMode(false))
        }
    }
}

const textInputCaret = { caretColor: colors.Primary200, outlineWidth: 0 }

const localStyles = StyleSheet.create({
    textInput: {
        textAlignVertical: 'center',
        fontFamily: 'Roboto-Regular',
        fontSize: 16,
        top: -0.5,
        height: 40,
        position: 'absolute',
        display: 'flex',
        paddingLeft: 16,
        color: 'transparent',
        letterSpacing: em2px(0.02),
    },
    textInputFocused: {
        borderWidth: 2,
        borderColor: colors.UtilityBlue200,
        borderRadius: 4,
    },
    textView: {
        height: 40,
    },
    buttonX: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EAF0F5',
        width: 48,
        height: 40,
        marginLeft: 8,
        borderRadius: 4,
    },
    buttonSaveDelete: {
        backgroundColor: colors.Red200,
    },
    buttonSaveActive: {
        opacity: 1,
    },
    buttonSave: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Primary300,
        width: 48,
        height: 40,
        marginLeft: 8,
        borderRadius: 4,
        opacity: 0.5,
    },
    visibleText: {
        ...styles.body1,
        color: colors.Text01,
        display: 'flex',
        paddingLeft: 16,
        paddingTop: 8,
        flexDirection: 'row',
    },
})

export default ParsingTextInput
