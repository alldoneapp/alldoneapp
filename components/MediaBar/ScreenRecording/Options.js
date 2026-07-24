import React, { useEffect, useState } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import global, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import Hotkeys from 'react-hot-keys'
import CloseButton from '../../FollowUp/CloseButton'
import Item from './DeviceItem'
import Backend from '../../../utils/BackendBridge'
import { useSelector } from 'react-redux'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'

const Options = ({
    setShowOptions,
    start,
    videoDeviceId,
    setVideoDeviceId,
    audioDeviceId,
    setAudioDeviceId,
    setShow,
}) => {
    const { uid } = useSelector(state => state.loggedUser)
    const [cameras, setCameras] = useState([])
    const [mics, setMics] = useState([])
    const [processing, setProcessing] = useState(false)

    useEffect(() => {
        function showCameras() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                alert('List Devices is not supported.')
                return
            }
            // List cameras and microphones.
            navigator.mediaDevices
                .enumerateDevices()
                .then(function (devices) {
                    let audios = []
                    let videos = []
                    devices.forEach(function (device) {
                        if (device.kind === 'audioinput') {
                            audios.push({ id: device.deviceId, label: device.label, device: device })
                        } else if (device.kind === 'videoinput') {
                            videos.push({ id: device.deviceId, label: device.label })
                        }
                    })
                    setCameras(videos)
                    setMics(audios)
                })
                .catch(function (err) {
                    console.log(err.name + ': ' + err.message)
                })
        }

        showCameras()
    }, [])

    const saveConfiguration = () => {
        setProcessing(true)
        const db = Backend.getDb()
        db.doc(`users/${uid}`)
            .update({ defaultCameraId: videoDeviceId, defaultAudioInputId: audioDeviceId })
            .then(() => {
                window.stopCallback && window.stopCallback()
                start()
                setShow && setShow('')
                setShowOptions(false)
            })
            .catch(error => {
                console.error('Error updating document: ', error)
                setProcessing(false)
            })
    }

    return (
        <View style={localStyles.center}>
            <View style={[localStyles.container, applyPopoverWidth()]}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Text style={[global.title7, { color: 'white' }]}>{translate('Camera and mic settings')}</Text>
                    <Text style={[global.body2, { color: colors.Text03, marginBottom: 20 }]}>
                        {translate('Here you can select which webcam and mic to use')}
                    </Text>
                    <Text style={[global.subtitle1, { color: 'white', marginBottom: 8 }]}>{translate('Cameras')}</Text>
                    <FlatList
                        style={localStyles.flatList}
                        data={cameras}
                        renderItem={({ item, index }) => (
                            <Item
                                label={item.label}
                                onPress={() => setVideoDeviceId(item.id)}
                                checked={videoDeviceId === item.id}
                                index={index}
                                videoDeviceId={videoDeviceId}
                                icon={'video'}
                            />
                        )}
                        keyExtractor={item => item.id}
                        showsVerticalScrollIndicator={false}
                        extraData={videoDeviceId}
                    />
                </View>

                <View style={localStyles.line} />

                <View style={{ paddingHorizontal: 16 }}>
                    <Text style={[global.subtitle1, { color: 'white', marginBottom: 8 }]}>
                        {translate('Microphones')}
                    </Text>
                    <FlatList
                        style={localStyles.flatList}
                        data={mics}
                        renderItem={({ item }) => (
                            <Item
                                label={item.label}
                                onPress={() => setAudioDeviceId(item.id)}
                                checked={audioDeviceId === item.id}
                                icon={'mic'}
                            />
                        )}
                        keyExtractor={item => item.id}
                        showsVerticalScrollIndicator={false}
                        extraData={audioDeviceId}
                    />
                </View>

                <View style={localStyles.line} />

                <View style={localStyles.button}>
                    <Hotkeys
                        keyName={'alt+enter,enter'}
                        onKeyDown={() => !processing && saveConfiguration()}
                        filter={e => true}
                    >
                        <Button
                            title={translate('Save settings')}
                            shortcutText={'Enter'}
                            onPress={() => {
                                !processing && saveConfiguration()
                            }}
                            processingTitle={`${translate('Saving')}...`}
                            processing={processing}
                        />
                    </Hotkeys>
                </View>
            </View>
            <CloseButton
                close={e => {
                    if (e) {
                        e.preventDefault()
                    }
                    setShowOptions(false)
                    setShow && setShow('')
                }}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    center: {
        position: 'fixed',
        left: '48.5%',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        top: '50%',
        transform: [{ translateX: '-43%' }, { translateY: '-50%' }],
    },
    container: {
        width: 317,
        flex: 1,
    },
    line: {
        borderBottomWidth: 1,
        borderBottomColor: colors.Text03,
        marginTop: 20,
        marginBottom: 16,
        opacity: 0.6,
    },
    button: {
        alignSelf: 'center',
        paddingHorizontal: 16,
    },
    title: {
        fontSize: 12,
    },
    flatList: {
        maxHeight: 122,
        flexGrow: 0,
    },
})

export default Options
