import React, { useEffect, useRef } from 'react'
import { View, StyleSheet, ActivityIndicator } from 'react-native'
import Swipeable from 'react-native-gesture-handler/Swipeable'

import store from '../../../redux/store'
import { showSwipeDueDatePopup, setSwipeDueDatePopupData } from '../../../redux/actions'
import GoalsSwipeBackground from '../../GoalsView/GoalsSwipeBackground'
import { createSwipeCloseGuard } from '../../../hooks/useSwipeCloseGuard'
import useProjectPostponePreview from '../../../hooks/useProjectPostponePreview'
import { translate } from '../../../i18n/TranslationService'

export default function ProjectPostponeSwipe({ projectId, children }) {
    const postponeEntry = useProjectPostponePreview(projectId)
    const swipe = useRef(null)
    const blocked = useRef(false)
    const guard = useRef(null)
    if (!guard.current)
        guard.current = createSwipeCloseGuard(value => {
            blocked.current = value
        })
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    const postpone = () => {
        swipe.current.close()
        setTimeout(() => {
            if (!mounted.current) return
            store.dispatch([showSwipeDueDatePopup(), setSwipeDueDatePopupData({ projectId, isProjectPostpone: true })])
        })
    }

    return (
        <View
            style={styles.container}
            onClickCapture={event => {
                if (blocked.current) {
                    event.preventDefault()
                    event.stopPropagation()
                }
            }}
        >
            <GoalsSwipeBackground needToShowReminderButton={true} />
            <Swipeable
                ref={swipe}
                useNativeAnimations={false}
                rightThreshold={80}
                renderRightActions={() => <View style={styles.action} />}
                onSwipeableRightWillOpen={postpone}
                {...guard.current}
                overshootRight={false}
                friction={2}
                failOffsetY={[-5, 5]}
                containerStyle={{ overflow: 'visible' }}
            >
                {children}
            </Swipeable>
            {postponeEntry?.saving && (
                <View
                    style={styles.pending}
                    pointerEvents="none"
                    accessibilityRole="status"
                    accessibilityLabel={translate('Postpone')}
                >
                    <ActivityIndicator size="small" />
                </View>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: { position: 'relative' },
    action: { width: 150 },
    pending: { position: 'absolute', right: 8, top: 8 },
})
