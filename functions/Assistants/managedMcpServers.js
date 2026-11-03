/**
 * MCP server entries an assistant does not own: the alldone.team specialists (Connor, Judy, Ricky)
 * are assistant templates synced from alldone.team (./alldoneTeamSpecialists.js), and their one
 * MCP server entry belongs to that sync. It follows the template into every project copy, survives
 * the three-way template merge (a local server added next to it is kept), and the MCP server
 * callables and modal refuse to edit or remove it.
 *
 * Dependency-free on purpose: the client imports it too.
 */

const ALLDONE_TEAM_MANAGER = 'alldone.team'

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const isManagedMcpServer = server => isObject(server) && typeof server.managedBy === 'string' && !!server.managedBy

const listServers = servers => (Array.isArray(servers) ? servers.filter(isObject) : [])

// Firestore hands maps back with their keys in its own order, so JSON.stringify of a stored entry and
// of the same entry built here can differ; this compares lists of entries by content only.
const canonical = value =>
    Array.isArray(value)
        ? value.map(canonical)
        : isObject(value)
          ? Object.keys(value)
                .sort()
                .reduce((result, key) => ({ ...result, [key]: canonical(value[key]) }), {})
          : value
const sameMcpServers = (a, b) => JSON.stringify(canonical(listServers(a))) === JSON.stringify(canonical(listServers(b)))

/** The template's managed entries first, then the copy's own entries; the copy's old managed entries are dropped. */
function mergeManagedMcpServers(localServers, templateServers) {
    return [
        ...listServers(templateServers).filter(isManagedMcpServer),
        ...listServers(localServers).filter(server => !isManagedMcpServer(server)),
    ]
}

/** True when the template carries managed entries, or the copy still has some a template change removed. */
const hasManagedMcpServers = (...serverLists) =>
    serverLists.some(servers => listServers(servers).some(isManagedMcpServer))

/**
 * The template's MCP servers are one atomic value in the three-way merge, so a copy with a server of
 * its own would turn every change to the managed entry into a review conflict. Managed entries are
 * not the copy's to keep: they always follow the template, and the copy's own entries stay.
 * Takes and returns the merge's { patch, deleteFields, conflicts } with `mcpServers` decided this way.
 */
function resolveManagedMcpServers({ localServers, templateServers, patch, deleteFields, conflicts }) {
    if (!hasManagedMcpServers(templateServers, localServers)) return { patch, deleteFields, conflicts }
    const nextPatch = { ...patch }
    const merged = mergeManagedMcpServers(localServers, templateServers)
    if (sameMcpServers(merged, localServers)) delete nextPatch.mcpServers
    else nextPatch.mcpServers = merged
    return {
        patch: nextPatch,
        deleteFields: deleteFields.filter(field => field !== 'mcpServers'),
        conflicts: conflicts.filter(conflict => conflict.field !== 'mcpServers'),
    }
}

module.exports = {
    ALLDONE_TEAM_MANAGER,
    isManagedMcpServer,
    mergeManagedMcpServers,
    sameMcpServers,
    resolveManagedMcpServers,
}
