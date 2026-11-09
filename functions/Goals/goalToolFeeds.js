'use strict'

/**
 * Updates-feed entries for goals written by the goal tools (goalToolService.js).
 *
 * The feed helpers read the actor and the project from the per-instance global state, which every
 * server writer loads first (TaskService, NoteService, contact updates). A tool call on a cold
 * instance has nothing loaded, so each entry point loads it here before touching a feed helper.
 * `feedUser` comes from getAssistantFeedUserForTool: the assistant, or the user with the MCP
 * marker, so the entry reads "Karsten Wysk (via Claude)" when an MCP client made the change.
 */

const admin = require('firebase-admin')

function buildGoalToolFeeds({ db, projectId, feedUser, userId }) {
    const loadState = async () => {
        const { loadFeedsStateForContactWrite } = require('../shared/contactUpdateHelper')
        await loadFeedsStateForContactWrite({ db, projectId, feedUser, userId })
    }

    return {
        async onGoalCreated(goal) {
            await loadState()
            const { createGoalUpdatesChain } = require('../Feeds/goalsFeedsChains')
            await createGoalUpdatesChain(projectId, goal, false, true)
        },

        async onGoalUpdated(goal, changes = {}) {
            if (Object.keys(changes).length === 0) return
            await loadState()
            const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
            const {
                createGoalTitleChangedFeed,
                createGoalDescriptionChangedFeed,
                createGoalProgressChangedFeed,
                createGoalAssigeesChangedFeed,
            } = require('../Feeds/goalsFeeds')

            const batch = new BatchWrapper(admin.firestore())
            if (changes.name) {
                await createGoalTitleChangedFeed(
                    projectId,
                    changes.name.from,
                    changes.name.to,
                    goal.id,
                    batch,
                    feedUser,
                    true
                )
            }
            if (changes.description) {
                await createGoalDescriptionChangedFeed(
                    projectId,
                    changes.description.from,
                    changes.description.to,
                    goal.id,
                    batch,
                    feedUser,
                    true
                )
            }
            if (changes.progress !== undefined) {
                await createGoalProgressChangedFeed(projectId, changes.progress, goal.id, batch, feedUser, true)
            }
            if (changes.assignees) {
                await createGoalAssigeesChangedFeed(
                    projectId,
                    changes.assignees.from,
                    changes.assignees.to,
                    goal.id,
                    batch,
                    feedUser,
                    true
                )
                const added = changes.assignees.to.filter(id => !changes.assignees.from.includes(id))
                if (added.length > 0) {
                    const { FOLLOWER_GOALS_TYPE } = require('../Followers/FollowerConstants')
                    const { addFollowers } = require('../Followers/followerHelper')
                    await addFollowers(
                        projectId,
                        added,
                        { followObjectsType: FOLLOWER_GOALS_TYPE, followObjectId: goal.id, followObject: goal },
                        batch,
                        true
                    )
                }
            }
            await batch.commit()
        },
    }
}

module.exports = { buildGoalToolFeeds }
