import React, { Component } from 'react'
import { Animated, ScrollView, StyleSheet, View } from 'react-native'
import NavigationBarItem from './NavigationBarItem'
import NavigationBarPicker from './NavigationBarPicker'
import MyPlatform from '../MyPlatform'
import { colors } from '../styles/global'
import store from '../../redux/store'
import { toggleNavPicker } from '../../redux/actions'
import Hotkeys from 'react-hot-keys'
import dom from 'react-dom'
import { DV_TAB_SETTINGS_INVITATIONS, NAVBAR_ITEM_MAP } from '../../utils/TabNavigationConstants'

const finalHeight = 56
export default class NavigationBar extends Component {
    _isMounted = false

    constructor(props) {
        super(props)

        this.updateState = this.updateState.bind(this)
        const storeState = store.getState()

        this.state = {
            activeSearchForm: storeState.activeSearchForm,
            selectedNavItem: storeState.selectedNavItem,
            showShortcuts: storeState.showShortcuts,
            smallScreenNavigation: storeState.smallScreenNavigation,
            blockBackgroundTabShortcut: storeState.blockBackgroundTabShortcut,
            showCheatSheet: storeState.showCheatSheet,
            expanded: storeState.expandedNavPicker,
            route: storeState.route,
            height: new Animated.Value(0),
            forceTabletMargins: false,
            lastNavWidth: 0,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.scrollDesktop = React.createRef()
        this.itemRefs = []
        this.hotkeyParentRef = React.createRef()
    }

    componentDidMount() {
        this._isMounted = true
        this.mountHotKey()
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (
            (this.state.activeSearchForm && !this.state.expanded) ||
            (prevState.activeSearchForm && !this.state.activeSearchForm && this.state.expanded)
        ) {
            this.expandPicker()
        }

        if (this.state.route !== prevState.route) {
            this.mountHotKey()
        }
    }

    componentWillUnmount() {
        this._isMounted = false
        this.state.unsubscribe()
    }

    mountHotKey = () => {
        if (this.hotkeyParentRef?.current) {
            const parentDom = dom.findDOMNode(this.hotkeyParentRef.current)
            dom.render(<Hotkeys keyName={'tab'} onKeyDown={this.onShortcutSwitch} filter={e => true} />, parentDom)
        }
    }

    onLayoutChange = async ({ nativeEvent }) => {
        if (this.scrollDesktop !== undefined) {
            const sum = await MyPlatform.getElementWidth(this.scrollDesktop.current)

            if (this.state.lastNavWidth === 0) {
                this.setState({ lastNavWidth: sum })
            } else {
                if (nativeEvent.layout.width < sum && sum < this.state.lastNavWidth && !this.state.forceTabletMargins) {
                    this.setState({ forceTabletMargins: true })
                } else if (nativeEvent.layout.width >= sum && this.state.forceTabletMargins) {
                    this.setState({ forceTabletMargins: false })
                }
            }
        }
    }

    onShortcutSwitch = (s, e) => {
        let proceed = true
        if (e) {
            e.preventDefault()
            e.stopPropagation()

            let target = e.target || e.srcElement
            let tagName = target.tagName
            proceed =
                !(tagName.isContentEditable || tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') &&
                target.className.indexOf('ql-editor') < 0
        }

        const { tabs } = this.props
        const { selectedNavItem, showCheatSheet, blockBackgroundTabShortcut } = this.state

        if (!showCheatSheet && !blockBackgroundTabShortcut && proceed) {
            const index = tabs.indexOf(selectedNavItem)
            if (index === tabs.length - 1) {
                this.itemRefs[0]?.onPress()
            } else {
                this.itemRefs[index + 1]?.onPress()
            }
        }
    }

    isNextShortcutTab = tab => {
        const { tabs } = this.props
        const { selectedNavItem, showCheatSheet, showShortcuts, blockBackgroundTabShortcut } = this.state

        if (!showCheatSheet && !blockBackgroundTabShortcut && showShortcuts) {
            const index = tabs.indexOf(selectedNavItem)
            if (index === tabs.length - 1) {
                return tabs[0] === tab
            } else {
                return tabs[index + 1] === tab
            }
        }
    }

    render() {
        const {
            tabs,
            isSecondary,
            showFollowedNotifications,
            feedAmount,
            showSearchBadges,
            invitationsAmount,
            style,
        } = this.props

        const { height, forceTabletMargins, expanded, selectedNavItem, smallScreenNavigation } = this.state
        if (!smallScreenNavigation || isSecondary) {
            return (
                <View
                    onLayout={this.onLayoutChange}
                    style={[
                        localStyles.container,
                        smallScreenNavigation ? localStyles.containerUnderBreakpoint : undefined,
                        style,
                    ]}
                >
                    <View style={isSecondary && { flex: 1 }} ref={this.scrollDesktop}>
                        <ScrollView
                            style={{ flex: 1 }}
                            horizontal={true}
                            showsHorizontalScrollIndicator={false}
                            overScrollMode={'never'}
                            contentContainerStyle={localStyles.itemsContainer}
                        >
                            {/* This is to insert dynamically the hotkey component */}
                            <View ref={this.hotkeyParentRef} />

                            {tabs.map((tabItem, i) => (
                                <View key={i}>
                                    <NavigationBarItem
                                        ref={ref => (this.itemRefs[i] = ref)}
                                        selected={selectedNavItem === tabItem}
                                        showSearchBadges={showSearchBadges}
                                        isSecondary={isSecondary}
                                        feedAmount={
                                            (NAVBAR_ITEM_MAP[tabItem] === 'Updates' || tabItem === 'Updates') &&
                                            feedAmount
                                        }
                                        invitationsAmount={
                                            tabItem === DV_TAB_SETTINGS_INVITATIONS && invitationsAmount > 0
                                                ? invitationsAmount
                                                : 0
                                        }
                                        showFollowedNotifications={showFollowedNotifications}
                                        forceTabletMargins={forceTabletMargins}
                                        isNextShortcutTab={this.isNextShortcutTab(tabItem)}
                                    >
                                        {tabItem}
                                    </NavigationBarItem>
                                </View>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            )
        } else {
            return (
                <View style={[localStyles.containerMobile, { ...style }]}>
                    <View style={localStyles.subContainerMobile}>
                        <View style={localStyles.subMobile}>
                            <NavigationBarPicker
                                expanded={expanded}
                                onPress={this.expandPicker}
                                feedAmount={!expanded && feedAmount}
                                showFollowedNotifications={showFollowedNotifications}
                            >
                                {selectedNavItem}
                            </NavigationBarPicker>
                        </View>
                    </View>

                    <Animated.View style={[localStyles.itemsContainerMobile, { height: height }]}>
                        <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} overScrollMode={'never'}>
                            <View style={{ flexDirection: 'row' }}>
                                {tabs.map((tabItem, i) => (
                                    <NavigationBarItem
                                        key={i}
                                        isMobile
                                        selected={selectedNavItem === tabItem}
                                        showSearchBadges={showSearchBadges}
                                        expandPicker={this.expandPicker}
                                        feedAmount={
                                            (NAVBAR_ITEM_MAP[tabItem] === 'Updates' || tabItem === 'Updates') &&
                                            feedAmount
                                        }
                                        showFollowedNotifications={showFollowedNotifications}
                                    >
                                        {tabItem}
                                    </NavigationBarItem>
                                ))}
                            </View>
                        </ScrollView>
                    </Animated.View>
                </View>
            )
        }
    }

    expandPicker = () => {
        if (this.state.expanded) {
            Animated.timing(
                // Animate value over time
                this.state.height, // The value to drive
                {
                    toValue: 0, // Animate to final value
                    duration: 200,
                }
            ).start(this.toggleNavPickerOff) // Start the animation
        } else {
            Animated.timing(
                // Animate value over time
                this.state.height, // The value to drive
                {
                    toValue: finalHeight, // Animate to final value
                    duration: 200,
                }
            ).start(this.toggleNavPickerOn) // Start the animation
        }
    }

    updateState() {
        if (!this._isMounted) return

        const storeState = store.getState()
        this.setState({
            activeSearchForm: storeState.activeSearchForm,
            expanded: storeState.expandedNavPicker,
            showShortcuts: storeState.showShortcuts,
            selectedNavItem: storeState.selectedNavItem,
            smallScreenNavigation: storeState.smallScreenNavigation,
            blockBackgroundTabShortcut: storeState.blockBackgroundTabShortcut,
            showCheatSheet: storeState.showCheatSheet,
            route: storeState.route,
        })
    }

    toggleNavPickerOff = () => {
        store.dispatch(toggleNavPicker(false))
    }

    toggleNavPickerOn = () => {
        store.dispatch(toggleNavPicker(true))
    }
}

const localStyles = StyleSheet.create({
    container: {
        // backgroundColor: 'white',
        flexDirection: 'row',
        borderBottomColor: colors.Primary400,
        borderBottomWidth: 1,
        height: 64,
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        overflow: 'hidden',
    },
    containerUnderBreakpoint: {
        marginHorizontal: 16,
    },
    itemsContainer: {
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    containerMobile: {
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: colors.Primary400,
        paddingLeft: 18,
        overflow: 'hidden',
    },
    subContainerMobile: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.Primary400,
        height: 56,
    },
    subMobile: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    itemsContainerMobile: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: colors.Primary400,
        height: 0,
        marginLeft: -18,
    },
    karmaBarDetailsContainer: {
        flex: 1,
        flexDirection: 'row',
        alignSelf: 'flex-end',
        backgroundColor: colors.Primary400,
        height: 0,
    },
    karmaBarDetailsParent: {
        marginTop: 0,
        marginBottom: 0,
        justifyContent: 'center',
    },
    karmaBarDetails: {
        height: 36,
        backgroundColor: colors.Primary350,
    },
})
