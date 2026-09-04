'use strict'

// "Enrich profile" on a contact: research the person from public sources and fill in the card.
//
// This replaces the Apify LinkedIn scraper. LinkedIn profile pages cannot be read without a login,
// and what the scraper was really selling was proxies and sessions to get past that — every field
// the card actually uses (name, company, role, description, a photo) is also in search-engine
// snippets, company team pages, personal sites, GitHub and Gravatar, which are free and legitimate
// to read. So the work is done by the assistant runtime with `web_search`, `fetch_url`,
// `find_profile_photo` and a widened `update_contact`, inside the contact's own chat. That is also
// what makes "ask the user to confirm" free: the assistant posts its question in the thread and the
// user's reply reaches it through the ordinary chat path, which is why the contact is switched to
// assistant-enabled here.
//
// Billing is two lines in the Gold history on purpose: a flat `contact_enrichment` fee for the
// research tooling, then the ordinary metered `assistant_usage` of the run.

const admin = require('firebase-admin')

const CONTACT_ENRICHMENT_GOLD_COST = 10
const CONTACT_ENRICHMENT_SOURCE = 'contact_enrichment'
const CONTACT_ENRICHMENT_CHANNEL = 'contact'

// Exactly the tools the research needs. Passed explicitly because an assistant's persisted
// `allowedTools` predates the two new tools and would not carry them.
const CONTACT_ENRICHMENT_TOOLS = ['web_search', 'fetch_url', 'find_profile_photo', 'update_contact', 'get_contacts']

function cleanId(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function buildEnrichmentRequestText(contact = {}) {
    const name = cleanId(contact.displayName) || 'this contact'
    return `Enrich the profile of ${name}: research this person from public sources and fill in the missing details.`
}

function buildContactEnrichmentPrompt({ contact = {}, contactId, project = {}, projectId }) {
    const { describeContactForPrompt } = require('../shared/contactEnrichmentFields')
    const name = cleanId(contact.displayName) || 'this contact'
    const projectName = cleanId(project.name) || projectId

    return [
        `Research the contact "${name}" from public sources and complete their profile in Alldone.`,
        '',
        `Current profile (project "${projectName}", contactId "${contactId}"):`,
        describeContactForPrompt(contact),
        '',
        'How to work:',
        '1. Use web_search to find this person. Start from the name plus whatever narrows it down (company, email domain, role, city). Search for their LinkedIn profile ("<name> <company> LinkedIn" / site:linkedin.com/in), their company team or about page, a personal website, GitHub, conference or podcast bios. A LinkedIn search result is usable on its own: its title reads "Name - Role - Company | LinkedIn" and the snippet often carries the headline or the start of the About section.',
        '2. Use fetch_url to read pages that are likely about this person (company team page, personal site, GitHub profile, speaker profile). Never try to fetch linkedin.com pages; they cannot be read without a login, so rely on the search result title and snippet for LinkedIn.',
        '3. Use find_profile_photo with the email address, any GitHub username you found, and the URLs of pages about the person. Choose only an image that clearly shows this person, not a logo or a banner.',
        '4. Identity check before writing anything: a fact belongs to THIS person only if the name matches AND at least one corroborating detail matches (company, email domain, role, location, a link from a page you already trust). If two or more plausible people exist, or the evidence is thin, do NOT update the contact. Instead list the candidates with what you know about each, and ask the user which one is right. The user answers here in this chat, and then you continue.',
        `5. When you are confident, call update_contact once with contactId "${contactId}" and every field you established: displayName (fix capitalization only), company, role, linkedInUrl, description (a 2-4 sentence professional summary written in the user's language), phone and email only when published on an official page, and photoUrl with the best candidate.`,
        '6. Never overwrite a non-empty field with something vaguer or less specific. You may correct an obvious error and fill empty fields.',
        '7. Finish with a short summary: the fields you filled, the sources (URLs) you relied on, and what you could not find. If you had to ask a question, wait for the answer instead of guessing.',
    ].join('\n')
}

async function resolveEnrichmentAssistant({ projectId, userId, requestedAssistantId, contact, user }) {
    const { getAssistantForChat } = require('../Assistant/assistantHelper')
    const { getDefaultAssistantIdForProject } = require('../shared/projectRoutingCommentHelper')

    const candidates = [cleanId(requestedAssistantId), cleanId(contact?.assistantId)]
    for (const assistantId of candidates) {
        if (!assistantId) continue
        const assistant = await getAssistantForChat(projectId, assistantId, userId, { forceRefresh: true })
        if (assistant?.uid) return assistant
    }
    const defaultAssistantId = await getDefaultAssistantIdForProject(user || {}, projectId)
    if (!defaultAssistantId) return null
    const assistant = await getAssistantForChat(projectId, defaultAssistantId, userId, { forceRefresh: true })
    return assistant?.uid ? assistant : null
}

/**
 * Hosts one enrichment run. Must be called from a callable sized for a full assistant prompt run
 * (see assistantRunLimits.js) and after the per-request run lock has been taken.
 */
async function startContactProfileEnrichment({
    userId,
    projectId,
    contactId,
    assistantId: requestedAssistantId,
    requestId,
    functionEntryTime = null,
}) {
    const db = admin.firestore()
    const { deductGold, refundGold } = require('../Gold/goldHelper')
    const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
    const { ensureChatExists } = require('../Assistant/assistantStatusHelper')
    const { postUserRequestComment } = require('../Assistant/assistantHelper')
    const { generatePreConfigTaskResult } = require('../Assistant/assistantPreConfigTaskTopic')

    const cleanProjectId = cleanId(projectId)
    const cleanContactId = cleanId(contactId)
    if (!cleanProjectId || !cleanContactId) {
        throw new Error('projectId and contactId are required to enrich a contact.')
    }

    const [contactDoc, projectDoc, userDoc] = await db.getAll(
        db.doc(`projectsContacts/${cleanProjectId}/contacts/${cleanContactId}`),
        db.doc(`projects/${cleanProjectId}`),
        db.doc(`users/${userId}`)
    )
    if (!contactDoc.exists) {
        return { success: false, error: 'contact_not_found', message: 'The contact no longer exists.' }
    }
    const contact = { uid: contactDoc.id, ...contactDoc.data() }
    const project = projectDoc.exists ? { id: projectDoc.id, ...projectDoc.data() } : { id: cleanProjectId }
    const user = userDoc.exists ? { uid: userDoc.id, ...userDoc.data() } : { uid: userId }

    const assistant = await resolveEnrichmentAssistant({
        projectId: cleanProjectId,
        userId,
        requestedAssistantId,
        contact,
        user,
    })
    if (!assistant) {
        return {
            success: false,
            error: 'no_assistant',
            message: 'No assistant is available in this project to run the research.',
        }
    }

    const goldContext = {
        source: CONTACT_ENRICHMENT_SOURCE,
        projectId: cleanProjectId,
        objectId: cleanContactId,
        objectType: 'contacts',
        channel: CONTACT_ENRICHMENT_CHANNEL,
        note: `Profile research for ${cleanId(contact.displayName) || 'a contact'}`,
    }
    const goldResult = await deductGold(userId, CONTACT_ENRICHMENT_GOLD_COST, goldContext)
    if (!goldResult?.success) {
        return { success: false, error: 'insufficient_gold', message: goldResult?.message || 'Not enough Gold.' }
    }

    const isPublicFor =
        Array.isArray(contact.isPublicFor) && contact.isPublicFor.length > 0
            ? contact.isPublicFor
            : [FEED_PUBLIC_FOR_ALL, userId]

    try {
        await ensureChatExists(cleanProjectId, 'contacts', cleanContactId, assistant.uid, [userId], isPublicFor)
        // The follow-up ("which of these two is it?") arrives through the ordinary chat path, which
        // only calls the assistant when the parent object says so.
        await contactDoc.ref.set({ isAssistantEnabled: true }, { merge: true })

        const commentId = await postUserRequestComment({
            projectId: cleanProjectId,
            objectType: 'contacts',
            objectId: cleanContactId,
            creatorId: userId,
            text: buildEnrichmentRequestText(contact),
            commentId: cleanId(requestId),
        })

        const prompt = buildContactEnrichmentPrompt({
            contact,
            contactId: cleanContactId,
            project,
            projectId: cleanProjectId,
        })
        // `resolveAssistantReasoningEffort` treats a PRESENT key as an override, so the key is only
        // set when the assistant actually has a saved effort; otherwise its own default applies.
        const aiSettings = {
            model: assistant.model || 'MODEL_GPT5_6_SOL',
            temperature: assistant.temperature || 'TEMPERATURE_NORMAL',
            allowedTools: CONTACT_ENRICHMENT_TOOLS,
            ...(assistant.reasoningEffort ? { reasoningEffort: assistant.reasoningEffort } : {}),
        }

        const runResult = await generatePreConfigTaskResult(
            userId,
            cleanProjectId,
            cleanContactId,
            [userId],
            isPublicFor,
            assistant.uid,
            prompt,
            user.language || 'en',
            aiSettings,
            { name: `Contact enrichment: ${cleanId(contact.displayName) || cleanContactId}` },
            functionEntryTime,
            'contacts',
            // Unattended once started: the user is watching the chat, not retrying tool searches.
            // serverGrantedTools is what lets the run EXECUTE fetch_url/find_profile_photo: the
            // aiSettings list above only shows the model their schemas, while the execution gate
            // reads the assistant document, which predates both tools.
            { triggerMessageId: commentId, disableToolSearch: true, serverGrantedTools: CONTACT_ENRICHMENT_TOOLS }
        )

        return {
            success: true,
            projectId: cleanProjectId,
            contactId: cleanContactId,
            assistantId: assistant.uid,
            commentId,
            goldCharged: CONTACT_ENRICHMENT_GOLD_COST,
            resultCommentId: runResult?.commentId || null,
        }
    } catch (error) {
        // Nothing reached the thread yet or the run died before answering: give the fee back. The
        // metered assistant usage is charged only for an answer that was actually produced.
        try {
            await refundGold(userId, CONTACT_ENRICHMENT_GOLD_COST, {
                ...goldContext,
                note: `Refund: profile research failed (${error.message})`,
            })
        } catch (refundError) {
            console.error('[contactProfileEnrichment] refund failed', {
                userId,
                projectId: cleanProjectId,
                contactId: cleanContactId,
                error: refundError.message,
            })
        }
        throw error
    }
}

module.exports = {
    CONTACT_ENRICHMENT_CHANNEL,
    CONTACT_ENRICHMENT_GOLD_COST,
    CONTACT_ENRICHMENT_SOURCE,
    CONTACT_ENRICHMENT_TOOLS,
    buildContactEnrichmentPrompt,
    buildEnrichmentRequestText,
    startContactProfileEnrichment,
}
