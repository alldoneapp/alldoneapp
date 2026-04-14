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
        expect(toolSchemas.update_project_description.function.parameters.properties.description.type).toBe('string')
        expect(toolSchemas.update_project_description.function.parameters.properties.projectId.type).toBe('string')
        expect(toolSchemas.update_project_description.function.parameters.properties.projectName.type).toBe('string')
    })

    test('documents user description update fields', () => {
        expect(toolSchemas.update_user_description.function.parameters.required).toEqual(['description'])
        expect(toolSchemas.update_user_description.function.parameters.properties.description.type).toBe('string')
        expect(toolSchemas.update_user_description.function.parameters.properties.projectId.type).toBe('string')
        expect(toolSchemas.update_user_description.function.parameters.properties.projectName.type).toBe('string')
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

describe('Update note assistant tool schema', () => {
    test('supports contact-targeted note updates', () => {
        expect(toolSchemas.update_note.function.parameters.properties.contactId.type).toBe('string')
        expect(toolSchemas.update_note.function.parameters.properties.contactName.type).toBe('string')
        expect(toolSchemas.update_note.function.parameters.properties.contactEmail.type).toBe('string')
        expect(toolSchemas.update_note.function.parameters.properties.createIfMissing.type).toBe('boolean')
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
