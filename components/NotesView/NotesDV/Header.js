import React, { Component } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import TagList from './TagList'
import store from '../../../redux/store'
import styles, { colors } from '../../styles/global'
import BackButton from './BackButton'
import SharedHelper from '../../../utils/SharedHelper'
import DVHamburgButton from '../../UIControls/DVHamburgButton'
import NoteTitleEdition from './NoteTitleEdition'
import NoteTitlePresentation from './NoteTitlePresentation'
import { DV_TAB_NOTE_CHAT, DV_TAB_NOTE_EDITOR } from '../../../utils/TabNavigationConstants'
import BotLine from '../../ChatsView/ChatDV/BotLine/BotLine'
import { updateNoteTitle } from '../../../utils/backends/Notes/notesFirestore'

export default class Header extends Component {
    constructor(props) {
        super(props)

        const storeState = store.getState()

        this.state = {
            selectedTab: storeState.selectedNavItem,
            isMiddleScreen: storeState.isMiddleScreen,
            mobile: storeState.smallScreenNavigation,
            loggedUser: storeState.loggedUser,
            taskTitleInEditMode: storeState.taskTitleInEditMode,
            editionMode: false,
            showEllipsis: false,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    getMaxHeight = () => {
        const { editionMode, selectedTab } = this.state
        return (selectedTab === DV_TAB_NOTE_CHAT || selectedTab === DV_TAB_NOTE_EDITOR) && !editionMode ? 64 : 350
    }

    openTitleEdition = () => {
        this.setState({ editionMode: true })
    }

    closeTitleEdition = () => {
        this.setState({ editionMode: false })
    }

    onTitleLayoutChange = ({ nativeEvent }) => {
        const maxHeight = this.getMaxHeight()
        const { layout } = nativeEvent

        if (layout.height > maxHeight && !this.state.showEllipsis) {
            this.setState({ showEllipsis: true })
        } else if (layout.height <= maxHeight && this.state.showEllipsis) {
            this.setState({ showEllipsis: false })
        }
    }

    render() {
        const { projectId, note, navigation, isFullscreen, disabled, setFullscreen } = this.props
        const { mobile, isMiddleScreen, loggedUser, editionMode, selectedTab, showEllipsis } = this.state
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
        const maxHeight = this.getMaxHeight()

        return (
            <Animated.View
                style={[
                    mobile
                        ? localStyles.containerMobile
                        : isMiddleScreen
                        ? localStyles.containerTablet
                        : localStyles.container,
                    isFullscreen && localStyles.containerFS,
                ]}
            >
                <View
                    style={[
                        localStyles.upperHeader,
                        isFullscreen
                            ? selectedTab === DV_TAB_NOTE_CHAT
                                ? { paddingBottom: 16 }
                                : localStyles.upperHeaderFS
                            : null,
                    ]}
                >
                    {isMiddleScreen && accessGranted && (
                        <View style={localStyles.backButtonMobile}>
                            <BackButton projectId={projectId} note={note} />
                        </View>
                    )}

                    {mobile && loggedUser.isAnonymous && (
                        <View style={localStyles.backButtonMobile}>
                            <DVHamburgButton navigation={navigation} />
                        </View>
                    )}

                    <View style={[localStyles.titleContainer, { maxHeight: maxHeight }]}>
                        {editionMode ? (
                            <NoteTitleEdition
                                projectId={projectId}
                                note={note}
                                onSubmit={title => {
                                    updateNoteTitle(projectId, note.id, title, note)
                                }}
                                numberOfLines={10}
                                closeTitleEdition={this.closeTitleEdition}
                            />
                        ) : (
                            <View onLayout={this.onTitleLayoutChange}>
                                <NoteTitlePresentation
                                    projectId={projectId}
                                    openTitleEdition={this.openTitleEdition}
                                    note={note}
                                    disabled={!accessGranted || disabled}
                                />
                            </View>
                        )}
                        {showEllipsis && !editionMode && (
                            <Text style={[localStyles.ellipsis, { right: mobile ? 32 : 80 }]}>...</Text>
                        )}
                    </View>
                </View>

                {!isFullscreen && (
                    <View style={localStyles.bottomHeader}>
                        <TagList projectId={projectId} note={this.props.note} disabled={disabled} />
                    </View>
                )}
                {isFullscreen && selectedTab === DV_TAB_NOTE_CHAT && (
                    <View style={localStyles.bottomHeader}>
                        <BotLine
                            setFullscreen={setFullscreen}
                            objectId={note.id}
                            assistantId={note.assistantId}
                            projectId={projectId}
                            objectType={'notes'}
                        />
                    </View>
                )}
            </Animated.View>
        )
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            selectedTab: storeState.selectedNavItem,
            mobile: storeState.smallScreenNavigation,
            loggedUser: storeState.loggedUser,
            isMiddleScreen: storeState.isMiddleScreen,
            photoURL: storeState.assignee.photoURL,
            taskTitleInEditMode: storeState.taskTitleInEditMode,
        })
    }
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 140,
        flexDirection: 'column',
        justifyContent: 'space-between',
        paddingBottom: 24,
        marginHorizontal: 104,
    },
    containerTablet: {
        flexDirection: 'column',
        justifyContent: 'space-between',
        marginHorizontal: 56,
    },
    containerMobile: {
        flexDirection: 'column',
        justifyContent: 'space-between',
    },
    containerFS: {
        minHeight: 80,
        paddingBottom: 0,
    },
    titleContainer: {
        marginRight: 'auto',
        flex: 1,
        maxHeight: 350,
        overflowY: 'hidden',
    },
    upperHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingBottom: 32,
    },
    upperHeaderFS: {
        paddingBottom: 0,
    },
    bottomHeader: {
        flexDirection: 'row',
    },
    userImage: {
        backgroundColor: colors.Text03,
        height: 24,
        width: 24,
        borderRadius: 100,
        marginRight: 8,
    },
    backButtonMobile: {
        left: -16,
    },
    backButtonTablet: {
        left: -16,
    },
    ellipsis: {
        ...styles.title4,
        color: colors.Text01,
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        position: 'absolute',
        bottom: 0,
        right: 0,
    },
})
