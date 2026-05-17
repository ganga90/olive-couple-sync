#!/usr/bin/env node
/**
 * Olive MCP Server
 *
 * A Model Context Protocol server that exposes Olive's note management
 * capabilities to AI assistants like Claude.
 *
 * Features:
 * - Create, read, update, delete notes
 * - Manage lists and categories
 * - Handle reminders
 * - Couple collaboration features
 * - Calendar integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Type definitions
interface Note {
  id: string;
  original_text: string;
  summary?: string;
  category: string;
  due_date?: string;
  priority?: 'low' | 'medium' | 'high';
  completed?: boolean;
  tags?: string[];
  couple_id?: string;
  author_id: string;
  created_at: string;
  updated_at: string;
}

interface List {
  id: string;
  name: string;
  description?: string;
  couple_id?: string;
  created_by: string;
  created_at: string;
}

// Initialize Supabase client
let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY environment variables');
    }

    supabase = createClient(url, key);
  }
  return supabase;
}

// Create server instance
const server = new Server(
  {
    name: 'olive-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// ============================================
// TOOLS - Actions the AI can perform
// ============================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Note Management
      {
        name: 'create_note',
        description: 'Create a new note in Olive. Can be a task, reminder, event, or general note.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'The note content (can be natural language - Olive will process it)',
            },
            category: {
              type: 'string',
              description: 'Category: groceries, household, travel, health, finance, work, family, gifts, entertainment, meals, shopping, personal, pets, home_improvement, vehicles, education, fitness, appointments, other',
              enum: ['groceries', 'household', 'travel', 'health', 'finance', 'work', 'family', 'gifts', 'entertainment', 'meals', 'shopping', 'personal', 'pets', 'home_improvement', 'vehicles', 'education', 'fitness', 'appointments', 'other'],
            },
            due_date: {
              type: 'string',
              description: 'Optional due date in ISO format (YYYY-MM-DD)',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Priority level',
            },
            list_id: {
              type: 'string',
              description: 'Optional list ID to add note to',
            },
            is_shared: {
              type: 'boolean',
              description: 'Whether to share with partner (default: true if in a couple)',
            },
          },
          required: ['text'],
        },
      },
      {
        name: 'get_notes',
        description: 'Retrieve notes from Olive with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Filter by category',
            },
            completed: {
              type: 'boolean',
              description: 'Filter by completion status',
            },
            due_before: {
              type: 'string',
              description: 'Get notes due before this date (ISO format)',
            },
            due_after: {
              type: 'string',
              description: 'Get notes due after this date (ISO format)',
            },
            search: {
              type: 'string',
              description: 'Search term to filter notes',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of notes to return (default: 50)',
            },
          },
        },
      },
      {
        name: 'update_note',
        description: 'Update an existing note',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'string',
              description: 'The ID of the note to update',
            },
            text: {
              type: 'string',
              description: 'New note content',
            },
            category: {
              type: 'string',
              description: 'New category',
            },
            due_date: {
              type: 'string',
              description: 'New due date (ISO format, or null to remove)',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
            },
            completed: {
              type: 'boolean',
              description: 'Mark as completed or not',
            },
          },
          required: ['note_id'],
        },
      },
      {
        name: 'complete_note',
        description: 'Mark a note/task as completed',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'string',
              description: 'The ID of the note to complete',
            },
          },
          required: ['note_id'],
        },
      },
      {
        name: 'delete_note',
        description: 'Delete a note',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'string',
              description: 'The ID of the note to delete',
            },
          },
          required: ['note_id'],
        },
      },

      // List Management
      {
        name: 'create_list',
        description: 'Create a new list/category for organizing notes',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the list',
            },
            description: {
              type: 'string',
              description: 'Optional description',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_lists',
        description: 'Get all lists/categories',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // Reminder Management
      {
        name: 'set_reminder',
        description: 'Set a reminder for a note',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'string',
              description: 'The note to set reminder for',
            },
            reminder_time: {
              type: 'string',
              description: 'When to remind (ISO datetime)',
            },
            recurrence: {
              type: 'string',
              enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'],
              description: 'Recurrence pattern',
            },
          },
          required: ['note_id', 'reminder_time'],
        },
      },
      {
        name: 'get_reminders',
        description: 'Get upcoming reminders',
        inputSchema: {
          type: 'object',
          properties: {
            days_ahead: {
              type: 'number',
              description: 'How many days ahead to look (default: 7)',
            },
          },
        },
      },

      // Couple Features
      {
        name: 'get_couple_info',
        description: 'Get information about the couple (partner name, shared notes count, etc.)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'assign_task',
        description: 'Assign a task/note to yourself or your partner',
        inputSchema: {
          type: 'object',
          properties: {
            note_id: {
              type: 'string',
              description: 'The note/task to assign',
            },
            assignee: {
              type: 'string',
              enum: ['me', 'partner'],
              description: 'Who to assign to',
            },
          },
          required: ['note_id', 'assignee'],
        },
      },

      // AI Features
      {
        name: 'brain_dump',
        description: 'Process a brain dump - unstructured text that Olive will organize into notes',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Unstructured text to process (e.g., "need to buy milk, call mom tomorrow, dentist appointment next week")',
            },
          },
          required: ['text'],
        },
      },
      {
        name: 'get_summary',
        description: 'Get a summary of notes, tasks, and upcoming items',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['daily', 'weekly', 'category'],
              description: 'Type of summary',
            },
            category: {
              type: 'string',
              description: 'For category summary, which category',
            },
          },
        },
      },
    ],
  };
});

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const client = getSupabaseClient();

  try {
    switch (name) {
      // ============ NOTE MANAGEMENT ============
      case 'create_note': {
        const { text, category = 'other', due_date, priority, list_id, is_shared } = args as any;

        const { data, error } = await client
          .from('clerk_notes')
          .insert({
            original_text: text,
            category,
            due_date: due_date || null,
            priority: priority || 'medium',
            list_id: list_id || null,
            is_shared: is_shared !== false,
            completed: false,
          })
          .select()
          .single();

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                note: data,
                message: `Created note: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_notes': {
        const { category, completed, due_before, due_after, search, limit = 50 } = args as any;

        let query = client
          .from('clerk_notes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (category) query = query.eq('category', category);
        if (completed !== undefined) query = query.eq('completed', completed);
        if (due_before) query = query.lte('due_date', due_before);
        if (due_after) query = query.gte('due_date', due_after);
        if (search) query = query.ilike('original_text', `%${search}%`);

        const { data, error } = await query;

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: data?.length || 0,
                notes: data,
              }, null, 2),
            },
          ],
        };
      }

      case 'update_note': {
        const { note_id, ...updates } = args as any;

        const updateData: any = {};
        if (updates.text) updateData.original_text = updates.text;
        if (updates.category) updateData.category = updates.category;
        if (updates.due_date !== undefined) updateData.due_date = updates.due_date;
        if (updates.priority) updateData.priority = updates.priority;
        if (updates.completed !== undefined) updateData.completed = updates.completed;
        updateData.updated_at = new Date().toISOString();

        const { data, error } = await client
          .from('clerk_notes')
          .update(updateData)
          .eq('id', note_id)
          .select()
          .single();

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                note: data,
                message: 'Note updated successfully',
              }, null, 2),
            },
          ],
        };
      }

      case 'complete_note': {
        const { note_id } = args as any;

        const { data, error } = await client
          .from('clerk_notes')
          .update({ completed: true, updated_at: new Date().toISOString() })
          .eq('id', note_id)
          .select()
          .single();

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Completed: "${data.original_text.substring(0, 50)}"`,
              }, null, 2),
            },
          ],
        };
      }

      case 'delete_note': {
        const { note_id } = args as any;

        const { error } = await client
          .from('clerk_notes')
          .delete()
          .eq('id', note_id);

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Note deleted successfully',
              }, null, 2),
            },
          ],
        };
      }

      // ============ LIST MANAGEMENT ============
      case 'create_list': {
        const { name, description } = args as any;

        const { data, error } = await client
          .from('clerk_lists')
          .insert({ name, description })
          .select()
          .single();

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                list: data,
                message: `Created list: "${name}"`,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_lists': {
        const { data, error } = await client
          .from('clerk_lists')
          .select('*, clerk_notes(count)')
          .order('created_at', { ascending: false });

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                lists: data,
              }, null, 2),
            },
          ],
        };
      }

      // ============ REMINDERS ============
      case 'set_reminder': {
        const { note_id, reminder_time, recurrence = 'none' } = args as any;

        const updateData: any = {
          reminder_time,
          updated_at: new Date().toISOString(),
        };

        if (recurrence !== 'none') {
          updateData.recurrence_frequency = recurrence;
          updateData.recurrence_interval = 1;
        }

        const { data, error } = await client
          .from('clerk_notes')
          .update(updateData)
          .eq('id', note_id)
          .select()
          .single();

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Reminder set for ${reminder_time}`,
                note: data,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_reminders': {
        const { days_ahead = 7 } = args as any;
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + days_ahead);

        const { data, error } = await client
          .from('clerk_notes')
          .select('*')
          .not('reminder_time', 'is', null)
          .lte('reminder_time', futureDate.toISOString())
          .gte('reminder_time', new Date().toISOString())
          .order('reminder_time', { ascending: true });

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: data?.length || 0,
                reminders: data,
              }, null, 2),
            },
          ],
        };
      }

      // ============ COUPLE FEATURES ============
      case 'get_couple_info': {
        const { data: coupleData, error: coupleError } = await client
          .from('clerk_couples')
          .select('*, clerk_couple_members(*)')
          .single();

        if (coupleError && coupleError.code !== 'PGRST116') throw coupleError;

        if (!coupleData) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  has_couple: false,
                  message: 'User is not part of a couple yet',
                }, null, 2),
              },
            ],
          };
        }

        const { data: noteStats } = await client
          .from('clerk_notes')
          .select('id, is_shared, completed')
          .eq('couple_id', coupleData.id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                has_couple: true,
                couple: {
                  id: coupleData.id,
                  title: coupleData.title,
                  you_name: coupleData.you_name,
                  partner_name: coupleData.partner_name,
                },
                stats: {
                  total_notes: noteStats?.length || 0,
                  shared_notes: noteStats?.filter(n => n.is_shared).length || 0,
                  completed: noteStats?.filter(n => n.completed).length || 0,
                },
              }, null, 2),
            },
          ],
        };
      }

      case 'assign_task': {
        const { note_id, assignee } = args as any;

        // Get couple info first to get partner's user ID
        const { data: coupleData } = await client
          .from('clerk_couples')
          .select('*, clerk_couple_members(*)')
          .single();

        if (!coupleData) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: 'Cannot assign tasks - not part of a couple',
                }, null, 2),
              },
            ],
          };
        }

        // Determine task owner based on assignee
        const taskOwner = assignee === 'me' ? 'you' : 'partner';

        const { data, error } = await client
          .from('clerk_notes')
          .update({ task_owner: taskOwner, updated_at: new Date().toISOString() })
          .eq('id', note_id)
          .select()
          .single();

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Task assigned to ${assignee}`,
                note: data,
              }, null, 2),
            },
          ],
        };
      }

      // ============ AI FEATURES ============
      case 'brain_dump': {
        const { text } = args as any;

        // Call the brain dump processing function
        const { data, error } = await client.functions.invoke('process-brain-dump', {
          body: { text },
        });

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Brain dump processed',
                results: data,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_summary': {
        const { type = 'daily', category } = args as any;

        let notes: Note[] = [];
        const today = new Date();

        if (type === 'daily') {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);

          const { data } = await client
            .from('clerk_notes')
            .select('*')
            .or(`due_date.gte.${today.toISOString().split('T')[0]},due_date.lte.${tomorrow.toISOString().split('T')[0]}`)
            .eq('completed', false);

          notes = data || [];
        } else if (type === 'weekly') {
          const nextWeek = new Date(today);
          nextWeek.setDate(nextWeek.getDate() + 7);

          const { data } = await client
            .from('clerk_notes')
            .select('*')
            .gte('due_date', today.toISOString().split('T')[0])
            .lte('due_date', nextWeek.toISOString().split('T')[0])
            .eq('completed', false);

          notes = data || [];
        } else if (type === 'category' && category) {
          const { data } = await client
            .from('clerk_notes')
            .select('*')
            .eq('category', category)
            .eq('completed', false);

          notes = data || [];
        }

        // Group by category
        const byCategory: Record<string, Note[]> = {};
        notes.forEach(note => {
          if (!byCategory[note.category]) byCategory[note.category] = [];
          byCategory[note.category].push(note);
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                summary_type: type,
                total_items: notes.length,
                by_category: Object.entries(byCategory).map(([cat, items]) => ({
                  category: cat,
                  count: items.length,
                  items: items.map(n => ({
                    id: n.id,
                    text: n.original_text,
                    due: n.due_date,
                    priority: n.priority,
                  })),
                })),
              }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Unknown tool: ${name}` }),
            },
          ],
          isError: true,
        };
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message || 'An error occurred',
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ============================================
// RESOURCES - Data the AI can read
// ============================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'olive://notes/all',
        name: 'All Notes',
        description: 'All notes and tasks in Olive',
        mimeType: 'application/json',
      },
      {
        uri: 'olive://notes/pending',
        name: 'Pending Tasks',
        description: 'All incomplete tasks',
        mimeType: 'application/json',
      },
      {
        uri: 'olive://notes/today',
        name: "Today's Tasks",
        description: 'Tasks due today',
        mimeType: 'application/json',
      },
      {
        uri: 'olive://lists',
        name: 'Lists',
        description: 'All custom lists',
        mimeType: 'application/json',
      },
      {
        uri: 'olive://couple',
        name: 'Couple Info',
        description: 'Information about the couple',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const client = getSupabaseClient();

  try {
    switch (uri) {
      case 'olive://notes/all': {
        const { data } = await client
          .from('clerk_notes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data || [], null, 2),
            },
          ],
        };
      }

      case 'olive://notes/pending': {
        const { data } = await client
          .from('clerk_notes')
          .select('*')
          .eq('completed', false)
          .order('due_date', { ascending: true, nullsFirst: false });

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data || [], null, 2),
            },
          ],
        };
      }

      case 'olive://notes/today': {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await client
          .from('clerk_notes')
          .select('*')
          .eq('due_date', today)
          .eq('completed', false);

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data || [], null, 2),
            },
          ],
        };
      }

      case 'olive://lists': {
        const { data } = await client
          .from('clerk_lists')
          .select('*')
          .order('created_at', { ascending: false });

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data || [], null, 2),
            },
          ],
        };
      }

      case 'olive://couple': {
        const { data } = await client
          .from('clerk_couples')
          .select('*, clerk_couple_members(*)')
          .single();

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data || { message: 'Not in a couple' }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  } catch (error: any) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ error: error.message }),
        },
      ],
    };
  }
});

// ============================================
// PROMPTS - Pre-defined prompt templates
// ============================================

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'daily_planning',
        description: 'Help plan the day based on pending tasks and calendar',
        arguments: [
          {
            name: 'focus_area',
            description: 'Optional area to focus on (e.g., work, personal, household)',
            required: false,
          },
        ],
      },
      {
        name: 'weekly_review',
        description: 'Review the week - completed tasks, pending items, and suggestions',
      },
      {
        name: 'grocery_list',
        description: 'Compile and organize the grocery shopping list',
      },
      {
        name: 'couple_sync',
        description: 'Summarize shared tasks and suggest coordination opportunities',
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'daily_planning':
      return {
        description: 'Daily planning assistant',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please help me plan my day. ${args?.focus_area ? `Focus on ${args.focus_area} tasks.` : ''}

First, get my pending tasks for today using the get_notes tool with due_before set to tomorrow.
Then, check my reminders for today.
Finally, suggest a prioritized schedule based on task priorities and deadlines.`,
            },
          },
        ],
      };

    case 'weekly_review':
      return {
        description: 'Weekly review and planning',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Let's do a weekly review:

1. First, get all completed tasks from the past week
2. Get all pending tasks
3. Summarize what was accomplished
4. Identify any overdue items
5. Suggest priorities for the coming week`,
            },
          },
        ],
      };

    case 'grocery_list':
      return {
        description: 'Grocery list compilation',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Help me with my grocery shopping:

1. Get all notes in the "groceries" category
2. Organize them by type (produce, dairy, meat, pantry, etc.)
3. Check if there are any meal-related notes that might require ingredients
4. Create a consolidated, organized shopping list`,
            },
          },
        ],
      };

    case 'couple_sync':
      return {
        description: 'Couple task coordination',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Help coordinate tasks between me and my partner:

1. Get couple information
2. Get all shared tasks that are pending
3. Identify tasks assigned to each person
4. Suggest any tasks that could be split or reassigned for better balance
5. Highlight any upcoming deadlines we both should know about`,
            },
          },
        ],
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

// ============================================
// START SERVER
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Olive MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
