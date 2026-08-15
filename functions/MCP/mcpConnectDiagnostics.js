const MIB = 1024 * 1024

const ALLOWED_PHASES = new Set([
    'sdk_load_start',
    'sdk_load_complete',
    'sdk_load_failed',
    'tools_list_start',
    'tools_list_complete',
    'tools_list_failed',
    'persistence_start',
    'persistence_complete',
    'persistence_failed',
])

const toMiB = bytes => Math.round((Number(bytes || 0) / MIB) * 10) / 10

function getMemorySnapshot() {
    const usage = process.memoryUsage()
    return {
        rssMiB: toMiB(usage.rss),
        heapUsedMiB: toMiB(usage.heapUsed),
        externalMiB: toMiB(usage.external),
        arrayBuffersMiB: toMiB(usage.arrayBuffers),
    }
}

/**
 * Emit an intentionally small, allowlisted diagnostic record. Never add server
 * config, identifiers, errors, or secrets here: SDK errors can contain endpoint
 * URLs and remote response data.
 */
function logMcpConnectPhase(phase, details = {}) {
    const diagnostic = {
        event: 'mcp_connect_phase',
        phase: ALLOWED_PHASES.has(phase) ? phase : 'unknown',
        ...getMemorySnapshot(),
    }

    if (Number.isFinite(details.durationMs)) {
        diagnostic.durationMs = Math.max(0, Math.round(details.durationMs))
    }
    if (Number.isFinite(details.toolCount)) {
        diagnostic.toolCount = Math.max(0, Math.round(details.toolCount))
    }
    console.info('MCP connection diagnostic', diagnostic)
    return diagnostic
}

module.exports = {
    logMcpConnectPhase,
    // exported for focused validation of the redaction boundary
    getMemorySnapshot,
}
