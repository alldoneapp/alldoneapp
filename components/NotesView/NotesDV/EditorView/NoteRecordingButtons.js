import React from 'react'
import { Text } from 'react-native'
import EditorToolbarButton from './EditorToolbarButton'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export const formatNoteRecordingElapsed = seconds =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

export default function NoteRecordingButtons({
    microphoneVisible,
    screenVisible,
    recorder,
    screenRecording,
    screenStarting,
    disabled,
    compact,
    onMicrophone,
    onScreen,
}) {
    const microphoneActive = ['starting', 'recording', 'stopping'].includes(recorder.phase)
    const recording = recorder.phase === 'recording'
    return (
        <>
            {microphoneVisible && (
                <span className="ql-toolbar-item">
                    <EditorToolbarButton
                        type="button"
                        title={translate('Meeting microphone keep open')}
                        aria-label={translate(recording ? 'Stop microphone recording' : 'Record audio')}
                        aria-pressed={microphoneActive}
                        disabled={
                            disabled ||
                            screenRecording ||
                            screenStarting ||
                            !['idle', 'recording'].includes(recorder.phase)
                        }
                        onClick={onMicrophone}
                        style={{ paddingLeft: 6, paddingRight: 6 }}
                    >
                        <Icon name="mic" size={18} color={microphoneActive ? colors.Red200 : colors.Text03} />
                        {!compact && (
                            <Text
                                style={[
                                    styles.caption1,
                                    { marginLeft: 4, color: microphoneActive ? colors.Red200 : colors.Text03 },
                                ]}
                            >
                                {microphoneActive
                                    ? formatNoteRecordingElapsed(recorder.elapsed)
                                    : translate('Record audio')}
                            </Text>
                        )}
                    </EditorToolbarButton>
                </span>
            )}
            {screenVisible && (
                <span className="ql-toolbar-item">
                    <EditorToolbarButton
                        type="button"
                        aria-label={translate(screenRecording ? 'Stop screen audio' : 'Screen/tab audio')}
                        title={translate('Screen/tab audio')}
                        disabled={disabled || microphoneActive || screenStarting}
                        onClick={onScreen}
                        style={{ paddingLeft: 6, paddingRight: 6 }}
                    >
                        <Icon name="video-meeting" size={18} color={screenRecording ? colors.Red200 : colors.Text03} />
                        {!compact && (
                            <Text
                                style={[
                                    styles.caption1,
                                    { marginLeft: 4, color: screenRecording ? colors.Red200 : colors.Text03 },
                                ]}
                            >
                                {translate(screenRecording ? 'Stop' : 'Screen/tab audio')}
                            </Text>
                        )}
                    </EditorToolbarButton>
                </span>
            )}
        </>
    )
}
