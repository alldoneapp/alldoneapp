'use strict'

// Security audit 2026-11 (NEW-A): a pre-configured assistant task of a project is member-editable,
// but a scheduled run of it acts AS the user who activated it: their Gold, their tools, their
// connected accounts. So an activation is bound to the content its user approved. This module
// decides what "the content" is and hashes it; it is pure and dependency-free on purpose, because
// the web app imports it too (the quick-action and link confirmations ask "has this user approved
// exactly this?"), and one implementation cannot drift from itself.
//
// The approved hashes live on the task document in `approvedContentHashByUser` and are written only
// by Cloud Functions (assistantTaskContentApproval.js); firestore.rules refuse any client write to
// them.

const APPROVED_CONTENT_HASH_FIELD = 'approvedContentHashByUser'
const CONTENT_APPROVAL_NOTICE_FIELD = 'contentApprovalNoticeByUser'
const SERVER_OWNED_ASSISTANT_TASK_FIELDS = [APPROVED_CONTENT_HASH_FIELD, CONTENT_APPROVAL_NOTICE_FIELD]
const GLOBAL_ASSISTANT_TASK_PROJECT_ID = 'globalProject'

// Everything that decides what a run does. Schedule fields (start time, recurrence) and display
// fields (name, order) are deliberately not part of it: changing when a task runs, or what it is
// called, does not change what it asks the assistant to do with the user's authority.
const textOrNull = value => (typeof value === 'string' ? value : value == null ? null : String(value))

function buildAssistantTaskContent(task = {}) {
    const model = typeof task.aiModelOverride === 'string' && task.aiModelOverride.trim() ? task.aiModelOverride : null
    return {
        type: textOrNull(task.type) || 'prompt',
        prompt: textOrNull(task.prompt) || '',
        aiSystemMessage: textOrNull(task.aiSystemMessage) || '',
        aiModelOverride: model,
        aiReasoningEffort: task.aiReasoningEffort == null ? null : task.aiReasoningEffort,
        executionMode: task.executionMode === 'workflow' ? 'workflow' : 'direct',
        link: textOrNull(task.link) || '',
        variables: Array.isArray(task.variables) ? task.variables : [],
        taskMetadata: task.taskMetadata && typeof task.taskMetadata === 'object' ? task.taskMetadata : {},
    }
}

// JSON with object keys sorted at every level and undefined members dropped, so the same content
// hashes the same whichever order a client or the Admin SDK wrote its keys in.
function canonicalize(value) {
    if (value === undefined) return undefined
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
        return JSON.stringify(value)
    }
    if (typeof value.toMillis === 'function') return JSON.stringify(value.toMillis())
    if (Array.isArray(value)) {
        return `[${value.map(item => (item === undefined ? 'null' : canonicalize(item))).join(',')}]`
    }
    const members = Object.keys(value)
        .sort()
        .filter(key => value[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    return `{${members.join(',')}}`
}

function utf8Bytes(text) {
    const bytes = []
    for (let index = 0; index < text.length; index += 1) {
        let code = text.charCodeAt(index)
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
            const next = text.charCodeAt(index + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
                index += 1
            }
        }
        if (code < 0x80) bytes.push(code)
        else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
        else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
        else
            bytes.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f)
            )
    }
    return bytes
}

const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
]

// FIPS 180-4 SHA-256 over a UTF-8 string, hex digest. Hand-written because the web bundle has no
// synchronous hash and this must give the same answer in the browser and in Node.
function sha256Hex(text) {
    const bytes = utf8Bytes(String(text))
    const bitLength = bytes.length * 8
    bytes.push(0x80)
    while (bytes.length % 64 !== 56) bytes.push(0)
    const high = Math.floor(bitLength / 0x100000000)
    const low = bitLength >>> 0
    bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff)
    bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff)

    const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    const w = new Array(64)
    const rotr = (value, shift) => (value >>> shift) | (value << (32 - shift))

    for (let offset = 0; offset < bytes.length; offset += 64) {
        for (let i = 0; i < 16; i += 1) {
            const j = offset + i * 4
            w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0
        }
        for (let i = 16; i < 64; i += 1) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
        }
        let [a, b, c, d, e, f, g, h] = hash
        for (let i = 0; i < 64; i += 1) {
            const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
            const ch = (e & f) ^ (~e & g)
            const t1 = (h + s1 + ch + K[i] + w[i]) >>> 0
            const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
            const maj = (a & b) ^ (a & c) ^ (b & c)
            const t2 = (s0 + maj) >>> 0
            h = g
            g = f
            f = e
            e = (d + t1) >>> 0
            d = c
            c = b
            b = a
            a = (t1 + t2) >>> 0
        }
        hash[0] = (hash[0] + a) >>> 0
        hash[1] = (hash[1] + b) >>> 0
        hash[2] = (hash[2] + c) >>> 0
        hash[3] = (hash[3] + d) >>> 0
        hash[4] = (hash[4] + e) >>> 0
        hash[5] = (hash[5] + f) >>> 0
        hash[6] = (hash[6] + g) >>> 0
        hash[7] = (hash[7] + h) >>> 0
    }
    return hash.map(value => value.toString(16).padStart(8, '0')).join('')
}

function computeAssistantTaskContentHash(task) {
    return sha256Hex(canonicalize(buildAssistantTaskContent(task)))
}

function getApprovedContentHash(task, userId) {
    const approvals = task && task[APPROVED_CONTENT_HASH_FIELD]
    if (!userId || !approvals || typeof approvals !== 'object') return null
    return typeof approvals[userId] === 'string' ? approvals[userId] : null
}

// The global catalog is curated: only the administrator may change what one of its tasks runs
// (firestore.rules), so its content is trusted as-is and needs no per-user approval.
const isGlobalAssistantTaskProject = projectId => projectId === GLOBAL_ASSISTANT_TASK_PROJECT_ID

function isAssistantTaskContentApprovedByUser(task, userId, taskProjectId) {
    if (isGlobalAssistantTaskProject(taskProjectId)) return true
    const approved = getApprovedContentHash(task, userId)
    return !!approved && approved === computeAssistantTaskContentHash(task)
}

module.exports = {
    APPROVED_CONTENT_HASH_FIELD,
    CONTENT_APPROVAL_NOTICE_FIELD,
    SERVER_OWNED_ASSISTANT_TASK_FIELDS,
    GLOBAL_ASSISTANT_TASK_PROJECT_ID,
    buildAssistantTaskContent,
    canonicalize,
    sha256Hex,
    computeAssistantTaskContentHash,
    getApprovedContentHash,
    isGlobalAssistantTaskProject,
    isAssistantTaskContentApprovedByUser,
}
