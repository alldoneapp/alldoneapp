import React, { useMemo } from 'react'
import { Animated, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import AllProjectsEmptyInboxAddTask from './AllProjectsEmptyInboxAddTask'
import AllProjectsEmptyInboxTags from './AllProjectsEmptyInboxTags'
import AllProjectsEmptyInboxText from './AllProjectsEmptyInboxText'
import AllProjectsEmptyInboxPicture from './AllProjectsEmptyInboxPicture'
import EmptyInboxConfetti, { CONFETTI_LAYER_Z_INDEX } from './EmptyInboxConfetti'
import useEmptyInboxCongratsCelebration from './emptyInboxCongratsMotion'
import { EmptyInboxOverview } from '../../SettingsView/Profile/Achievements/AchievementsArea'
import useTodayEmptyInboxCelebration from '../../SettingsView/Profile/Achievements/useTodayEmptyInboxCelebration'
import { getEmptyInboxDaysWithLegacyFallback } from '../../SettingsView/Profile/Achievements/AchievementsHelper'
import { navigateToSettings } from '../../../redux/actions'
import { DV_TAB_SETTINGS_PROFILE } from '../../../utils/TabNavigationConstants'
import NavigationService from '../../../utils/NavigationService'

/**
 * AT-2445: the once-per-day decision is made HERE rather than inside `EmptyInboxOverview`, and the
 * run id is handed down.
 *
 * Two reasons. The celebration now has beats outside the achievement card — the congratulation and
 * the confetti over it — and one run id is what makes them and the card's dot a single event rather
 * than several animations that happen to overlap. And this block renders in My Day too, where the
 * card is deliberately not shown; owning the decision here is what lets clearing your last task from
 * My Day celebrate at all, which it never did.
 *
 * `celebrateNewDay` therefore now means "this surface is allowed to spend the day", and the card is
 * only ever a consumer of the result. The Settings → Profile copy of the card keeps its own
 * disabled hook and still cannot spend anything.
 *
 * It defaults to OFF and is opted into by the two open-task boards only. The same block also renders
 * on the Done, Pending and Workflow all-projects boards, and none of those is an inbox-zero moment —
 * an empty Done list means you have completed nothing today, which is the opposite of something to
 * congratulate. Worse, letting them celebrate would let them SPEND the day, so the one board that
 * should have celebrated would find it already gone.
 *
 * AT-2506 moved the decision one level further up again, for the two boards that opt in: they stay
 * mounted while this block comes and goes, so they are the only place that can tell "the inbox just
 * emptied in front of you" — which must always animate — from "you arrived at an empty inbox",
 * which must not replay. They pass the result down as `celebrationRunId`, and this block keeps its
 * own hook as the fallback for any caller that owns no board, so nothing about the four
 * non-celebrating call sites changes. Exactly the arrangement `EmptyInboxOverview` already has with
 * this component, one level down.
 */
export default function AllProjectsEmptyInbox({
    showEmptyInboxOverview = false,
    celebrateNewDay = false,
    celebrationRunId = null,
}) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const emptyInboxDays = useMemo(
        () => getEmptyInboxDaysWithLegacyFallback(loggedUser),
        [loggedUser.emptyInboxDays, loggedUser.lastDayEmptyInbox]
    )
    // `celebrationRunId == null` is what disables the fallback: a caller that owns the run must be
    // the only claimant, or the day would be spent twice and the second claim would win an argument
    // it should never have been in.
    const ownCelebrationRunId = useTodayEmptyInboxCelebration(
        emptyInboxDays,
        celebrateNewDay && celebrationRunId == null,
        loggedUser.uid
    )
    const resolvedCelebrationRunId = celebrationRunId == null ? ownCelebrationRunId : celebrationRunId
    // `celebrating` is false on the reduced-motion and jest paths as well as when there is nothing
    // to celebrate, so it is the single condition for "render the decorative layers".
    const { entrance, confetti, celebrating } = useEmptyInboxCongratsCelebration(resolvedCelebrationRunId)

    const openAchievements = () => {
        dispatch(
            navigateToSettings({
                selectedNavItem: DV_TAB_SETTINGS_PROFILE,
                settingsScrollToTopToken: Date.now(),
            })
        )
        NavigationService.navigate('SettingsView')
    }

    // A settled block is the plain block: no residual transform, so what a reload renders and what
    // the celebration leaves behind are byte-identical. Only the headline is animated — the picture
    // below it is a 460px illustration whose own `flex: 1` / `width: '100%'` sizing would have to be
    // reproduced by any wrapper put around it, and it is not worth a layout risk for the least
    // important beat.
    const headlineStyle = celebrating
        ? {
              opacity: entrance.interpolate({ inputRange: [0, 0.4], outputRange: [0, 1], extrapolate: 'clamp' }),
              transform: [
                  {
                      // Rises into place. A transform, so it moves nothing around it.
                      translateY: entrance.interpolate({
                          inputRange: [0, 0.75],
                          outputRange: [10, 0],
                          extrapolate: 'clamp',
                      }),
                  },
                  {
                      // Overshoot and settle. Still small — this is a line of text, and text that
                      // bounces reads as a toast rather than as an achievement. The volume of
                      // AT-2460 goes into the confetti and the dot, not into the typography.
                      scale: entrance.interpolate({
                          inputRange: [0, 0.7, 1],
                          outputRange: [0.92, 1.05, 1],
                          extrapolate: 'clamp',
                      }),
                  },
              ],
          }
        : undefined

    return (
        // AT-2460: the block is lifted for exactly as long as it is celebrating. The confetti's own
        // `zIndex` cannot reach past this View — react-native-web gives every View `z-index: 0`, so
        // this block is already its own stacking context — and without the lift the page-wide fall
        // would paint behind everything the board renders below the block. It is put back the
        // moment the run settles, so the board's normal stacking is untouched the rest of the time.
        <View style={[localStyles.emptyInbox, celebrating && localStyles.celebratingEmptyInbox]}>
            {/* Overlays: one anchored to the top of the block and one over the whole viewport, so
                the confetti can never move the congratulation, the Add task button or the tags
                while it plays, and never intercepts a tap on them. */}
            <EmptyInboxConfetti confetti={confetti} visible={celebrating} />
            <Animated.View testID="empty-inbox-congrats-headline" style={headlineStyle}>
                <AllProjectsEmptyInboxText />
            </Animated.View>
            <AllProjectsEmptyInboxAddTask />
            <AllProjectsEmptyInboxTags />
            {showEmptyInboxOverview && (
                <EmptyInboxOverview
                    user={loggedUser}
                    style={localStyles.emptyInboxOverview}
                    onOpenAchievements={openAchievements}
                    celebrationRunId={resolvedCelebrationRunId}
                />
            )}
            <AllProjectsEmptyInboxPicture />
        </View>
    )
}

const localStyles = {
    // AT-2262: this block is rendered directly BELOW the assistant line (which also
    // renders the latest comment) and above the email line / task filters, so the
    // congrats is visible without scrolling while the assistant composer and the last
    // comment keep the top of the page. As a middle child it must size to its own
    // content: `flex: 1` would let it stretch into any spare height of the scroll
    // container and push the email line and filters off-screen (and shrink the block
    // when the content is taller than the viewport).
    emptyInbox: {
        marginTop: 12,
        marginBottom: 24,
        alignItems: 'center',
    },
    celebratingEmptyInbox: {
        zIndex: CONFETTI_LAYER_Z_INDEX,
    },
    emptyInboxOverview: {
        width: '100%',
        marginTop: 24,
        marginBottom: 24,
    },
}
