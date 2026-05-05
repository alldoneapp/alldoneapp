const { getToolSchemas, toolSchemas } = require('./toolSchemas')

describe('Calendar assistant tool schemas', () => {
    test('exposes all calendar tool schemas when allowed', () => {
        const schemas = getToolSchemas([
            'search_calendar_events',
            'create_calendar_event',
            'update_calendar_event',
            'delete_calendar_event',
        ])

        expect(schemas.map(schema => schema.function.name)).toEqual([
            'search_calendar_events',
            'create_calendar_event',
            'update_calendar_event',
            'delete_calendar_event',
        ])
    })

    test('defines required fields for calendar event writes', () => {
        expect(toolSchemas.create_calendar_event.function.parameters.required).toEqual(['summary', 'start', 'end'])
        expect(toolSchemas.update_calendar_event.function.parameters.required).toEqual(['eventId'])
        expect(toolSchemas.delete_calendar_event.function.parameters.required).toEqual(['eventId'])
    })
})

describe('Gmail assistant tool schemas', () => {
    test('exposes Gmail search, attachment, draft, and update tools when allowed', () => {
        const schemas = getToolSchemas([
            'search_gmail',
            'get_gmail_attachment',
            'create_gmail_reply_draft',
            'create_gmail_draft',
            'update_gmail_draft',
            'update_gmail_email',
        ])

        expect(schemas.map(schema => schema.function.name)).toEqual([
            'search_gmail',
            'get_gmail_attachment',
            'create_gmail_reply_draft',
            'create_gmail_draft',
            'update_gmail_draft',
            'update_gmail_email',
        ])
    })

    test('defines required fields for new Gmail drafts', () => {
        expect(toolSchemas.create_gmail_draft.function.parameters.required).toEqual(['to', 'subject', 'body'])
        expect(toolSchemas.create_gmail_reply_draft.function.parameters.required).toEqual([])
        expect(toolSchemas.update_gmail_draft.function.parameters.required).toEqual(['draftId'])
        expect(toolSchemas.update_gmail_email.function.parameters.required).toEqual(['messageId'])
        expect(toolSchemas.create_gmail_draft.function.parameters.properties.attachments.items.required).toEqual([
            'fileName',
            'base64',
        ])
        expect(toolSchemas.update_gmail_draft.function.parameters.properties.removeAttachmentFileNames).toBeDefined()
        expect(toolSchemas.update_gmail_draft.function.parameters.properties.replaceAttachments.type).toBe('boolean')
    })

    test('defines required fields for Gmail attachment fetch', () => {
        expect(toolSchemas.get_gmail_attachment.function.parameters.required).toEqual(['messageId', 'fileName'])
        expect(toolSchemas.get_chat_attachment.function.parameters.required).toEqual([])
    })
})

describe('User memory assistant tool schemas', () => {
    test('exposes update_user_memory only when allowed', () => {
        expect(getToolSchemas(['update_user_memory']).map(schema => schema.function.name)).toEqual([
            'update_user_memory',
        ])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('exposes update_heartbeat_settings only when allowed', () => {
        expect(getToolSchemas(['update_heartbeat_settings']).map(schema => schema.function.name)).toEqual([
            'update_heartbeat_settings',
        ])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('exposes update_project_description only when allowed', () => {
        expect(getToolSchemas(['update_project_description']).map(schema => schema.function.name)).toEqual([
            'update_project_description',
        ])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('exposes update_user_description only when allowed', () => {
        expect(getToolSchemas(['update_user_description']).map(schema => schema.function.name)).toEqual([
            'update_user_description',
        ])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('exposes update_assistant_settings only when allowed', () => {
        expect(getToolSchemas(['update_assistant_settings']).map(schema => schema.function.name)).toEqual([
            'update_assistant_settings',
        ])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('exposes compact_thread_context only when allowed', () => {
        expect(getToolSchemas(['compact_thread_context']).map(schema => schema.function.name)).toEqual([
            'compact_thread_context',
        ])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('defines required fields for update_user_memory', () => {
        expect(toolSchemas.update_user_memory.function.parameters.required).toEqual(['fact'])
        expect(toolSchemas.update_user_memory.function.parameters.properties.category.type).toBe('string')
        expect(toolSchemas.update_user_memory.function.parameters.properties.reason.type).toBe('string')
    })

    test('defines optional image URLs for create_task', () => {
        expect(toolSchemas.create_task.function.parameters.properties.images).toEqual({
            type: 'array',
            items: {
                type: 'string',
            },
            description:
                'Optional: image URLs to embed in the task description. Use exact URLs from the current user message when the task should include attached images.',
        })
    })

    test('documents heartbeat settings update fields', () => {
        expect(toolSchemas.update_heartbeat_settings.function.parameters.required).toEqual([])
        expect(toolSchemas.update_heartbeat_settings.function.parameters.properties.intervalMinutes.type).toBe('number')
        expect(toolSchemas.update_heartbeat_settings.function.parameters.properties.chancePercent.type).toBe('number')
        expect(toolSchemas.update_heartbeat_settings.function.parameters.properties.awakeStartTime.type).toBe('string')
        expect(toolSchemas.update_heartbeat_settings.function.parameters.properties.awakeEndTime.type).toBe('string')
        expect(toolSchemas.update_heartbeat_settings.function.parameters.properties.sendWhatsApp.type).toBe('boolean')
        expect(toolSchemas.update_heartbeat_settings.function.parameters.properties.prompt.type).toBe('string')
    })

    test('documents project description update fields', () => {
        expect(toolSchemas.update_project_description.function.parameters.required).toEqual(['description'])
        expect(toolSchemas.update_project_description.function.description).toContain('shared context')
        expect(toolSchemas.update_project_description.function.parameters.properties.description.type).toBe('string')
        expect(toolSchemas.update_project_description.function.parameters.properties.projectId.type).toBe('string')
        expect(toolSchemas.update_project_description.function.parameters.properties.projectName.type).toBe('string')
    })

    test('documents user description update fields', () => {
        expect(toolSchemas.update_user_description.function.parameters.required).toEqual(['description'])
        expect(toolSchemas.update_user_description.function.description).toContain('global settings description')
        expect(toolSchemas.update_user_description.function.description).toContain('added on top')
        expect(toolSchemas.update_user_description.function.description).not.toContain('syncs it across')
        expect(toolSchemas.update_user_description.function.parameters.properties.description.type).toBe('string')
        expect(toolSchemas.update_user_description.function.parameters.properties.projectId.type).toBe('string')
        expect(toolSchemas.update_user_description.function.parameters.properties.projectName.type).toBe('string')
    })

    test('documents assistant settings update fields', () => {
        expect(toolSchemas.update_assistant_settings.function.parameters.required).toEqual([])
        expect(toolSchemas.update_assistant_settings.function.description).toContain('instructions')
        expect(toolSchemas.update_assistant_settings.function.description).toContain('instructionsHistory')
        expect(toolSchemas.update_assistant_settings.function.description).toContain('latest 10')
        expect(toolSchemas.update_assistant_settings.function.description).toContain('allowedTools')
        const properties = toolSchemas.update_assistant_settings.function.parameters.properties
        expect(properties.instructions.type).toBe('string')
        expect(properties.displayName.type).toBe('string')
        expect(properties.description.type).toBe('string')
        expect(properties.delegationToolDescriptionManual.type).toBe('string')
        expect(properties.assistantId.type).toBe('string')
        expect(properties.assistantName.type).toBe('string')
        expect(properties.projectId.type).toBe('string')
        expect(properties.model.enum).toContain('MODEL_GPT5_5')
        expect(properties.temperature.enum).toContain('TEMPERATURE_NORMAL')
        expect(Object.keys(properties)).not.toContain('allowedTools')
        expect(Object.keys(properties)).not.toContain('isDefault')
    })

    test('documents heartbeat prompt versioning', () => {
        expect(toolSchemas.update_heartbeat_settings.function.description).toContain('heartbeatPromptHistory')
        expect(toolSchemas.update_heartbeat_settings.function.description).toContain('latest 10')
        expect(toolSchemas.update_heartbeat_settings.function.parameters.properties.prompt.description).toContain(
            'heartbeatPromptHistory'
        )
    })

    test('documents compact thread context fields', () => {
        expect(toolSchemas.compact_thread_context.function.parameters.required).toEqual([
            'summary',
            'progressCompleted',
            'progressTotal',
        ])
        expect(toolSchemas.compact_thread_context.function.description).toContain('long-running')
        expect(toolSchemas.compact_thread_context.function.parameters.properties.summary.type).toBe('string')
        expect(toolSchemas.compact_thread_context.function.parameters.properties.progressCompleted.type).toBe('integer')
        expect(toolSchemas.compact_thread_context.function.parameters.properties.progressTotal.type).toBe('integer')
        expect(toolSchemas.compact_thread_context.function.parameters.properties.currentProjectId.type).toBe('string')
        expect(toolSchemas.compact_thread_context.function.parameters.properties.currentProjectName.type).toBe('string')
        expect(toolSchemas.compact_thread_context.function.parameters.properties.nextProjectId.type).toBe('string')
        expect(toolSchemas.compact_thread_context.function.parameters.properties.nextProjectName.type).toBe('string')
    })
})

describe('Get tasks assistant tool schema', () => {
    test('documents hour-based recency filters for done tasks', () => {
        expect(toolSchemas.get_tasks.function.parameters.properties.recentHours).toEqual({
            type: 'number',
            description:
                'Optional: for done tasks only, return tasks completed within the last N hours. Use this for questions like "what did I finish in the last 2 hours?". When this is provided, prefer it over a day-based date filter.',
        })

        expect(toolSchemas.get_tasks.function.description).toContain('recentHours')
        expect(toolSchemas.get_tasks.function.description).toContain('completedAt')
    })

    test('documents date-filter behavior for status all', () => {
        expect(toolSchemas.get_tasks.function.parameters.properties.status.description).toContain(
            'status "all" returns open tasks filtered by due date plus done tasks filtered by completion date'
        )
    })
})

describe('Get chats assistant tool schema', () => {
    test('exposes get_chats only when allowed', () => {
        expect(getToolSchemas(['get_chats']).map(schema => schema.function.name)).toEqual(['get_chats'])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('documents chat type, date, limit, and project filters', () => {
        expect(toolSchemas.get_chats.function.parameters.properties.types).toEqual({
            type: 'array',
            items: {
                type: 'string',
                enum: ['topics', 'tasks', 'notes', 'contacts', 'goals', 'skills', 'assistants'],
            },
            description:
                'Optional: chat types to include. Defaults to ["topics"]. Use this to include task chats or other object chat types.',
        })

        expect(toolSchemas.get_chats.function.parameters.properties.date.type).toBe('string')
        expect(toolSchemas.get_chats.function.parameters.properties.limit.type).toBe('number')
        expect(toolSchemas.get_chats.function.parameters.properties.projectId.type).toBe('string')
        expect(toolSchemas.get_chats.function.parameters.properties.projectName.type).toBe('string')
        expect(toolSchemas.get_chats.function.description).toContain('topic chats only')
    })
})

describe('Get updates assistant tool schema', () => {
    test('exposes get_updates only when allowed', () => {
        expect(getToolSchemas(['get_updates']).map(schema => schema.function.name)).toEqual(['get_updates'])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('documents update timeframe, scope, object type, and limit filters', () => {
        const properties = toolSchemas.get_updates.function.parameters.properties

        expect(properties.date.type).toBe('string')
        expect(properties.recentHours.type).toBe('number')
        expect(properties.projectId.type).toBe('string')
        expect(properties.projectName.type).toBe('string')
        expect(properties.allProjects.type).toBe('boolean')
        expect(properties.includeArchived.type).toBe('boolean')
        expect(properties.includeCommunity.type).toBe('boolean')
        expect(properties.limit.type).toBe('number')
        expect(properties.objectTypes).toEqual({
            type: 'array',
            items: {
                type: 'string',
                enum: ['tasks', 'notes', 'goals', 'contacts', 'projects', 'users', 'skills', 'assistants'],
            },
            description:
                'Optional: object types to include in the update feed. Unknown event types are still returned without object title enrichment.',
        })
        expect(toolSchemas.get_updates.function.description).toContain('activity feed')
        expect(toolSchemas.get_updates.function.description).toContain('use get_chats')
    })
})

describe('Get contacts assistant tool schema', () => {
    test('exposes get_contacts only when allowed', () => {
        expect(getToolSchemas(['get_contacts']).map(schema => schema.function.name)).toEqual(['get_contacts'])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('documents project, date, and limit filters with cross-project default', () => {
        expect(toolSchemas.get_contacts.function.parameters.properties.projectId.type).toBe('string')
        expect(toolSchemas.get_contacts.function.parameters.properties.projectName.type).toBe('string')
        expect(toolSchemas.get_contacts.function.parameters.properties.date.type).toBe('string')
        expect(toolSchemas.get_contacts.function.parameters.properties.limit.type).toBe('number')
        expect(toolSchemas.get_contacts.function.description).toContain('across all accessible active projects')
        expect(toolSchemas.get_contacts.function.description).toContain('last edit time')
    })
})

describe('Get goals assistant tool schema', () => {
    test('exposes get_goals only when allowed', () => {
        expect(getToolSchemas(['get_goals']).map(schema => schema.function.name)).toEqual(['get_goals'])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('documents goal status, project scope, and milestone filters', () => {
        expect(toolSchemas.get_goals.function.parameters.properties.status).toEqual({
            type: 'string',
            enum: ['active', 'done', 'all'],
            description:
                'Filter goals by status. Defaults to "active". Use "all" to return one goal-centric result list that merges active and done metadata.',
        })

        expect(toolSchemas.get_goals.function.parameters.properties.allProjects.type).toBe('boolean')
        expect(toolSchemas.get_goals.function.parameters.properties.projectId.type).toBe('string')
        expect(toolSchemas.get_goals.function.parameters.properties.projectName.type).toBe('string')
        expect(toolSchemas.get_goals.function.parameters.properties.currentMilestoneOnly.type).toBe('boolean')
        expect(toolSchemas.get_goals.function.parameters.properties.limit.type).toBe('number')
        expect(toolSchemas.get_goals.function.description).toContain('active goals across all projects')
        expect(toolSchemas.get_goals.function.description).toContain('currentMilestoneOnly')
    })
})

describe('Update note assistant tool schema', () => {
    test('supports contact-targeted note updates', () => {
        expect(toolSchemas.update_note.function.parameters.properties.contactId.type).toBe('string')
        expect(toolSchemas.update_note.function.parameters.properties.contactName.type).toBe('string')
        expect(toolSchemas.update_note.function.parameters.properties.contactEmail.type).toBe('string')
        expect(toolSchemas.update_note.function.parameters.properties.createIfMissing.type).toBe('boolean')
    })

    test('supports safe patch mode note updates', () => {
        const properties = toolSchemas.update_note.function.parameters.properties

        expect(properties.mode.enum).toEqual(['prepend', 'patch'])
        expect(properties.edits.type).toBe('array')
        expect(properties.edits.items.properties.type.enum).toEqual([
            'replace_text',
            'replace_section',
            'insert_before',
            'insert_after',
        ])
        expect(properties.edits.items.properties.occurrence.type).toBe('number')
    })
})

describe('Update contact assistant tool schema', () => {
    test('supports contact-targeted updates with email writes', () => {
        expect(toolSchemas.update_contact.function.parameters.required).toEqual(['email'])
        expect(toolSchemas.update_contact.function.parameters.properties.contactId.type).toBe('string')
        expect(toolSchemas.update_contact.function.parameters.properties.contactName.type).toBe('string')
        expect(toolSchemas.update_contact.function.parameters.properties.contactEmail.type).toBe('string')
        expect(toolSchemas.update_contact.function.parameters.properties.email.type).toBe('string')
    })
})
