import React, { useMemo } from 'react'
import { Animated, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import AllProjectsEmptyInboxAddTask from './AllProjectsEmptyInboxAddTask'
import AllProjectsEmptyInboxTags from './AllProjectsEmptyInboxTags'
import AllProjectsEmptyInboxText from './AllProjectsEmptyInboxText'
import AllProjectsEmptyInboxPicture from './AllProjectsEmptyInboxPicture'
import EmptyInboxConfetti from './EmptyInboxConfetti'
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
 */
export default function AllProjectsEmptyInbox({ showEmptyInboxOverview = false, celebrateNewDay = false }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const emptyInboxDays = useMemo(
        () => getEmptyInboxDaysWithLegacyFallback(loggedUser),
        [loggedUser.emptyInboxDays, loggedUser.lastDayEmptyInbox]
    )
    const celebrationRunId = useTodayEmptyInboxCelebration(emptyInboxDays, celebrateNewDay, loggedUser.uid)
    // `celebrating` is false on the reduced-motion and jest paths as well as when there is nothing
    // to celebrate, so it is the single condition for "render the decorative layers".
    const { entrance, confetti, celebrating } = useEmptyInboxCongratsCelebration(celebrationRunId)

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
              opacity: entrance.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: 'clamp' }),
              transform: [
                  {
                      // Overshoot and settle. Small — this is a line of text, and text that bounces
                      // reads as a toast rather than as an achievement.
                      scale: entrance.interpolate({
                          inputRange: [0, 0.7, 1],
                          outputRange: [0.94, 1.03, 1],
                          extrapolate: 'clamp',
                      }),
                  },
              ],
          }
        : undefined

    return (
        <View style={localStyles.emptyInbox}>
            {/* An overlay anchored to the top of the block, so the confetti can never move the
                congratulation, the Add task button or the tags while it plays, and never intercepts
                a tap on them. */}
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
                    celebrationRunId={celebrationRunId}
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
    emptyInboxOverview: {
        width: '100%',
        marginTop: 24,
        marginBottom: 24,
    },
}
