# Olive MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes Olive's note management capabilities to AI assistants like Claude.

## Features

### Tools (Actions)
- **create_note** - Create notes, tasks, reminders, or events
- **get_notes** - Retrieve notes with filters (category, completion, dates, search)
- **update_note** - Update existing notes
- **complete_note** - Mark tasks as completed
- **delete_note** - Remove notes
- **create_list** - Create custom lists/categories
- **get_lists** - Get all lists
- **set_reminder** - Set reminders with recurrence
- **get_reminders** - Get upcoming reminders
- **get_couple_info** - Get couple/partner information
- **assign_task** - Assign tasks to yourself or partner
- **brain_dump** - Process unstructured text into organized notes
- **get_summary** - Get daily/weekly/category summaries

### Resources (Read-only Data)
- `olive://notes/all` - All notes
- `olive://notes/pending` - Incomplete tasks
- `olive://notes/today` - Today's tasks
- `olive://lists` - All custom lists
- `olive://couple` - Couple information

### Prompts (Templates)
- **daily_planning** - Plan your day
- **weekly_review** - Review accomplishments and plan ahead
- **grocery_list** - Compile shopping list
- **couple_sync** - Coordinate with partner

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Configuration

### Environment Variables
```bash
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_KEY="your-service-key"
# OR
export SUPABASE_ANON_KEY="your-anon-key"
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "olive": {
      "command": "node",
      "args": ["/path/to/olive-native/practical-lichterman/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_SERVICE_KEY": "your-service-key"
      }
    }
  }
}
```

## Usage Examples

### With Claude Desktop

Once configured, you can ask Claude:

- "Add 'buy groceries' to my Olive list"
- "What tasks do I have due this week?"
- "Mark the milk task as complete"
- "Create a shopping list for the barbecue on Saturday"
- "What's my partner working on?"
- "Help me plan my day"

### Brain Dump Example

```
"Process this brain dump: need to call the dentist, buy a birthday gift for mom next week, finish the report by Friday, get dog food, schedule car maintenance"
```

Olive will automatically:
1. Categorize each item (appointments, gifts, work, pets, vehicles)
2. Extract due dates where mentioned
3. Create separate notes for each task

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Run
npm start
```

## Security

- The MCP server requires valid Supabase credentials
- Row-Level Security (RLS) policies in Supabase control data access
- User authentication is handled by the calling application

## Related

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic Claude](https://claude.ai/)
- [Olive App](https://witholive.app)
