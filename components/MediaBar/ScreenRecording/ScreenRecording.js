import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image } from 'react-native'
import Hotkeys from 'react-hot-keys'
import global, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import NewTopic from '../NewTopic/NewTopic'
import Icon from '../../Icon'
import CancelRecord from './CancelRecord'
import Options from './Options'
import { calculateTimeDuration } from '../../../utils/HelperFunctions'
import { useSelector, useDispatch } from 'react-redux'
import { storeOpenModal, removeOpenModal } from '../../../redux/actions'
import { RECORD_SCREEN_MODAL_ID } from '../../Feeds/CommentsTextInput/textInputHelper'

let recorder
let video
let timeout
let camera

const ScreenRecording = ({ projectId, setVideoToExternalParent, closeModal }) => {
    // const sizing = useRef(new Animated.Value(257)).current
    const dispatch = useDispatch()
    const { photoURL } = useSelector(state => state.loggedUser)
    const { defaultAudioInputId, defaultCameraId } = useSelector(state => state.loggedUser)
    const [sizing, setSizing] = useState(257)
    const [expanded, setExpanded] = useState(false)
    const [middle, setMiddle] = useState(false)
    const [file, setFile] = useState([])
    const [time, setTime] = useState('00:00')
    const [showNewTopic, setShowNewTopic] = useState(false)
    const [showClose, setShowClose] = useState(false)
    const [showOptions, setShowOptions] = useState(false)
    const [display, setDisplay] = useState('none')
    const [loading, setLoading] = useState(true)
    const [denied, setDenied] = useState(false)
    const [videoDeviceId, setVideoDeviceId] = useState(defaultCameraId)
    const [audioDeviceId, setAudioDeviceId] = useState(defaultAudioInputId)
    const extension = /(Apple)/i.test(navigator.vendor) ? 'mp4' : 'webm'
    const mimeType = /(Apple)/i.test(navigator.vendor) ? 'mp4' : 'x-matroska;codecs=avc1'

    const screenConstraints = {
        aspectRatio: window.screen.width / window.screen.height,
        // frameRate: 30,
        // width: 1920,
        // height: 1080,
        resizeMode: 'crop-and-scale',
        cursor: 'motion',
        displaySurface: 'window',
        logicalSurface: true,
    }

    const changeSize = () => {
        setExpanded(!expanded)
        if (middle) {
            !expanded ? setSizing(100) : setSizing(305)
            // Animated.timing(sizing, {
            //     toValue: !expanded ? 100 : 305,
            //     duration: 500,
            // }).start()
        } else {
            !expanded ? setSizing(56) : setSizing(257)
            // Animated.timing(sizing, {
            //     toValue: !expanded ? 56 : 257,
            //     duration: 500,
            // }).start()
        }
    }

    const middleSize = () => {
        if (recorder && recorder.camera) {
            recorder.camera.getVideoTracks().forEach(track => {
                track.stop()
            })
        }
        setMiddle(true)
        expanded && setExpanded(false)
        setSizing(305)
        // Animated.timing(sizing, {
        //     toValue: 305,
        //     duration: 500,
        // }).start()
    }

    const fullSize = () => {
        if (recorder) {
            if (recorder.camera) {
                setLoading(true)
                setDisplay('none')
                captureCamera(function (camera) {
                    setDisplay('')
                    setLoading(false)
                    camera.id ? (video.srcObject = camera) : noCamera()
                    recorder.camera = camera
                })
            }
        }
        setMiddle(false)
        expanded && setExpanded(false)
        setSizing(257)
        // Animated.timing(sizing, {
        //     toValue: 257,
        //     duration: 500,
        // }).start()
    }

    const noCamera = () => {
        setDisplay('none')
        setDenied(true)
    }

    useEffect(() => {
        const script = document.createElement('script')
        script.src = 'https://www.WebRTC-Experiment.com/RecordRTC.js'
        script.async = true
        document.body.appendChild(script)
        script.onload = () => {
            video = document.getElementById('screen-recording')
            startStream()
        }
    }, [])

    const startStream = () => {
        captureScreen(async function (screen) {
            window.stopScreen = function () {
                ;[screen].forEach(function (stream) {
                    stream.getTracks().forEach(function (track) {
                        track.stop()
                    })
                })
            }

            const isCamera = await navigator.mediaDevices.enumerateDevices()
            if (isCamera.some(item => item.kind === 'videoinput')) {
                camera = await navigator.mediaDevices.getUserMedia(cameraConstraints)
            } else {
                middleSize()
            }

            captureAudio(function (audio) {
                setDisplay('')
                setLoading(false)
                screen.width = window.screen.width
                screen.height = window.screen.height
                screen.fullcanvas = true
                camera?.id && video ? (video.srcObject = camera) : noCamera()
                screen.getTracks()[0].applyConstraints(screenConstraints)

                recorder = RecordRTC([screen, audio], {
                    type: 'video',
                    mimeType: `video/${mimeType}`,
                    timeSlice: 1000,
                    video: {
                        width: 1280,
                        height: 720,
                    },
                    onTimeStamp: function (timestamp, timestamps) {
                        const duration = calculateTimeDuration((new Date().getTime() - timestamps[0]) / 1000)
                        if (duration < 0) return
                        setTime(duration)
                    },
                })

                recorder.startRecording()

                recorder.camera = camera && camera

                window.stopCallback = function (save) {
                    clearTimeout(timeout)
                    window.stopCallback = null
                    video.src = video.srcObject = null
                    video.muted = true
                    video.volume = 0
                    if (camera?.id) recorder.camera.stop()
                    audio.stop()

                    recorder.stopRecording(function () {
                        if (save) {
                            const blob = recorder.getBlob()
                            const file = new File([blob], `screen-record.${extension}`, {
                                type: `video/${mimeType}`,
                            })
                            if (setVideoToExternalParent) {
                                setVideoToExternalParent(file)
                            } else {
                                setFile([{ index: 0, file: file }])
                                setShowNewTopic(true)
                            }
                        }
                        recorder.camera = null
                        window.stopScreen()
                        recorder.reset()
                    })
                }
                timeout = setTimeout(() => {
                    window.stopCallback(true)
                }, 1000 * 60 * 3)
            })
        })
    }

    function invokeGetDisplayMedia(success, error) {
        var displaymediastreamconstraints = {
            video: {
                displaySurface: 'monitor', // monitor, window, application, browser
                logicalSurface: true,
                cursor: 'always', // never, always, motion
            },
        }

        // above constraints are NOT supported YET
        // that's why overridnig them
        displaymediastreamconstraints = {
            video: screenConstraints,
        }

        if (navigator.mediaDevices.getDisplayMedia) {
            navigator.mediaDevices.getDisplayMedia(displaymediastreamconstraints).then(success).catch(error)
        } else if (navigator.getDisplayMedia) {
            navigator.getDisplayMedia(displaymediastreamconstraints).then(success).catch(error)
        }
    }

    function captureScreen(callback) {
        invokeGetDisplayMedia(
            function (screen) {
                addStreamStopListener(screen, function () {
                    if (window.stopCallback) {
                        window.stopCallback()
                    }
                })
                callback(screen)
            },
            function (error) {
                console.error(error)
                alert('Unable to capture your screen.\n' + error)
                setLoading(false)
                setDenied(true)
            }
        )
    }

    const cameraConstraints = {
        video: { deviceId: videoDeviceId },
        width: {
            min: 128,
            max: 128,
        },
        height: {
            min: 128,
            max: 128,
        },
        frameRate: {
            min: 30,
            max: 30,
        },
        aspectRatio: 1.77,
    }

    function captureCamera(cb) {
        navigator.mediaDevices
            .getUserMedia(cameraConstraints)
            .then(cb)
            .catch(function (error) {
                console.error(error)
                alert(
                    'Unable to capture your Camera.\n' +
                        'Try giving camera access to Alldone from your browser.\n' +
                        error
                )
                window.stopScreen()
                setLoading(false)
                setDenied(true)
            })
    }

    function captureAudio(cb) {
        navigator.mediaDevices
            .getUserMedia({ audio: { deviceId: audioDeviceId } })
            .then(cb)
            .catch(function (error) {
                console.error(error)
                alert(
                    'Unable to capture your Microphone.\n' +
                        'Try giving Microphone access to Alldone from your browser.\n' +
                        error
                )
                window.stopScreen()
                window.stopCamera()
                setLoading(false)
                setDenied(true)
            })
    }

    function addStreamStopListener(stream, callback) {
        stream.addEventListener(
            'ended',
            function () {
                callback()
                callback = function () {}
            },
            false
        )
        stream.addEventListener(
            'inactive',
            function () {
                callback()
                callback = function () {}
            },
            false
        )
        stream.getTracks().forEach(function (track) {
            track.addEventListener(
                'ended',
                function () {
                    callback()
                    callback = function () {}
                },
                false
            )
            track.addEventListener(
                'inactive',
                function () {
                    callback()
                    callback = function () {}
                },
                false
            )
        })
    }

    const saveRecording = () => {
        dispatch(removeOpenModal(RECORD_SCREEN_MODAL_ID))
        window.stopCallback ? window.stopCallback(true) : closeModal()
    }

    const cancelRecording = () => {
        window.stopCallback ? setShowClose(true) : closeModal()
    }

    useEffect(() => {
        dispatch(storeOpenModal(RECORD_SCREEN_MODAL_ID))
        return () => {
            dispatch(removeOpenModal(RECORD_SCREEN_MODAL_ID))
        }
    }, [])

    return (
        <View style={localStyles.parent}>
            {showNewTopic ? (
                <NewTopic projectId={projectId} propFiles={file} close={closeModal} />
            ) : (
                <Hotkeys
                    key={20}
                    keyName={'Esc'}
                    onKeyDown={() => {
                        !loading && cancelRecording()
                    }}
                    filter={e => true}
                >
                    {showClose && (
                        <CancelRecord setShowClose={setShowClose} loading={loading} closeModal={closeModal} />
                    )}
                    {showOptions && (
                        <Options
                            videoDeviceId={videoDeviceId}
                            setShowOptions={setShowOptions}
                            audioDeviceId={audioDeviceId}
                            setAudioDeviceId={setAudioDeviceId}
                            setVideoDeviceId={setVideoDeviceId}
                            start={startStream}
                        />
                    )}

                    <View style={[localStyles.container]}>
                        <View
                            style={{
                                backgroundColor: 'black',
                                width: 128,
                                height: 128,
                                borderRadius: 100,
                                overflow: 'hidden',
                                display: middle ? 'none' : '',
                            }}
                        >
                            <video
                                id="screen-recording"
                                height={130}
                                width={171}
                                autoPlay
                                playsInline
                                style={{ marginLeft: -20, display: display, transform: 'rotateY(180deg)' }}
                            />
                            {loading && (
                                <View style={localStyles.loading}>
                                    <View style={[localStyles.iconCircle, { backgroundColor: colors.UtilityBlue200 }]}>
                                        <Icon name={'video'} size={18} color="white" />
                                    </View>
                                </View>
                            )}
                            {denied && (
                                <View style={localStyles.loading}>
                                    <View style={[localStyles.iconCircle, { backgroundColor: colors.UtilityRed200 }]}>
                                        <Icon name={'video-off'} size={18} color="white" />
                                    </View>
                                </View>
                            )}
                        </View>
                        <Animated.View style={[localStyles.buttonsBar, { width: sizing }]}>
                            <View style={{ flexDirection: 'row' }}>
                                {middle && (
                                    <TouchableOpacity style={{ marginLeft: 8 }} onPress={() => fullSize()}>
                                        <Image source={{ uri: photoURL }} style={localStyles.ownerImage} />
                                    </TouchableOpacity>
                                )}
                                <Hotkeys keyName={'alt+u'} onKeyDown={() => null} filter={e => true}>
                                    <TouchableOpacity
                                        style={{ marginLeft: 16, marginRight: 16, alignSelf: 'center' }}
                                        disabled={showClose || showOptions}
                                        onPress={() => changeSize()}
                                    >
                                        <Icon
                                            name={expanded ? 'chevron-right' : 'chevron-left'}
                                            size={24}
                                            color={colors.Primary300}
                                        />
                                    </TouchableOpacity>
                                </Hotkeys>
                                <Hotkeys
                                    keyName={'alt+s'}
                                    onKeyDown={() => !loading && !denied && setShowOptions(true)}
                                    filter={e => true}
                                >
                                    <Button
                                        icon={'settings'}
                                        iconColor={colors.Text04}
                                        buttonStyle={{
                                            backgroundColor: colors.Secondary200,
                                            marginRight: 8,
                                        }}
                                        onPress={() => !loading && !denied && setShowOptions(true)}
                                        shortcutText={'S'}
                                        forceShowShortcut={true}
                                        disabled={showClose || showOptions || loading || denied}
                                    />
                                </Hotkeys>
                                <Hotkeys
                                    keyName={'alt+X'}
                                    onKeyDown={() => !loading && cancelRecording()}
                                    filter={e => true}
                                >
                                    <Button
                                        icon={'x'}
                                        iconColor={colors.Text04}
                                        buttonStyle={{
                                            backgroundColor: colors.Secondary200,
                                            marginRight: 8,
                                        }}
                                        onPress={() => !loading && cancelRecording()}
                                        shortcutText={'X'}
                                        forceShowShortcut={true}
                                        disabled={showClose || showOptions}
                                    />
                                </Hotkeys>
                                <Hotkeys
                                    keyName={'alt+d'}
                                    onKeyDown={() => !loading && saveRecording()}
                                    filter={e => true}
                                >
                                    <Button
                                        icon={'check'}
                                        iconColor="white"
                                        buttonStyle={{
                                            backgroundColor: colors.Primary300,
                                            marginRight: 16,
                                        }}
                                        onPress={() => !loading && saveRecording()}
                                        shortcutText={'D'}
                                        forceShowShortcut={true}
                                        disabled={showClose || showOptions}
                                    />
                                </Hotkeys>
                                <Text style={[global.body2, { alignSelf: 'center', color: 'white' }]}>{time}</Text>
                            </View>
                        </Animated.View>
                        {!middle && (
                            <TouchableOpacity
                                style={localStyles.closeButton}
                                disabled={showClose || showOptions}
                                onPress={() => !loading && middleSize()}
                            >
                                <Icon name="x" size={14} color="white" />
                            </TouchableOpacity>
                        )}
                    </View>
                </Hotkeys>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        flex: 1,
        position: 'fixed',
        zIndex: 1,
        backgroundColor: 'transparent',
    },
    container: {
        backgroundColor: 'transparent',
        position: 'fixed',
        bottom: 32,
        left: 32,
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    buttonsBar: {
        backgroundColor: colors.Secondary400,
        height: 56,
        marginLeft: 8,
        borderRadius: 8,
        justifyContent: 'space-around',
        overflow: 'hidden',
    },
    closeButton: {
        backgroundColor: colors.Secondary400,
        height: 24,
        width: 24,
        borderRadius: 100,
        position: 'absolute',
        top: 0,
        left: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loading: {
        height: 128,
        width: 128,
        backgroundColor: colors.Secondary300,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconCircle: {
        height: 40,
        width: 40,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ownerImage: {
        height: 40,
        width: 40,
        borderRadius: 100,
    },
})

export default ScreenRecording
