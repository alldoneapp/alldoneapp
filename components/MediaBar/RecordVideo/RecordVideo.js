import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import CustomScrollView from '../../UIControls/CustomScrollView'
import CloseButton from '../../FollowUp/CloseButton'
import global, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import NewTopic from '../NewTopic/NewTopic'
import Icon from '../../Icon'
import { applyPopoverWidth, calculateTimeDuration, getPopoverWidth } from '../../../utils/HelperFunctions'
import Options from '../ScreenRecording/Options'
import { removeOpenModal, storeOpenModal } from '../../../redux/actions'
import { RECORD_VIDEO_MODAL_ID } from '../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../i18n/TranslationService'

let video
let recorder
let timeout

const RecordVideo = ({ projectId, setVideoToExternalParent, closeModal }) => {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const { defaultAudioInputId, defaultCameraId } = useSelector(state => state.loggedUser)
    const [isPaused, setIsPaused] = useState(false)
    const [isMuted, setIsMuted] = useState(false)
    const [time, setTime] = useState('00.00')
    const [file, setFile] = useState([])
    const [showNewTopic, setShowNewTopic] = useState(false)
    const [display, setDisplay] = useState('none')
    const [loading, setLoading] = useState(true)
    const [denied, setDenied] = useState(false)
    const [showRecord, setShowRecord] = useState('')
    const [showOptions, setShowOptions] = useState(false)
    const [videoDeviceId, setVideoDeviceId] = useState(defaultCameraId)
    const [audioDeviceId, setAudioDeviceId] = useState(defaultAudioInputId)
    const extension = /(Apple)/i.test(navigator.vendor) ? 'mp4' : 'webm'
    const mimeType = /(Apple)/i.test(navigator.vendor) ? 'mp4' : 'x-matroska;codecs=avc1'

    useEffect(() => {
        const script = document.createElement('script')
        script.src = 'https://www.WebRTC-Experiment.com/RecordRTC.js'
        script.async = true
        document.body.appendChild(script)
        script.onload = () => {
            video = document.getElementById('record-video')
            startVideoRecording()
        }
    }, [])

    const startVideoRecording = () => {
        captureCamera(function (camera) {
            setDisplay('')
            setLoading(false)
            setDenied(false)
            video.muted = true
            video.volume = 0
            video.srcObject = camera

            recorder = RecordRTC(camera, {
                type: 'video',
                mimeType: `video/${mimeType}`,
                timeSlice: 1000,
                video: {
                    width: 1536,
                    height: 864,
                },
                onTimeStamp: function (timestamp, timestamps) {
                    const duration = calculateTimeDuration((new Date().getTime() - timestamps[0]) / 1000)
                    if (duration < 0) return
                    setTime(duration)
                },
            })

            recorder.startRecording()

            recorder.camera = camera

            window.stopCallback = function (save) {
                clearTimeout(timeout)
                window.stopCallback = null
                video.muted = true
                video.volume = 0
                recorder.camera.stop()

                recorder.stopRecording(function () {
                    if (save) {
                        const blob = recorder.getBlob()
                        const file = new File([blob], `video-record.${extension}`, {
                            type: `video/${mimeType}`,
                        })

                        if (setVideoToExternalParent) {
                            setVideoToExternalParent(file)
                        } else {
                            setFile([{ index: 0, file: file }])
                            setShowNewTopic(true)
                        }
                    }
                    recorder.reset()
                })
            }
            timeout = setTimeout(() => {
                window.stopCallback(true)
            }, 1000 * 60 * 3)
        })
    }

    function captureCamera(cb) {
        navigator.mediaDevices
            .getUserMedia({
                video: { deviceId: videoDeviceId },
                audio: { deviceId: audioDeviceId },
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
            })
            .then(cb)
            .catch(function (error) {
                console.error(error)
                if (
                    error.toString().split(': ')[1] === 'Permission denied' ||
                    error.toString().split(': ')[1] === 'Requested device not found'
                ) {
                    setLoading(false)
                    setDenied(true)
                }
            })
    }

    const saveRecording = () => {
        dispatch(removeOpenModal(RECORD_VIDEO_MODAL_ID))
        window.stopCallback ? window.stopCallback(true) : closeModal()
    }
    const cancelRecording = () => {
        window.stopCallback && window.stopCallback()
        closeModal()
    }

    function handlePause() {
        if (recorder && video) {
            if (isPaused) {
                video.play()
                recorder.resumeRecording()
                setIsPaused(false)
            } else {
                video.pause()
                recorder.pauseRecording()
                setIsPaused(true)
            }
        }
    }

    const muteAudio = mute => {
        if (recorder && recorder.camera) {
            setIsMuted(mute)
            recorder.camera.getAudioTracks().forEach(audioTrack => (audioTrack.enabled = !mute))
        }
    }

    function handleMute() {
        if (isMuted) {
            muteAudio(false)
        } else {
            muteAudio(true)
        }
    }

    const handleOptions = () => {
        setShowRecord('none')
        setShowOptions(true)
    }

    useEffect(() => {
        dispatch(storeOpenModal(RECORD_VIDEO_MODAL_ID))
        return () => {
            dispatch(removeOpenModal(RECORD_VIDEO_MODAL_ID))
        }
    }, [])

    return (
        <View style={[localStyles.parent, mobile && localStyles.mobile]}>
            {showNewTopic ? (
                <NewTopic projectId={projectId} propFiles={file} close={closeModal} />
            ) : (
                <Hotkeys
                    key={20}
                    keyName={'Esc'}
                    onKeyDown={() => {
                        clearTimeout(timeout)
                        !loading && cancelRecording()
                    }}
                    filter={e => true}
                >
                    <CustomScrollView
                        contentContainerStyle={[localStyles.container, applyPopoverWidth(), { display: showRecord }]}
                    >
                        <View style={{ marginBottom: 22, paddingHorizontal: 16 }}>
                            <Text style={[global.title7, { color: 'white' }]}>{translate('Record Video')}</Text>
                        </View>
                        <View style={localStyles.videoFrame}>
                            <video
                                id="record-video"
                                height={((getPopoverWidth() - 60) * 200) / 270}
                                width={getPopoverWidth() - 60}
                                autoPlay
                                playsInline
                                style={{ borderRadius: 10, display: display, transform: 'rotateY(180deg)' }}
                            />
                            {loading && (
                                <View
                                    style={[
                                        localStyles.loading,
                                        {
                                            width: getPopoverWidth() - 60,
                                            height: ((getPopoverWidth() - 60) * 200) / 270,
                                        },
                                    ]}
                                >
                                    <View style={[localStyles.iconCircle, { backgroundColor: colors.UtilityBlue200 }]}>
                                        <Icon name={'video'} size={18} color="white" />
                                    </View>
                                    <Text style={[global.subtitle2, { marginTop: 12, color: 'white' }]}>
                                        {translate('Loading webcam:')}
                                    </Text>
                                </View>
                            )}
                            {denied && (
                                <View
                                    style={[
                                        localStyles.loading,
                                        {
                                            width: getPopoverWidth() - 60,
                                            height: ((getPopoverWidth() - 60) * 200) / 270,
                                        },
                                    ]}
                                >
                                    <View style={[localStyles.iconCircle, { backgroundColor: colors.UtilityRed200 }]}>
                                        <Icon name={'video-off'} size={18} color="white" />
                                    </View>
                                    <Text style={[global.subtitle2, localStyles.noWebcamText]}>
                                        {translate(
                                            'No webcam available. Try giving camera access to Alldone from your browser'
                                        )}
                                    </Text>
                                </View>
                            )}
                        </View>
                        <View style={localStyles.indicator}>
                            <Text style={[global.body2, { marginHorizontal: 8, color: 'white' }]}>{time}</Text>
                        </View>

                        <View style={localStyles.buttonsContainer}>
                            <Hotkeys keyName={'alt+s'} onKeyDown={() => !denied && handleOptions()} filter={e => true}>
                                <Button
                                    accessible={false}
                                    icon={'settings'}
                                    iconColor={colors.Text04}
                                    buttonStyle={{
                                        backgroundColor: colors.Secondary200,
                                        marginRight: 4,
                                    }}
                                    onPress={() => !denied && handleOptions()}
                                    shortcutText={'S'}
                                    forceShowShortcut={true}
                                    disabled={loading || denied}
                                />
                            </Hotkeys>
                            <Button
                                accessible={false}
                                icon={isPaused ? 'play' : 'pause'}
                                iconColor={colors.Text04}
                                buttonStyle={{
                                    backgroundColor: colors.Secondary200,
                                    marginRight: 4,
                                }}
                                onPress={() => !loading && !denied && handlePause()}
                                disabled={loading || denied}
                            />
                            <Button
                                accessible={false}
                                icon={isMuted ? 'mic-off' : 'mic'}
                                iconColor={colors.Text04}
                                buttonStyle={{
                                    backgroundColor: colors.Secondary200,
                                    marginRight: 4,
                                }}
                                onPress={() => !loading && !denied && handleMute()}
                                disabled={loading || denied}
                            />
                        </View>
                        <View style={localStyles.line2}>{null}</View>
                        <View style={localStyles.button}>
                            <Hotkeys
                                keyName={'alt+enter,enter'}
                                onKeyDown={() => !loading && saveRecording()}
                                filter={e => true}
                            >
                                <Button
                                    title={translate('Save Video')}
                                    shortcutText={'Enter'}
                                    onPress={() => !loading && saveRecording()}
                                />
                            </Hotkeys>
                        </View>
                    </CustomScrollView>

                    {showOptions && (
                        <Options
                            videoDeviceId={videoDeviceId}
                            setShowOptions={setShowOptions}
                            setVideoDeviceId={setVideoDeviceId}
                            audioDeviceId={audioDeviceId}
                            setAudioDeviceId={setAudioDeviceId}
                            start={startVideoRecording}
                            setShow={setShowRecord}
                        />
                    )}

                    {!showOptions && (
                        <CloseButton
                            close={e => {
                                if (e) {
                                    e.preventDefault()
                                }
                                clearTimeout(timeout)
                                !loading && cancelRecording()
                            }}
                        />
                    )}
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
        left: '48.5%',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        height: 'auto',
        top: '50%',
        transform: [{ translateX: '-43%' }, { translateY: '-50%' }],
    },
    mobile: {
        transform: [{ translateX: '-48.5%' }, { translateY: '-50%' }],
    },
    container: {
        width: 330,
    },
    line2: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Text03,
        marginVertical: 16,
        opacity: 0.6,
    },
    button: {
        alignSelf: 'center',
        paddingHorizontal: 16,
    },
    buttonsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 18,
    },
    indicator: {
        backgroundColor: colors.Secondary200,
        // width: 74,
        width: 53,
        height: 26,
        borderRadius: 13,
        justifyContent: 'center',
        bottom: 136,
        // left: 212,
        right: 34,
        position: 'absolute',
    },
    videoFrame: {
        justifyContent: 'center',
        paddingHorizontal: 16,
        alignSelf: 'center',
    },
    loading: {
        height: 200,
        width: 270,
        backgroundColor: colors.Secondary300,
        borderRadius: 4,
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
    noWebcamText: {
        marginTop: 12,
        color: 'white',
        paddingHorizontal: 19,
        textAlign: 'center',
    },
})

export default RecordVideo
