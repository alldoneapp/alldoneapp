import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'
import { isMcpActor, withMcpActorLabel } from '../../../utils/mcpActorLabel'

// The author of a feed entry as the feed types show it: the user, and for an entry an MCP client wrote
// in their name, "Karsten (via Claude)" (functions/shared/mcpActor.js).
export const getFeedCreatorPresentationData = (projectId, feed) => {
    const presentationData = getUserPresentationDataInProject(projectId, feed?.creatorId)
    if (!isMcpActor(feed)) return presentationData
    return {
        ...presentationData,
        displayName: withMcpActorLabel(presentationData.displayName, feed),
        shortName: withMcpActorLabel(presentationData.shortName, feed),
    }
}
