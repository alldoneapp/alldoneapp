import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import { checkIfClickInsideComponent, suscribeClickObserver, unsuscribeClickObserver } from '../../../utils/Observers'
import FeedInteractionBarBody from './FeedInteractionBarBody'
import { setActiveModalInFeed } from '../../../redux/actions'
import { dismissAllPopups } from '../../../utils/HelperFunctions'

export default function FeedInteractionBar(props) {
    const dispatch = useDispatch()
    const { FeedModel, setShowInteractionBar, feedObjectType, projectId, feed, isHeaderObject } = props

    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)

    const verifyIfClickInsideComponent = (cursorX, cursorY) => {
        checkIfClickInsideComponent(cursorX, cursorY, refComp, closeInteractionBar)
    }

    const closeInteractionBar = () => {
        setShowInteractionBar(false)
    }

    const unsubscribeObserver = () => {
        unsuscribeClickObserver(feed.id)
    }

    const subscribeObserver = () => {
        suscribeClickObserver(feed.id, verifyIfClickInsideComponent)
    }

    const onKeyDown = event => {
        const popovers = document.querySelectorAll('.react-tiny-popover-container')
        if (event.key === 'Escape' && popovers.length === 0) {
            closeInteractionBar()
        }
    }

    useEffect(() => {
        if (showGlobalSearchPopup) {
            closeInteractionBar()
        }
    }, [showGlobalSearchPopup])

    useEffect(() => {
        dispatch(setActiveModalInFeed(true))
        document.addEventListener('keydown', onKeyDown)
        dismissAllPopups()

        return () => {
            setTimeout(function () {
                dispatch(setActiveModalInFeed(false))
            }, 300)

            document.removeEventListener('keydown', onKeyDown)
        }
    }, [])

    useEffect(() => {
        subscribeObserver()
        return unsubscribeObserver
    }, [])

    return (
        <View
            ref={component => (refComp = component)}
            style={[
                localStyles.container,
                isHeaderObject ? localStyles.headerContainer : null,
                isMiddleScreen ? { marginLeft: 8, marginRight: -8 } : null,
                isMiddleScreen && isHeaderObject ? { marginLeft: -8, marginRight: -8 } : null,
            ]}
        >
            <View style={[localStyles.feed, isHeaderObject ? localStyles.headerObject : null]}>
                {FeedModel({
                    inInteractionBar: true,
                    subscribeClickObserver: subscribeObserver,
                    unsubscribeClickObserver: unsubscribeObserver,
                })}
            </View>
            <FeedInteractionBarBody
                feedObjectType={feedObjectType}
                setShowInteractionBar={setShowInteractionBar}
                projectId={projectId}
                subscribeClickObserver={subscribeObserver}
                unsubscribeClickObserver={unsubscribeObserver}
                feed={feed}
                isMiddleScreen={isMiddleScreen}
                isHeaderObject={isHeaderObject}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        marginRight: -16,
        marginBottom: 8,
        marginLeft: -1,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
    },
    headerContainer: {
        marginTop: 3,
        marginLeft: -17,
    },
    feed: {
        flexDirection: 'row',
        flex: 1,
        backgroundColor: 'FFFFFF',
        borderTopWidth: 1,
        borderTopColor: colors.Grey200,
        borderRightWidth: 1,
        borderRightColor: colors.Grey200,
        borderLeftWidth: 1,
        borderLeftColor: colors.Grey200,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        alignContent: 'center',
        paddingVertical: 10,
    },
    headerObject: {
        alignContent: 'flex-start',
        paddingVertical: 0,
    },
})
