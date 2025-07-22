import React, { useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors } from '../../styles/global'
import FollowSwitchableTagButton from './FollowSwitchableTagButton'
import { useDispatch, useSelector } from 'react-redux'
import { updateFeedActiveTab } from '../../../redux/actions'
import { ALL_TAB, FOLLOWED_TAB } from '../Utils/FeedsConstants'
import Hotkeys from 'react-hot-keys'
import Shortcut from '../../UIControls/Shortcut'

export default function FollowSwitchableTag({
    smallScreenNavigation,
    setAmountFollowedFeeds,
    setAmountAllFeeds,
    amountFollowedFeeds,
    amountAllFeeds,
}) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const feedActiveTab = useSelector(state => state.feedActiveTab)
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
        if (feedActiveTab === ALL_TAB) {
            setAmountAllFeeds(0)
            dispatch(updateFeedActiveTab(FOLLOWED_TAB))
        }
    }

    const activeNotFollowedFilter = () => {
        if (feedActiveTab === FOLLOWED_TAB) {
            setAmountFollowedFeeds(0)
            dispatch(updateFeedActiveTab(ALL_TAB))
        }
    }

    const onShortcutSwitch = () => {
        if (feedActiveTab === ALL_TAB) {
            setAmountAllFeeds(0)
            dispatch(updateFeedActiveTab(FOLLOWED_TAB))
        } else if (feedActiveTab === FOLLOWED_TAB) {
            setAmountFollowedFeeds(0)
            dispatch(updateFeedActiveTab(ALL_TAB))
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
                    isActive={feedActiveTab === FOLLOWED_TAB}
                    feedAmount={amountFollowedFeeds}
                    onPress={activeFollowedFilter}
                    isFollowedButton={true}
                    backgroundAnimation={backgroundAnimation}
                    setFollowedButtonSize={setFollowedButtonSize}
                    smallScreenNavigation={smallScreenNavigation}
                />
                <FollowSwitchableTagButton
                    text="All"
                    icoName="bell"
                    isActive={feedActiveTab === ALL_TAB}
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
