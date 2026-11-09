'use strict'

// Security audit 2026-11 (#11): who a server-side notification fan-out may reach.
//
// The follower lists it starts from (`followers/{projectId}/{type}/{id}.usersFollowing`, a chat's
// `usersFollowing`/`followerIds`, a VM job's `userIdsToNotify`) are member-writable and outlive a
// membership: a user removed from a project stayed in them and kept receiving comment text by push,
// email and in-app notification, and any member could add an arbitrary uid. Every server fan-out
// therefore intersects its recipients with the project's CURRENT members (projects/{id}.userIds),
// the same audience firestore.rules `hasValidNotificationRecipients` allows a client to notify.
// It only ever narrows a list.

function getProjectMemberIds(projectData) {
    return new Set(Array.isArray(projectData?.userIds) ? projectData.userIds.filter(id => typeof id === 'string') : [])
}

function filterToProjectMembers(userIds, projectData) {
    const members = getProjectMemberIds(projectData)
    return [...new Set((Array.isArray(userIds) ? userIds : []).filter(id => typeof id === 'string' && members.has(id)))]
}

module.exports = { getProjectMemberIds, filterToProjectMembers }
