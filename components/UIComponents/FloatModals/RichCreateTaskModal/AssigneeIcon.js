import React, { useMemo } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import { getWorkstreamById, WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'

/**
 * The assignee avatar of the add-task popup.
 *
 * AT-2464: this used to destructure `photoURL` straight off the lookup result, and that crashed
 * the WHOLE APP — not just the avatar. A throw here escapes to the top-level `ErrorBoundary` in
 * `App.js`, which replaces every screen with `ErrorBoundaryPage`; the reported symptom was "the
 * app crashes", with no hint that a 24px picture caused it.
 *
 * Both lookups below legitimately answer "nobody", and the popup is exactly where that happens:
 * its project switcher changes `projectId` WITHOUT remounting, so one render later this resolves
 * a person against a project whose people have not been loaded yet. Since AT-2386 those
 * collections are fetched on demand (`projectDataLoader.js`), so a miss means "not requested yet"
 * at least as often as "not a member" — which is why the crash was intermittent: switching to a
 * project visited earlier in the session found its users in redux and rendered fine, switching to
 * any other one threw. The workstream branch has the same shape and returns `null` on a miss.
 *
 * A miss is a missing avatar, never a crash. This is the same conclusion `AssigneeButton` (the
 * inline task row's equivalent) already reached for `user.photoURL` under AT-2386; this component
 * was simply not part of that sweep.
 */
export default function AssigneeIcon({ projectId, userId }) {
    // A draft with no assignee resolved yet has nobody to draw, and `userId.startsWith` on it
    // would throw the same app-wide crash this component exists to stop producing.
    const ownerIsWorkstream = !!userId && userId.startsWith(WORKSTREAM_ID_PREFIX)

    // What makes the avatar fill in silently once the project's people land, which is the second
    // half of the AT-2386 contract: the lookups read `store.getState()` directly, so without a
    // subscription this only re-renders when the popup re-renders for some other reason, and the
    // generic avatar would simply stay. A STRING of the three sizes, not the arrays themselves —
    // the slices are seeded `[]` for every project from the first frame, so only their contents
    // change, and a primitive cannot allocate a fresh identity on every selector run (AT-2336).
    const projectPeopleKey = useSelector(state =>
        [state.projectUsers[projectId], state.projectContacts[projectId], state.projectWorkstreams[projectId]]
            .map(list => (list ? list.length : -1))
            .join('|')
    )

    // Both helpers report their own miss to the on-demand loader, so resolving inside a memo keyed
    // on `projectPeopleKey` also means one request per project rather than one per render.
    const user = useMemo(
        () => (ownerIsWorkstream ? getWorkstreamById(projectId, userId) : TasksHelper.getPeopleById(userId, projectId)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ownerIsWorkstream, projectId, userId, projectPeopleKey]
    )

    const { photoURL } = user || {}

    return (
        <View style={localStyles.container}>
            {ownerIsWorkstream ? (
                <Icon size={24} name="workstream" color={'#ffffff'} />
            ) : photoURL ? (
                <Image style={{ width: 24, height: 24 }} source={{ uri: photoURL }} />
            ) : (
                <SVGGenericUser width={24} height={24} svgid={`ci_p_rich_assignee_${projectId}`} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 24,
        height: 24,
        borderRadius: 50,
        backgroundColor: 'transparent',
        overflow: 'hidden',
    },
})
