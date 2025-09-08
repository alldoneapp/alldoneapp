# WhatsApp Integration Environment Setup

This document describes the environment variables required for the WhatsApp integration feature in Alldone.

## Required Environment Variables

The following environment variables need to be set in your Firebase Functions environment:

### Twilio Configuration

| Variable               | Description                   | Example Value                        | Required   |
| ---------------------- | ----------------------------- | ------------------------------------ | ---------- |
| `TWILIO_ACCOUNT_SID`   | Your Twilio Account SID       | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Yes        |
| `TWILIO_AUTH_TOKEN`    | Your Twilio Auth Token        | `your_auth_token_here`               | Yes        |
| `TWILIO_WHATSAPP_FROM` | Twilio WhatsApp sender number | `whatsapp:+14155238886`              | Optional\* |

\*If not provided, defaults to Twilio's sandbox number `whatsapp:+14155238886`

## Setup Instructions

### 1. Twilio Account Setup

1. Create a Twilio account at https://www.twilio.com
2. Navigate to the Console Dashboard
3. Copy your Account SID and Auth Token
4. Set up WhatsApp messaging:
    - For testing: Use Twilio's WhatsApp sandbox
    - For production: Apply for WhatsApp Business API approval

### 2. Firebase Environment Configuration

#### Using Firebase CLI:

```bash
firebase functions:config:set twilio.account_sid="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
firebase functions:config:set twilio.auth_token="your_auth_token_here"
firebase functions:config:set twilio.whatsapp_from="whatsapp:+14155238886"
```

#### Using CI/CD:

Set the following environment variables in your CI/CD pipeline:

-   `TWILIO_ACCOUNT_SID`
-   `TWILIO_AUTH_TOKEN`
-   `TWILIO_WHATSAPP_FROM`

### 3. WhatsApp Business API (Production)

For production use, you'll need to:

1. **Apply for WhatsApp Business API**: Contact Twilio to get approved
2. **Get a dedicated WhatsApp number**: Twilio will provide a business phone number
3. **Update environment**: Set `TWILIO_WHATSAPP_FROM` to your business number
4. **Phone number verification**: Users need to opt-in to receive WhatsApp messages

### 4. Testing Configuration

You can test the WhatsApp integration using the built-in test function:

```javascript
const TwilioWhatsAppService = require('./functions/Services/TwilioWhatsAppService')
const whatsappService = new TwilioWhatsAppService()

// Test configuration
const result = await whatsappService.testConfiguration('+1234567890')
console.log(result)
```

## Security Considerations

-   **Never commit** Twilio credentials to your repository
-   Use environment variables or secure secret management
-   **Auth Token** should be treated as a password
-   Consider using Twilio's IP allowlisting for additional security
-   Monitor your Twilio usage to detect unusual activity

## WhatsApp Sandbox Setup (Development)

For development and testing:

1. Go to Twilio Console > Messaging > Try WhatsApp
2. Follow the sandbox setup instructions
3. Add your test phone numbers to the sandbox
4. Users need to send "join <sandbox-code>" to the Twilio number

## Troubleshooting

### Common Issues:

1. **Authentication Errors**: Verify Account SID and Auth Token
2. **Phone Number Format**: Ensure numbers include country code (+1234567890)
3. **WhatsApp Opt-in**: Recipients must opt-in to receive messages
4. **Sandbox Limitations**: Sandbox has limited recipients and message templates

### Error Codes:

-   `21211`: Invalid 'To' phone number
-   `21408`: Permission to send an SMS/WhatsApp has not been enabled
-   `21610`: Attempt to send to unsubscribed recipient

## Message Limits

### Twilio WhatsApp Limits:

-   **Sandbox**: Limited to pre-approved phone numbers
-   **Production**: Based on your Twilio plan
-   **Message Length**: 1600 characters max
-   **Media**: Images, documents supported (additional charges apply)

## Cost Considerations

WhatsApp messaging through Twilio has the following costs:

-   **Outbound Messages**: ~\$0.005 per message (varies by country)
-   **Template Messages**: May have different pricing
-   **Media Messages**: Additional charges for images/documents

Monitor your Twilio usage dashboard to track costs.

## Support

-   **Twilio Documentation**: https://www.twilio.com/docs/whatsapp
-   **Twilio Support**: Available through Twilio Console
-   **WhatsApp Business API**: https://developers.facebook.com/docs/whatsapp
