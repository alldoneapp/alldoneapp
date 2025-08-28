import React, { useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import { colors } from '../../styles/global'
import { setChatsActiveTab } from '../../../redux/actions'
import Shortcut from '../../UIControls/Shortcut'
import { ALL_TAB, FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import FollowSwitchableTagButton from '../../Feeds/FollowSwitchableTag/FollowSwitchableTagButton'

export default function ChatsSwitchableTag({ smallScreenNavigation, amountFollowedFeeds, amountAllFeeds }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const backgroundWidthAnim = useRef(new Animated.Value(0)).current
    const backgroundLeftPosition = useRef(new Animated.Value(0)).current
    const [followedButtonSize, setFollowedButtonSize] = useState(0)
    const dispatch = useDispatch()
    const backgroundAnimation = (nextPosition, nextWidth) => {
        Animated.parallel(
            [
                Animated.timing(backgroundLeftPosition, {
                    toValue: nextPosition,
                    duration: 300,
                }),
                Animated.timing(backgroundWidthAnim, {
                    toValue: nextWidth,
                    duration: 200,
                }),
            ],
            { stopTogether: false }
        ).start()
    }

    const activeFollowedFilter = () => {
        if (chatsActiveTab === ALL_TAB) {
            dispatch(setChatsActiveTab(FOLLOWED_TAB))
        }
    }

    const activeNotFollowedFilter = () => {
        if (chatsActiveTab === FOLLOWED_TAB) {
            dispatch(setChatsActiveTab(ALL_TAB))
        }
    }

    const onShortcutSwitch = () => {
        if (chatsActiveTab === ALL_TAB) {
            dispatch(setChatsActiveTab(FOLLOWED_TAB))
        } else if (chatsActiveTab === FOLLOWED_TAB) {
            dispatch(setChatsActiveTab(ALL_TAB))
        }
    }

    return (
        <View>
            <View style={[localStyles.container, smallScreenNavigation ? localStyles.containerMobile : null]}>
                <Hotkeys disabled={blockShortcuts} keyName={'alt+G'} onKeyDown={onShortcutSwitch} filter={e => true} />

                <Animated.View
                    style={[
                        localStyles.activeView,
                        smallScreenNavigation ? localStyles.activeViewMobile : null,
                        { width: backgroundWidthAnim, left: backgroundLeftPosition },
                    ]}
                />
                <FollowSwitchableTagButton
                    text="Followed"
                    icoName="eye"
                    isActive={chatsActiveTab === FOLLOWED_TAB}
                    feedAmount={amountFollowedFeeds}
                    onPress={activeFollowedFilter}
                    isFollowedButton={true}
                    backgroundAnimation={backgroundAnimation}
                    setFollowedButtonSize={setFollowedButtonSize}
                    smallScreenNavigation={smallScreenNavigation}
                />
                <FollowSwitchableTagButton
                    text="All"
                    icoName="comments-thread"
                    isActive={chatsActiveTab === ALL_TAB}
                    feedAmount={amountAllFeeds}
                    onPress={activeNotFollowedFilter}
                    backgroundAnimation={backgroundAnimation}
                    followedButtonSize={followedButtonSize}
                    smallScreenNavigation={smallScreenNavigation}
                />
            </View>

            {showShortcuts && showFloatPopup === 0 && (
                <Shortcut text={'G'} containerStyle={[{ position: 'absolute', top: -4, right: 0 }]} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Grey300,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
        borderRadius: 12,
        height: 26,
        paddingHorizontal: 2,
    },
    containerMobile: {
        height: 24,
    },
    activeView: {
        position: 'absolute',
        backgroundColor: colors.Grey100,
        height: 22,
        borderRadius: 12,
        shadowColor: colors.Text03,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
    },
    activeViewMobile: {
        height: 20,
    },
})
