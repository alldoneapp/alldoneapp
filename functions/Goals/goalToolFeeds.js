'use strict'

/**
 * Updates-feed entries for goals written by the goal tools (goalToolService.js): every change the
 * tools make writes one, dates included. A milestone has no feed object of its own, so its changes
 * (update_milestone) are lines on the project's feed object.
 *
 * The feed helpers read the actor and the project from the per-instance global state, which every
 * server writer loads first (TaskService, NoteService, contact updates). A tool call on a cold
 * instance has nothing loaded, so each entry point loads it here before touching a feed helper.
 * `feedUser` comes from getAssistantFeedUserForTool: the assistant, or the user with the MCP
 * marker, so the entry reads "Karsten Wysk (via Claude)" when an MCP client made the change.
 */

const admin = require('firebase-admin')

const { ALL_USERS, FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { shrinkTagText } = require('../Utils/parseTextUtils')

const MILESTONE_NAME_FEED_LIMIT = 60

// How a milestone change reads in Updates, on the project's feed object ("Karsten Wysk (via Claude)
// marked milestone "Discovery" as done"). A milestone without a name is named by its day.
function describeMilestoneChange(change = {}) {
    const quote = name => `"${shrinkTagText(name, MILESTONE_NAME_FEED_LIMIT)}"`
    const label = ({ name, day }) => (name ? quote(name) : `of ${day}`)
    switch (change.kind) {
        case 'renamed':
            if (!change.from) return `named milestone of ${change.day} • ${quote(change.to)}`
            if (!change.to) return `removed the name of milestone of ${change.day} • Was ${quote(change.from)}`
            return `renamed milestone • From ${quote(change.from)} to ${quote(change.to)}`
        case 'moved':
            return (
                `moved milestone${change.name ? ` ${quote(change.name)}` : ''} • From ${change.from} to ${change.to}` +
                (change.merged ? ', merged with the milestone already on that day' : '')
            )
        case 'done':
            return `marked milestone ${label(change)} as done`
        case 'reopened':
            return `reopened milestone ${label(change)}`
        default:
            return null
    }
}

// Everybody's milestone, or one member's own in a guide project (ownerId is that member).
const milestoneAudience = ownerId => (!ownerId || ownerId === ALL_USERS ? [FEED_PUBLIC_FOR_ALL] : [ownerId])

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
            // The app writes no entry for a goal's dates; the goal tools do, so that a goal an agent
            // moved does not move silently.
            const { createGoalMilestoneChangedFeed } = require('../Feeds/goalsFeeds')
            for (const field of ['milestoneDate', 'startDate', 'scheduleMode']) {
                if (!changes[field]) continue
                await createGoalMilestoneChangedFeed(
                    projectId,
                    { field, ...changes[field] },
                    goal.id,
                    batch,
                    feedUser,
                    true
                )
            }
            await batch.commit()
        },

        // A milestone has no feed object: its changes are lines on the project's feed object.
        async onMilestoneUpdated(milestone, changes = [], project) {
            const entries = changes.map(describeMilestoneChange).filter(Boolean)
            if (entries.length === 0) return
            await loadState()
            const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
            const { createProjectEntryFeed } = require('../Feeds/projectEntryFeeds')
            const { FEED_PROJECT_MILESTONE_CHANGED } = require('../Feeds/FeedsConstants')

            const batch = new BatchWrapper(admin.firestore())
            for (const entryText of entries) {
                await createProjectEntryFeed({
                    projectId,
                    project,
                    feedType: FEED_PROJECT_MILESTONE_CHANGED,
                    entryText,
                    isPublicFor: milestoneAudience(milestone?.ownerId),
                    extraFields: milestone?.id ? { milestoneId: milestone.id } : {},
                    batch,
                    feedUser,
                })
            }
            await batch.commit()
        },
    }
}

module.exports = { buildGoalToolFeeds, describeMilestoneChange, milestoneAudience }
