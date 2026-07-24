import React, { Component } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import PropTypes from 'prop-types'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import FileTag from '../../Tags/FileTag'
import { applyPopoverWidth, getPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import * as ImagePicker from 'expo-image-picker'
import { Platform } from 'react-native-web'
import Spinner from '../Spinner'
import store from '../../../redux/store'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import { withWindowSizeHook } from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { translate } from '../../../i18n/TranslationService'

class ImagePickerModal extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            pictures: this.props.picture !== undefined ? [{ index: 0, file: this.props.picture }] : [],
            height: 0,
            enabled: true,
            changed: false,
            smallScreenNavigation: storeState.smallScreenNavigation,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.actionButton = React.createRef()
    }

    async componentDidMount() {
        const { onOpenModal } = this.props
        this.actionButton.current.focus()
        if (onOpenModal) {
            onOpenModal()
        }
        document.addEventListener('keydown', this.onPressSaveButton)

        if (Platform.OS !== 'web') {
            const { status } = await ImagePicker.requestCameraRollPermissionsAsync()
            if (status !== 'granted') {
                this.setState({ enabled: false })
            }
        }

        Image.getSize(this.props.picture, (width, height) => {
            this.setState({
                pictures: [{ index: 0, file: this.props.picture }],
                height: height * ((getPopoverWidth() - 34) / width),
            })
        })
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onPressSaveButton)
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            smallScreenNavigation: storeState.smallScreenNavigation,
        })
    }

    pickImage = async () => {
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 1,
        })

        if (!result.cancelled) {
            Image.getSize(result.uri, (width, height) => {
                this.setState({
                    pictures: [{ index: 0, file: result.uri }],
                    height: height * ((getPopoverWidth() - 34) / width),
                    changed: true,
                })
                this.actionButton.current.focus()
            })
        } else {
            this.actionButton.current.focus()
        }
    }

    render() {
        const { pictures, height, enabled, smallScreenNavigation: mobile } = this.state
        const { closePopover, windowSize } = this.props

        let src = pictures.length > 0 ? pictures[0].file : ''

        return (
            <View
                style={[
                    localStyles.container,
                    applyPopoverWidth(),
                    { maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP },
                ]}
            >
                <CustomScrollView showsVerticalScrollIndicator={false}>
                    <View style={localStyles.title}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Upload picture')}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Upload a picture to identify this person')}
                        </Text>
                    </View>

                    <View style={localStyles.contentSection}>
                        {enabled && pictures.length > 0 && (
                            <View style={[localStyles.imageContainer, { width: getPopoverWidth() - 34 }]}>
                                <View style={[localStyles.corner, localStyles.cornerTL]} />
                                <View style={[localStyles.corner, localStyles.cornerTR]} />
                                <View style={[localStyles.corner, localStyles.cornerBL]} />
                                <View style={[localStyles.corner, localStyles.cornerBR]} />
                                <View style={[localStyles.image, { width: getPopoverWidth() - 34 }]}>
                                    {height > 0 ? (
                                        <Image
                                            source={{ uri: src }}
                                            style={{ width: getPopoverWidth() - 34, height: height }}
                                        />
                                    ) : (
                                        <View style={{ marginVertical: 70, alignItems: 'center' }}>
                                            <Spinner containerSize={32} spinnerSize={16} />
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}
                        {enabled ? (
                            <Hotkeys keyName={'alt+U'} onKeyDown={this.pickImage} filter={e => true}>
                                <TouchableOpacity style={localStyles.uploadButton} onPress={this.pickImage}>
                                    <Icon name="folder-plus" size={24} color={'#ffffff'} />
                                    <Text style={[styles.subtitle1, { color: '#ffffff', marginLeft: 8 }]}>
                                        {translate('Upload image file')}
                                    </Text>

                                    {!mobile && (
                                        <View style={localStyles.shortcut}>
                                            <Shortcut text={'Alt + U'} theme={SHORTCUT_LIGHT} />
                                        </View>
                                    )}
                                </TouchableOpacity>
                            </Hotkeys>
                        ) : (
                            <Text style={[styles.subtitle1, { color: '#ffffff', marginLeft: 8 }]}>
                                {translate('Need camera roll permissions!')}
                            </Text>
                        )}

                        {pictures.length > 0 && (
                            <View style={{ marginTop: 8 }}>
                                <FileTag
                                    file={
                                        typeof pictures[0].file === 'string'
                                            ? { file: { name: 'picture.jpg' } }
                                            : pictures[0]
                                    }
                                    onCloseFile={this.onClosePicture}
                                    textStyle={
                                        typeof pictures[0].file !== 'string' && pictures[0].file.name.length > 30
                                            ? {
                                                  maxWidth: 215,
                                              }
                                            : undefined
                                    }
                                    canBeRemoved={true}
                                />
                            </View>
                        )}
                    </View>

                    <View style={localStyles.sectionSeparator} />

                    <View style={localStyles.buttonContainer}>
                        <Button
                            ref={this.actionButton}
                            type={'primary'}
                            title={translate('Save Picture')}
                            onPress={this.onPressSaveButton}
                        />
                    </View>

                    <View style={localStyles.closeContainer}>
                        <Hotkeys keyName={'Esc,alt+Esc'} onKeyDown={closePopover} filter={e => true}>
                            <TouchableOpacity style={localStyles.closeButton} onPress={closePopover}>
                                <Icon name="x" size={24} color={colors.Text03} />
                            </TouchableOpacity>
                        </Hotkeys>
                    </View>
                </CustomScrollView>
            </View>
        )
    }

    onClosePicture = index => {
        this.setState({ pictures: [], height: 0, changed: true })
    }

    onPressSaveButton = () => {
        const { pictures, changed } = this.state
        const { onSavePicture, closePopover } = this.props

        if (changed) {
            if (pictures.length > 0) {
                onSavePicture(pictures[0].file)
            } else {
                onSavePicture(null)
            }
        }
        closePopover()
    }
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        width: 305,
        overflow: 'visible',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    title: {
        marginBottom: 20,
        paddingTop: 16,
        paddingHorizontal: 16,
    },
    contentSection: {
        paddingHorizontal: 16,
        justifyContent: 'center',
    },
    sectionSeparator: {
        height: 1,
        width: '100%',
        backgroundColor: '#ffffff',
        opacity: 0.2,
        marginVertical: 16,
    },
    uploadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
    image: {
        zIndex: 10,
        borderRadius: 2,
        width: 271,
        overflow: 'hidden',
        backgroundColor: colors.Secondary400,
    },
    imageContainer: {
        width: 271,
        marginBottom: 17,
    },
    corner: {
        position: 'absolute',
        width: 33,
        height: 33,
        backgroundColor: colors.Primary100,
    },
    cornerTL: {
        top: -2,
        left: -2,
        borderTopLeftRadius: 4,
    },
    cornerTR: {
        top: -2,
        right: -2,
        borderTopLeftRadius: 4,
    },
    cornerBL: {
        bottom: -2,
        left: -2,
        borderBottomLeftRadius: 4,
    },
    cornerBR: {
        bottom: -2,
        right: -2,
        borderBottomRightRadius: 4,
    },
    buttonContainer: {
        paddingLeft: 16,
        paddingRight: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        paddingBottom: 16,
        paddingHorizontal: 16,
    },
    closeContainer: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    shortcut: {
        position: 'absolute',
        right: 0,
    },
})

ImagePickerModal.propTypes = {
    closePopover: PropTypes.func,
    onSavePicture: PropTypes.func,
}

export default withWindowSizeHook(ImagePickerModal)
