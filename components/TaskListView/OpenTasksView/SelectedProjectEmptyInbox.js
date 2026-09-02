import React from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import ModernImage from '../../../utils/ModernImage'
import useProjectEmptyInboxCongratsCelebration from './projectEmptyInboxCongratsMotion'

/**
 * AT-2492 — the per-project "you cleared this project today" moment.
 *
 * The block itself is unchanged: this is still the Anna "tasks done" illustration that has always
 * shown when a project's list is clear, and a settled block is byte-identical to what it rendered
 * before — no residual transform, no new text, nothing left behind once the run ends. What is new is
 * that the FIRST time you see it on a day you actually cleared this project, it arrives instead of
 * simply being there.
 *
 * This pop is the SMALLER HALF of that moment and only exists on the selected-project board. The
 * statement is the completed sweep across the project line (`ProjectCompletedSweep`), which plays on
 * both boards; the picture simply arrives with it on the one board that shows a picture at all.
 *
 * Deliberately smaller than the all-projects celebration, because the task is explicitly about
 * ranking the two: no confetti of any kind (the second pass removed the burst this used to throw —
 * the page-wide fall and its burst belong to the all-projects moment and nothing else may borrow
 * them), no headline, no achievement card, no streak, no green dot. Clearing one project is a good
 * moment; clearing every project is an achievement.
 *
 * The DECISION is not made here — it arrives as `celebrationRunId`, decided in `OpenTasksByProject`
 * and forwarded by `OpenTasksByDate` for today's section only. This block only mounts once the list
 * is already clear, so a hook inside it could never see the transition that earns the celebration,
 * and it renders once per empty date section, so it is also the wrong place to enforce "once".
 */
export default function SelectedProjectEmptyInbox({ projectId, instanceKey, celebrationRunId = 0 }) {
    const thereAreLaterOpenTasksInProject = useSelector(state => state.thereAreLaterOpenTasks[projectId])
    const thereAreLaterEmptyGoalsInProject = useSelector(state => state.thereAreLaterEmptyGoals[projectId])
    const thereAreSomedayOpenTasksInProject = useSelector(state => state.thereAreSomedayOpenTasks[projectId])
    const thereAreSomedayEmptyGoalsInProject = useSelector(state => state.thereAreSomedayEmptyGoals[projectId])

    // `celebrating` is false under reduced motion, under jest and whenever there is nothing to
    // celebrate, so it is the single condition for "animate the picture at all".
    const { entrance, celebrating } = useProjectEmptyInboxCongratsCelebration(celebrationRunId)

    const randomImage = React.useMemo(() => {
        const images = [
            {
                srcWebp: require('../../../assets/anna_tasks_done_01.webp'),
                fallback: require('../../../assets/anna_tasks_done_01.png'),
            },
            {
                srcWebp: require('../../../assets/anna_tasks_done_02.webp'),
                fallback: require('../../../assets/anna_tasks_done_02.png'),
            },
            {
                srcWebp: require('../../../assets/anna_tasks_done_03.webp'),
                fallback: require('../../../assets/anna_tasks_done_03.png'),
            },
        ]
        const randomIndex = Math.floor(Math.random() * images.length)
        return images[randomIndex]
    }, [])

    // Opacity and transform only, so the picture's own `flex: 1` / `width: '100%'` sizing is
    // untouched — the layout risk the all-projects motion declined to take with its 460px
    // illustration. The wrapper below carries the exact sizing the image used to carry itself, so
    // the settled tree lays out identically.
    const pictureStyle = celebrating
        ? {
              opacity: entrance.interpolate({ inputRange: [0, 0.45], outputRange: [0, 1], extrapolate: 'clamp' }),
              transform: [
                  {
                      // A small settle, not a bounce. The picture is already on screen and this is a
                      // flourish on it, not an arrival.
                      scale: entrance.interpolate({
                          inputRange: [0, 0.65, 1],
                          outputRange: [0.94, 1.03, 1],
                          extrapolate: 'clamp',
                      }),
                  },
              ],
          }
        : undefined

    return (
        <View
            style={[
                localStyles.emptyInbox,
                (thereAreLaterOpenTasksInProject ||
                    thereAreLaterEmptyGoalsInProject ||
                    thereAreSomedayOpenTasksInProject ||
                    thereAreSomedayEmptyGoalsInProject) && {
                    marginTop: 32,
                },
            ]}
        >
            <Animated.View testID="project-empty-inbox-picture" style={[localStyles.picture, pictureStyle]}>
                <ModernImage
                    srcWebp={randomImage.srcWebp}
                    fallback={randomImage.fallback}
                    style={{ flex: 1, width: '100%', borderRadius: 16 }}
                    alt={'Empty inbox'}
                />
            </Animated.View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    emptyInbox: {
        flex: 1,
        marginTop: 56,
        marginBottom: 32,
        alignItems: 'center',
    },
    // Exactly what the image itself used to declare, moved out one level so the animated wrapper is
    // the sized box and the image keeps filling it.
    picture: {
        flex: 1,
        width: '100%',
        maxWidth: 432,
    },
})
