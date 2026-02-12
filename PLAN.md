# WhatsApp Message Templates — Implementation Plan

## Problem
Meta WhatsApp Business requires **pre-approved message templates** for any business-initiated messages outside the 24-hour customer service window. Currently, ALL outbound messages (reminders, daily briefings, nudges) are sent as free-form `type: 'text'`, which will **fail silently** if the user hasn't messaged Olive in the last 24 hours.

## Meta's Rules
1. **User messages first** → 24h window opens → business can send free-form text
2. **Outside 24h window** → MUST use pre-approved templates (UTILITY category)
3. **Template message** → opens a NEW 24h window → Olive can follow up with free-form text
4. Templates need variables like `{{1}}` for dynamic content

## Architecture Changes

### Step 1: Track 24h Window
- Add `last_user_message_at` column to `clerk_profiles` table
- Update `whatsapp-webhook/index.ts` to set this timestamp on every inbound message
- Gateway checks: `now - last_user_message_at < 24h` → free-form text OK, else → use template

### Step 2: Create Message Templates in Meta Business Manager
You need to create these templates in Meta Business Manager (WhatsApp Manager → Message Templates → Create Template):

**Template 1: `olive_daily_summary`** (UTILITY)
```
Header: None
Body: "Good morning, {{1}}! Here's your daily summary:\n\n{{2}}\n\nReply to chat with Olive about your day."
Footer: "Olive — Your AI Assistant"
```

**Template 2: `olive_task_reminder`** (UTILITY)
```
Header: None
Body: "⏰ Reminder: {{1}}\n\n{{2}}\n\nReply 'done' to mark complete or 'snooze' for later."
Footer: "Olive — Your AI Assistant"
```

**Template 3: `olive_evening_review`** (UTILITY)
```
Header: None
Body: "Good evening, {{1}}! Here's your day recap:\n\n{{2}}\n\nReply to tell Olive about tomorrow's plans."
Footer: "Olive — Your AI Assistant"
```

**Template 4: `olive_weekly_summary`** (UTILITY)
```
Header: None
Body: "📊 Weekly summary for {{1}}:\n\n{{2}}\n\nReply to chat about your week ahead."
Footer: "Olive — Your AI Assistant"
```

**Template 5: `olive_welcome`** (UTILITY)
```
Header: None
Body: "Hey {{1}}, it's Olive here! 🫒 How can I help you? You can send me tasks, reminders, or just chat — I'm here to help you stay organized!\n\nReply to start chatting."
Footer: "Olive — Your AI Assistant"
```

**Template 6: `olive_overdue_alert`** (UTILITY)
```
Header: None
Body: "Hey {{1}}, you have {{2}} overdue task(s):\n\n{{3}}\n\nReply to update their status."
Footer: "Olive — Your AI Assistant"
```

### Step 3: Update `whatsapp-gateway/index.ts`
- Add `sendMetaTemplateMessage()` function that sends `type: 'template'` payloads
- Add `isWithin24hWindow()` function that checks `clerk_profiles.last_user_message_at`
- Add template name mapping: `message_type → template_name`
- Modify `sendMessage()`: check window → if inside, send text; if outside, send template
- The template message content is truncated to fit Meta's 1024-char body limit

### Step 4: Update `send-reminders/index.ts`
- Import the same window-check + template-send logic
- Use `olive_task_reminder` template when outside 24h window

### Step 5: Update `whatsapp-webhook/index.ts`
- After authenticating the user (finding their profile by phone number), update `last_user_message_at`

### Step 6: Update test message
- Use `olive_welcome` template when outside 24h window
- Keep current free-form text when inside window

## Files to Modify
1. `supabase/functions/whatsapp-gateway/index.ts` — Add template sending + window check
2. `supabase/functions/send-reminders/index.ts` — Use templates when outside window
3. `supabase/functions/whatsapp-webhook/index.ts` — Track `last_user_message_at`
4. New migration for `last_user_message_at` column on `clerk_profiles`

## Files NOT Modified (no client changes needed)
- No React component changes needed
- No translation changes needed
- Templates are created in Meta Business Manager UI, not in code
