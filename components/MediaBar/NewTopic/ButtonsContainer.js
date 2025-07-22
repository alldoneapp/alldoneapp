import React from 'react'
import { StyleSheet, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import BotButtonInModalWhenAddChats from '../../ChatsView/ChatDV/EditorView/BotOption/BotButtonInModalWhenAddChats'

export default function ButtonsContainer({
    isPrivate,
    text,
    handleSubmit,
    setShowFileSelector,
    setShowPrivacyModal,
    onToggleBot,
    botIsActive,
    projectId,
    assistantId,
}) {
    return (
        <View style={localStyles.buttonsContainer}>
            <View style={localStyles.buttonsLeft}>
                <Hotkeys keyName={'alt+p'} onKeyDown={() => setShowPrivacyModal()} filter={e => true}>
                    <Button
                        icon={isPrivate ? 'lock' : 'unlock'}
                        iconColor={colors.Text04}
                        buttonStyle={{ backgroundColor: colors.Secondary200, marginRight: 4 }}
                        onPress={setShowPrivacyModal}
                        disabled={!text}
                        shortcutText={'P'}
                        forceShowShortcut={true}
                        accessible={false}
                    />
                </Hotkeys>
                <Hotkeys keyName={'alt+u'} onKeyDown={() => setShowFileSelector()} filter={e => true}>
                    <Button
                        icon={'folder-plus'}
                        iconColor={colors.Text04}
                        buttonStyle={{
                            backgroundColor: colors.Secondary200,
                            marginRight: 4,
                        }}
                        onPress={setShowFileSelector}
                        shortcutText={'U'}
                        forceShowShortcut={true}
                    />
                </Hotkeys>
                <BotButtonInModalWhenAddChats
                    disabled={!text}
                    botIsActive={botIsActive}
                    onPress={onToggleBot}
                    projectId={projectId}
                    assistantId={assistantId}
                />
            </View>
            <View style={localStyles.buttonsRight}>
                <Button
                    disabled={!text}
                    icon={'plus'}
                    iconColor={'#ffffff'}
                    type={'primary'}
                    onPress={handleSubmit}
                    shortcutText={'Enter'}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
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
    buttonStyle: {
        backgroundColor: colors.Secondary200,
        marginRight: 4,
        width: 115,
        justifyContent: 'flex-start',
    },
})
