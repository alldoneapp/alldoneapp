function buildNoteUrl(projectId, noteId, baseUrl) {
    const normalizedProjectId = typeof projectId === 'string' ? projectId.trim() : ''
    const normalizedNoteId = typeof noteId === 'string' ? noteId.trim() : ''
    const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : ''

    if (!normalizedProjectId || !normalizedNoteId || !normalizedBaseUrl) return ''

    return `${normalizedBaseUrl}/projects/${encodeURIComponent(normalizedProjectId)}/notes/${encodeURIComponent(
        normalizedNoteId
    )}/editor`
}

function normalizeCreatedNote(createdNote) {
    if (!createdNote || typeof createdNote !== 'object') return null
    if (createdNote.type && createdNote.type !== 'note') return null

    const noteId = String(createdNote.noteId || createdNote.id || '').trim()
    const url = String(createdNote.url || '').trim()
    if (!noteId || !url) return null

    return {
        type: 'note',
        id: noteId,
        noteId,
        projectId: String(createdNote.projectId || '').trim(),
        title: String(createdNote.title || createdNote.note?.extendedTitle || createdNote.note?.title || '').trim(),
        url,
    }
}

function replaceMatchingNoteUrls(text, noteId, canonicalUrl) {
    return text.replace(/https?:\/\/[^\s<>()\[\]{}]+/g, candidate => {
        try {
            const parsed = new URL(candidate)
            const pathSegments = parsed.pathname.split('/').filter(Boolean)
            return pathSegments.includes('notes') && pathSegments.includes(noteId) ? canonicalUrl : candidate
        } catch (_) {
            return candidate
        }
    })
}

function ensureCreatedNoteLinksInResponse(responseText, createdNotes = []) {
    let response = typeof responseText === 'string' ? responseText.trim() : ''
    const normalizedNotes = createdNotes.map(normalizeCreatedNote).filter(Boolean)
    const seenNoteIds = new Set()

    for (const createdNote of normalizedNotes) {
        if (seenNoteIds.has(createdNote.noteId)) continue
        seenNoteIds.add(createdNote.noteId)

        response = replaceMatchingNoteUrls(response, createdNote.noteId, createdNote.url)
        if (response.includes(createdNote.url)) continue

        const label = createdNote.title ? `Open “${createdNote.title}”:` : 'Open the note:'
        response = response ? `${response}\n\n${label} ${createdNote.url}` : `${label} ${createdNote.url}`
    }

    return response
}

module.exports = {
    buildNoteUrl,
    ensureCreatedNoteLinksInResponse,
    normalizeCreatedNote,
}
