/**
 * Minimal ZIP reader for the "add a skill from a file" flow (AT-2431).
 *
 * Deliberately dependency-free. A skill bundle is a handful of small text files,
 * and the two things a reader needs — walking the central directory and raw
 * DEFLATE — are both available already: the format is a fixed-layout binary
 * header, and every browser this app supports (and Node 22, for jest) ships
 * `DecompressionStream('deflate-raw')`. Pulling in a zip library to save ~120
 * lines would mean a new runtime dependency in the web bundle plus a CI image
 * rebuild (see CLAUDE.md on lockfile-changing branches), which is a poor trade.
 *
 * Only what a skill bundle actually needs is supported: stored (method 0) and
 * deflated (method 8) entries in a single-disk, non-zip64, unencrypted archive.
 * Everything else fails loudly with a typed error rather than silently
 * returning a partial file list — a skill that quietly lost its scripts would
 * mount into the VM broken.
 */

export const ZIP_ENTRY_LIMIT = 500

// Decompression bounds. An uploaded archive is arbitrary input, and a DEFLATE
// stream can expand by ~1000x — a few-kilobyte "zip bomb" would otherwise
// inflate until the admin's tab runs out of memory, which is a hang rather than
// an error message. Both the DECLARED size in the directory and the bytes
// actually produced are checked, because the declared one is attacker-supplied.
// Set generously above the skill caps in skillDraftFromSource so it is a
// backstop, not the rule that rejects an over-large but honest bundle.
export const MAX_ENTRY_INFLATED_BYTES = 25 * 1024 * 1024
export const MAX_ARCHIVE_INFLATED_BYTES = 50 * 1024 * 1024

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_FILE_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50

const EOCD_MIN_SIZE = 22
const CENTRAL_FILE_HEADER_SIZE = 46
const LOCAL_FILE_HEADER_SIZE = 30
const MAX_ZIP_COMMENT_SIZE = 0xffff

const METHOD_STORED = 0
const METHOD_DEFLATE = 8

const FLAG_ENCRYPTED = 0x0001

export class SkillArchiveError extends Error {
    constructor(code, params = {}) {
        super(code)
        this.name = 'SkillArchiveError'
        this.code = code
        this.params = params
    }
}

const decodeText = bytes => new TextDecoder('utf-8').decode(bytes)

function findEndOfCentralDirectory(view, byteLength) {
    const scanStart = Math.max(0, byteLength - (EOCD_MIN_SIZE + MAX_ZIP_COMMENT_SIZE))
    for (let offset = byteLength - EOCD_MIN_SIZE; offset >= scanStart; offset--) {
        if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset
    }
    return -1
}

/**
 * Inflate raw DEFLATE bytes through the platform's own decompressor.
 *
 * Written against the bare stream primitives rather than `new Response(blob.stream())`
 * on purpose: jsdom (jest) implements `DecompressionStream` via node:stream/web but
 * not necessarily `Blob.prototype.stream`, and the test environment has to exercise
 * the real code path for this module to be worth anything.
 */
async function inflateRaw(bytes, limit) {
    let decompressor
    try {
        // `deflate-raw` is the format ZIP actually stores; a browser old enough
        // to have DecompressionStream without it throws from the constructor.
        // Both cases are a platform gap, never a problem with the file — saying
        // "re-create the archive" here would send the admin somewhere useless.
        decompressor = new DecompressionStream('deflate-raw')
    } catch (error) {
        throw new SkillArchiveError('archiveUnsupportedBrowser')
    }

    const writer = decompressor.writable.getWriter()
    // Not awaited before reading: a chunk larger than the stream's highWaterMark
    // parks the write until the reader drains it, so awaiting here would deadlock.
    const writeDone = writer
        .write(bytes)
        .then(() => writer.close())
        .catch(() => {})

    const reader = decompressor.readable.getReader()
    const chunks = []
    let total = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        total += value.length
        // Checked as the bytes arrive, not afterwards: a bomb never finishes,
        // so waiting for `done` is waiting forever. Note `limit` is compared
        // directly rather than guarded with `limit &&` — a budget of exactly 0
        // is the tightest limit there is, and treating it as "no limit" is how
        // a bomb placed after two legal-but-maximal entries got through.
        if (total > limit) {
            await reader.cancel().catch(() => {})
            throw new SkillArchiveError('archiveTooLarge', { limit: Math.round(limit / (1024 * 1024)) })
        }
    }
    await writeDone

    const output = new Uint8Array(total)
    let cursor = 0
    for (const chunk of chunks) {
        output.set(chunk, cursor)
        cursor += chunk.length
    }
    return output
}

function readCentralDirectory(bytes, view) {
    const eocdOffset = findEndOfCentralDirectory(view, bytes.length)
    if (eocdOffset < 0) throw new SkillArchiveError('invalidArchive')

    const entryCount = view.getUint16(eocdOffset + 10, true)
    const directorySize = view.getUint32(eocdOffset + 12, true)
    const directoryOffset = view.getUint32(eocdOffset + 16, true)

    // zip64 parks these at their sentinel values and keeps the real numbers in a
    // separate record. A skill bundle never needs it, so refuse rather than
    // mis-read the placeholder as a real offset.
    if (entryCount === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
        throw new SkillArchiveError('archiveUnsupported')
    }
    if (directoryOffset + directorySize > bytes.length) throw new SkillArchiveError('invalidArchive')
    if (entryCount > ZIP_ENTRY_LIMIT) throw new SkillArchiveError('tooManyArchiveEntries', { limit: ZIP_ENTRY_LIMIT })

    const headers = []
    let offset = directoryOffset
    for (let index = 0; index < entryCount; index++) {
        if (offset + CENTRAL_FILE_HEADER_SIZE > bytes.length) throw new SkillArchiveError('invalidArchive')
        if (view.getUint32(offset, true) !== CENTRAL_FILE_SIGNATURE) throw new SkillArchiveError('invalidArchive')

        const flags = view.getUint16(offset + 8, true)
        const method = view.getUint16(offset + 10, true)
        const compressedSize = view.getUint32(offset + 20, true)
        const uncompressedSize = view.getUint32(offset + 24, true)
        const nameLength = view.getUint16(offset + 28, true)
        const extraLength = view.getUint16(offset + 30, true)
        const commentLength = view.getUint16(offset + 32, true)
        const localHeaderOffset = view.getUint32(offset + 42, true)

        const nameStart = offset + CENTRAL_FILE_HEADER_SIZE
        if (nameStart + nameLength > bytes.length) throw new SkillArchiveError('invalidArchive')
        const path = decodeText(bytes.subarray(nameStart, nameStart + nameLength))

        headers.push({ path, flags, method, compressedSize, uncompressedSize, localHeaderOffset })
        offset = nameStart + nameLength + extraLength + commentLength
    }
    return headers
}

async function readEntryBytes(bytes, view, header, remainingBudget) {
    if (header.flags & FLAG_ENCRYPTED) throw new SkillArchiveError('archiveEncrypted')
    if (header.uncompressedSize > MAX_ENTRY_INFLATED_BYTES) {
        throw new SkillArchiveError('archiveTooLarge', {
            limit: Math.round(MAX_ENTRY_INFLATED_BYTES / (1024 * 1024)),
        })
    }

    const localOffset = header.localHeaderOffset
    if (localOffset + LOCAL_FILE_HEADER_SIZE > bytes.length) throw new SkillArchiveError('invalidArchive')
    if (view.getUint32(localOffset, true) !== LOCAL_FILE_SIGNATURE) throw new SkillArchiveError('invalidArchive')

    // The local header's own name/extra lengths are read here rather than reused
    // from the central directory: writers are allowed to differ (extra fields
    // routinely do), and using the wrong one lands the data offset mid-file.
    const nameLength = view.getUint16(localOffset + 26, true)
    const extraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + LOCAL_FILE_HEADER_SIZE + nameLength + extraLength
    const dataEnd = dataStart + header.compressedSize
    if (dataEnd > bytes.length) throw new SkillArchiveError('invalidArchive')

    const budget = Math.min(MAX_ENTRY_INFLATED_BYTES, remainingBudget)
    const raw = bytes.subarray(dataStart, dataEnd)
    if (header.method === METHOD_STORED) {
        if (raw.length > budget) {
            throw new SkillArchiveError('archiveTooLarge', {
                limit: Math.round(MAX_ARCHIVE_INFLATED_BYTES / (1024 * 1024)),
            })
        }
        return raw.slice()
    }
    if (header.method === METHOD_DEFLATE) return await inflateRaw(raw, budget)
    throw new SkillArchiveError('archiveUnsupported')
}

// Directory entries, macOS resource forks and editor droppings are noise in
// every real-world skill zip — dropping them here keeps the bundle caps honest.
function isIgnorableEntry(path) {
    if (!path || path.endsWith('/')) return true
    if (path.startsWith('__MACOSX/') || path.includes('/__MACOSX/')) return true
    const fileName = path.slice(path.lastIndexOf('/') + 1)
    return fileName === '.DS_Store' || fileName === 'Thumbs.db' || fileName.startsWith('._')
}

/**
 * Read every usable file out of a ZIP archive.
 *
 * @param {ArrayBuffer|Uint8Array} archive
 * @returns {Promise<Array<{ path: string, bytes: Uint8Array, size: number }>>}
 */
export async function readSkillArchiveEntries(archive) {
    const bytes = archive instanceof Uint8Array ? archive : new Uint8Array(archive)
    if (bytes.length < EOCD_MIN_SIZE) throw new SkillArchiveError('invalidArchive')

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const headers = readCentralDirectory(bytes, view)

    const entries = []
    let inflatedBytes = 0
    for (const header of headers) {
        const path = header.path.replace(/\\/g, '/')
        if (isIgnorableEntry(path)) continue
        // A name that did not survive UTF-8 decoding (a legacy CP437 archive
        // from Windows Explorer, say) would be stored — and later mounted into
        // the sandbox — with its non-ASCII characters replaced, while the
        // SKILL.md referencing it still spells them correctly. That is a skill
        // that is quietly broken, so refuse it by name instead.
        if (path.includes('\uFFFD')) throw new SkillArchiveError('archiveFileNameUnsupported', { path })

        const remainingBudget = MAX_ARCHIVE_INFLATED_BYTES - inflatedBytes
        if (remainingBudget <= 0) {
            throw new SkillArchiveError('archiveTooLarge', {
                limit: Math.round(MAX_ARCHIVE_INFLATED_BYTES / (1024 * 1024)),
            })
        }
        const content = await readEntryBytes(bytes, view, header, remainingBudget)
        inflatedBytes += content.length
        entries.push({ path, bytes: content, size: content.length })
    }
    return entries
}
