import React from 'react'
import { View } from 'react-native'
import { describeBackgroundCallSupport, BACKGROUND_SUPPORT_FOREGROUND_ONLY } from './assistantCallBackground'
import useModalSizing from '../../hooks/useModalSizing'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'
import VoiceCallConnecting from './VoiceCallConnecting'
import VoiceMicrophoneStatus from './VoiceMicrophoneStatus'
import AnnaCallAudioControls, { AnnaCallActions } from '../Anna/AnnaCallAudioControls'
import { ANNA_THEME_VARIABLES } from '../Anna/annaThemeVariables'
import '../Anna/anna.css'

// Above everything in the main app, including modals (MODAL_Z_CONTENT is 10000).
const FLOATING_CALL_Z_INDEX = 100000

// AT-3038: the main app's call panel is the Assistant Mode call (AnnaCallAudioControls): level
// meters and timer on top, audio settings on the left and mute / hang up on the right, in the
// same card as Anna's composer field (anna.css, `.anna-floating-call`).
export default function FloatingCallControls({ call }) {
    const { keyboardInset, safeAreaInsets } = useModalSizing()
    if (call.status === 'idle' && !call.error) return null
    const showForegroundHint =
        call.status !== 'idle' && describeBackgroundCallSupport().level === BACKGROUND_SUPPORT_FOREGROUND_ONLY
    const connecting = call.status === 'connecting'
    const seconds = Math.max(0, Math.floor(call.voiceSeconds || 0))
    const endCall = () => call.endCall()
    return (
        <View
            testID="floating-voice-call"
            style={{
                position: 'fixed',
                zIndex: FLOATING_CALL_Z_INDEX,
                right: 16 + safeAreaInsets.right,
                bottom: 16 + keyboardInset + (keyboardInset ? 0 : safeAreaInsets.bottom),
            }}
        >
            <div
                className={`anna-floating-call${call.status === 'idle' ? ' anna-floating-call-error' : ''}`}
                style={ANNA_THEME_VARIABLES}
            >
                {call.status === 'idle' ? (
                    <div className="anna-floating-call-row">
                        <span aria-live="polite" className="anna-floating-call-message">
                            {call.error}
                        </span>
                        <button
                            type="button"
                            className="anna-voice-button"
                            aria-label={translate('Close')}
                            onClick={call.dismissError}
                        >
                            <Icon name="x" size={20} color="currentColor" />
                        </button>
                    </div>
                ) : connecting ? (
                    <>
                        <VoiceCallConnecting assistantName={call.callName} style={{ borderRadius: 14 }} />
                        <VoiceMicrophoneStatus read={call.getMicrophoneSnapshot} />
                        <div className="anna-floating-call-row anna-floating-call-connecting-actions">
                            {call.needsAudioPlayback && (
                                <button
                                    type="button"
                                    className="anna-text-button"
                                    aria-label={translate('Enable call audio')}
                                    onClick={() => call.playCallAudio()}
                                >
                                    {translate('Enable call audio')}
                                </button>
                            )}
                            <button
                                type="button"
                                className="anna-text-button anna-floating-call-cancel"
                                aria-label={translate('Cancel assistant call')}
                                onClick={endCall}
                            >
                                {translate('Cancel call')}
                            </button>
                        </div>
                    </>
                ) : (
                    <AnnaCallAudioControls
                        call={call}
                        seconds={seconds}
                        label={call.callName}
                        settingsZIndex={FLOATING_CALL_Z_INDEX + 1}
                        settingsUseSheet={false}
                    >
                        <AnnaCallActions call={call} endLabel={translate('End assistant call')} onEnd={endCall} />
                    </AnnaCallAudioControls>
                )}
                {showForegroundHint && (
                    <span className="anna-call-hint anna-floating-call-hint">
                        {translate(
                            'Keep Alldone open during the call, this browser pauses the microphone in the background'
                        )}
                    </span>
                )}
            </div>
        </View>
    )
}
