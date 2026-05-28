'use strict'

const {
    getConnectedGmailAccounts,
    getGmailAttachmentForAssistantRequest,
    getGmailClient,
    searchGmailForAssistantRequest,
} = require('../../Gmail/assistantGmailSearch')
const {
    createGmailDraftForAssistantRequest,
    createGmailReplyDraftForAssistantRequest,
    updateGmailDraftForAssistantRequest,
} = require('../../Gmail/assistantGmailDrafts')
const { updateGmailEmailForAssistantRequest } = require('../../Gmail/assistantGmailMutations')

module.exports = {
    createGmailDraftForAssistantRequest,
    createGmailReplyDraftForAssistantRequest,
    getConnectedGmailAccounts,
    getGmailAttachmentForAssistantRequest,
    getGmailClient,
    searchGmailForAssistantRequest,
    updateGmailDraftForAssistantRequest,
    updateGmailEmailForAssistantRequest,
}
