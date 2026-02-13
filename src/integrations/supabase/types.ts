export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      calendar_connections: {
        Row: {
          access_token: string
          auto_add_to_calendar: boolean | null
          auto_create_events: boolean | null
          calendar_name: string | null
          calendar_type: string | null
          couple_id: string | null
          created_at: string | null
          error_message: string | null
          google_email: string
          google_user_id: string
          id: string
          is_active: boolean | null
          last_sync_time: string | null
          primary_calendar_id: string
          refresh_token: string
          show_google_events: boolean | null
          sync_direction: string | null
          sync_enabled: boolean | null
          token_expiry: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          auto_add_to_calendar?: boolean | null
          auto_create_events?: boolean | null
          calendar_name?: string | null
          calendar_type?: string | null
          couple_id?: string | null
          created_at?: string | null
          error_message?: string | null
          google_email: string
          google_user_id: string
          id?: string
          is_active?: boolean | null
          last_sync_time?: string | null
          primary_calendar_id: string
          refresh_token: string
          show_google_events?: boolean | null
          sync_direction?: string | null
          sync_enabled?: boolean | null
          token_expiry?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          auto_add_to_calendar?: boolean | null
          auto_create_events?: boolean | null
          calendar_name?: string | null
          calendar_type?: string | null
          couple_id?: string | null
          created_at?: string | null
          error_message?: string | null
          google_email?: string
          google_user_id?: string
          id?: string
          is_active?: boolean | null
          last_sync_time?: string | null
          primary_calendar_id?: string
          refresh_token?: string
          show_google_events?: boolean | null
          sync_direction?: string | null
          sync_enabled?: boolean | null
          token_expiry?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          all_day: boolean | null
          connection_id: string
          created_at: string | null
          description: string | null
          end_time: string
          etag: string | null
          event_type: string | null
          google_event_id: string
          id: string
          is_synced: boolean | null
          last_synced_at: string | null
          location: string | null
          note_id: string | null
          start_time: string
          timezone: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          all_day?: boolean | null
          connection_id: string
          created_at?: string | null
          description?: string | null
          end_time: string
          etag?: string | null
          event_type?: string | null
          google_event_id: string
          id?: string
          is_synced?: boolean | null
          last_synced_at?: string | null
          location?: string | null
          note_id?: string | null
          start_time: string
          timezone?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          all_day?: boolean | null
          connection_id?: string
          created_at?: string | null
          description?: string | null
          end_time?: string
          etag?: string | null
          event_type?: string | null
          google_event_id?: string
          id?: string
          is_synced?: boolean | null
          last_synced_at?: string | null
          location?: string | null
          note_id?: string | null
          start_time?: string
          timezone?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "clerk_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sync_state: {
        Row: {
          connection_id: string
          created_at: string | null
          error_message: string | null
          id: string
          last_sync_time: string | null
          sync_status: string | null
          sync_token: string | null
          updated_at: string | null
        }
        Insert: {
          connection_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_sync_time?: string | null
          sync_status?: string | null
          sync_token?: string | null
          updated_at?: string | null
        }
        Update: {
          connection_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          last_sync_time?: string | null
          sync_status?: string | null
          sync_token?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sync_state_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      clerk_couple_members: {
        Row: {
          couple_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string | null
        }
        Insert: {
          couple_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string | null
        }
        Update: {
          couple_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clerk_couple_members_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      clerk_couples: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          partner_name: string | null
          title: string | null
          updated_at: string
          you_name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          partner_name?: string | null
          title?: string | null
          updated_at?: string
          you_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          partner_name?: string | null
          title?: string | null
          updated_at?: string
          you_name?: string | null
        }
        Relationships: []
      }
      clerk_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          couple_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          invited_email: string | null
          revoked: boolean
          role: Database["public"]["Enums"]["member_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          couple_id: string
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          invited_email?: string | null
          revoked?: boolean
          role?: Database["public"]["Enums"]["member_role"]
          status?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          couple_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          invited_email?: string | null
          revoked?: boolean
          role?: Database["public"]["Enums"]["member_role"]
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "clerk_invites_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      clerk_lists: {
        Row: {
          author_id: string | null
          couple_id: string | null
          created_at: string
          description: string | null
          id: string
          is_manual: boolean
          name: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          couple_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_manual?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          couple_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_manual?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      clerk_notes: {
        Row: {
          author_id: string | null
          auto_reminders_sent: string[] | null
          category: string
          completed: boolean
          couple_id: string | null
          created_at: string
          due_date: string | null
          embedding: string | null
          id: string
          items: string[] | null
          last_reminded_at: string | null
          list_id: string | null
          location: Json | null
          media_urls: string[] | null
          olive_tips: Json | null
          original_text: string
          priority: Database["public"]["Enums"]["note_priority"] | null
          recurrence_frequency: string | null
          recurrence_interval: number | null
          reminder_time: string | null
          summary: string
          tags: string[] | null
          task_owner: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          auto_reminders_sent?: string[] | null
          category: string
          completed?: boolean
          couple_id?: string | null
          created_at?: string
          due_date?: string | null
          embedding?: string | null
          id?: string
          items?: string[] | null
          last_reminded_at?: string | null
          list_id?: string | null
          location?: Json | null
          media_urls?: string[] | null
          olive_tips?: Json | null
          original_text: string
          priority?: Database["public"]["Enums"]["note_priority"] | null
          recurrence_frequency?: string | null
          recurrence_interval?: number | null
          reminder_time?: string | null
          summary: string
          tags?: string[] | null
          task_owner?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          auto_reminders_sent?: string[] | null
          category?: string
          completed?: boolean
          couple_id?: string | null
          created_at?: string
          due_date?: string | null
          embedding?: string | null
          id?: string
          items?: string[] | null
          last_reminded_at?: string | null
          list_id?: string | null
          location?: Json | null
          media_urls?: string[] | null
          olive_tips?: Json | null
          original_text?: string
          priority?: Database["public"]["Enums"]["note_priority"] | null
          recurrence_frequency?: string | null
          recurrence_interval?: number | null
          reminder_time?: string | null
          summary?: string
          tags?: string[] | null
          task_owner?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clerk_notes_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clerk_notes_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "clerk_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      clerk_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          language_preference: string | null
          last_outbound_context: Json | null
          last_user_message_at: string | null
          note_style: string | null
          phone_number: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          language_preference?: string | null
          last_outbound_context?: Json | null
          last_user_message_at?: string | null
          note_style?: string | null
          phone_number?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          language_preference?: string | null
          last_outbound_context?: Json | null
          last_user_message_at?: string | null
          note_style?: string | null
          phone_number?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      couple_members: {
        Row: {
          couple_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          couple_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          couple_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "couple_members_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
        ]
      }
      couples: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          partner_name: string | null
          title: string | null
          updated_at: string
          you_name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          partner_name?: string | null
          title?: string | null
          updated_at?: string
          you_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          partner_name?: string | null
          title?: string | null
          updated_at?: string
          you_name?: string | null
        }
        Relationships: []
      }
      invites: {
        Row: {
          couple_id: string
          created_at: string
          expires_at: string | null
          id: string
          invited_by: string | null
          invited_email: string
          status: Database["public"]["Enums"]["invite_status"]
          token: string
        }
        Insert: {
          couple_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          invited_email: string
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
        }
        Update: {
          couple_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          invited_email?: string
          status?: Database["public"]["Enums"]["invite_status"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      linking_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      memory_insights: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          id: string
          source: string | null
          status: string
          suggested_content: string
          user_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          source?: string | null
          status?: string
          suggested_content: string
          user_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          source?: string | null
          status?: string
          suggested_content?: string
          user_id?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          author_id: string | null
          category: string
          completed: boolean
          couple_id: string
          created_at: string
          due_date: string | null
          id: string
          items: string[] | null
          original_text: string
          priority: Database["public"]["Enums"]["note_priority"] | null
          summary: string
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          category: string
          completed?: boolean
          couple_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          items?: string[] | null
          original_text: string
          priority?: Database["public"]["Enums"]["note_priority"] | null
          summary: string
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          category?: string
          completed?: boolean
          couple_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          items?: string[] | null
          original_text?: string
          priority?: Database["public"]["Enums"]["note_priority"] | null
          summary?: string
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "couples"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_conversations: {
        Row: {
          created_at: string
          id: string
          interaction_id: string
          note_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interaction_id: string
          note_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interaction_id?: string
          note_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_conversations_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "clerk_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_gateway_sessions: {
        Row: {
          channel: string | null
          conversation_context: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_activity: string | null
          user_id: string
        }
        Insert: {
          channel?: string | null
          conversation_context?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_activity?: string | null
          user_id: string
        }
        Update: {
          channel?: string | null
          conversation_context?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_activity?: string | null
          user_id?: string
        }
        Relationships: []
      }
      olive_heartbeat_jobs: {
        Row: {
          created_at: string | null
          id: string
          job_type: string
          payload: Json | null
          scheduled_for: string
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_type: string
          payload?: Json | null
          scheduled_for: string
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          job_type?: string
          payload?: Json | null
          scheduled_for?: string
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      olive_heartbeat_log: {
        Row: {
          channel: string | null
          created_at: string | null
          execution_time_ms: number | null
          id: string
          job_type: string
          message_preview: string | null
          status: string
          user_id: string
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          execution_time_ms?: number | null
          id?: string
          job_type: string
          message_preview?: string | null
          status: string
          user_id: string
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          execution_time_ms?: number | null
          id?: string
          job_type?: string
          message_preview?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      olive_memory_chunks: {
        Row: {
          chunk_index: number | null
          chunk_type: string | null
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          importance: number | null
          memory_file_id: string | null
          metadata: Json | null
          source: string | null
          user_id: string
        }
        Insert: {
          chunk_index?: number | null
          chunk_type?: string | null
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: number | null
          memory_file_id?: string | null
          metadata?: Json | null
          source?: string | null
          user_id: string
        }
        Update: {
          chunk_index?: number | null
          chunk_type?: string | null
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: number | null
          memory_file_id?: string | null
          metadata?: Json | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_memory_chunks_memory_file_id_fkey"
            columns: ["memory_file_id"]
            isOneToOne: false
            referencedRelation: "olive_memory_files"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_memory_files: {
        Row: {
          content: string
          content_hash: string | null
          couple_id: string | null
          created_at: string | null
          embedding: string | null
          file_date: string | null
          file_type: string
          id: string
          metadata: Json | null
          token_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content?: string
          content_hash?: string | null
          couple_id?: string | null
          created_at?: string | null
          embedding?: string | null
          file_date?: string | null
          file_type: string
          id?: string
          metadata?: Json | null
          token_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          content_hash?: string | null
          couple_id?: string | null
          created_at?: string | null
          embedding?: string | null
          file_date?: string | null
          file_type?: string
          id?: string
          metadata?: Json | null
          token_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_memory_files_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_outbound_queue: {
        Row: {
          content: string
          created_at: string | null
          error_message: string | null
          id: string
          media_url: string | null
          message_type: string
          priority: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          media_url?: string | null
          message_type: string
          priority?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          media_url?: string | null
          message_type?: string
          priority?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      olive_patterns: {
        Row: {
          confidence: number | null
          couple_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          pattern_data: Json
          pattern_type: string
          sample_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          couple_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          pattern_data?: Json
          pattern_type: string
          sample_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          couple_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          pattern_data?: Json
          pattern_type?: string
          sample_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_patterns_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_skills: {
        Row: {
          category: string | null
          content: string | null
          created_at: string | null
          description: string | null
          is_active: boolean | null
          name: string
          skill_id: string
          triggers: Json | null
        }
        Insert: {
          category?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          is_active?: boolean | null
          name: string
          skill_id: string
          triggers?: Json | null
        }
        Update: {
          category?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          is_active?: boolean | null
          name?: string
          skill_id?: string
          triggers?: Json | null
        }
        Relationships: []
      }
      olive_user_preferences: {
        Row: {
          created_at: string | null
          evening_review_enabled: boolean | null
          max_daily_messages: number | null
          morning_briefing_enabled: boolean | null
          overdue_nudge_enabled: boolean | null
          pattern_suggestions_enabled: boolean | null
          proactive_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          timezone: string | null
          updated_at: string | null
          user_id: string
          weekly_summary_enabled: boolean | null
        }
        Insert: {
          created_at?: string | null
          evening_review_enabled?: boolean | null
          max_daily_messages?: number | null
          morning_briefing_enabled?: boolean | null
          overdue_nudge_enabled?: boolean | null
          pattern_suggestions_enabled?: boolean | null
          proactive_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id: string
          weekly_summary_enabled?: boolean | null
        }
        Update: {
          created_at?: string | null
          evening_review_enabled?: boolean | null
          max_daily_messages?: number | null
          morning_briefing_enabled?: boolean | null
          overdue_nudge_enabled?: boolean | null
          pattern_suggestions_enabled?: boolean | null
          proactive_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
          weekly_summary_enabled?: boolean | null
        }
        Relationships: []
      }
      olive_user_skills: {
        Row: {
          config: Json | null
          created_at: string | null
          enabled: boolean | null
          id: string
          last_used_at: string | null
          skill_id: string | null
          usage_count: number | null
          user_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_used_at?: string | null
          skill_id?: string | null
          usage_count?: number | null
          user_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_used_at?: string | null
          skill_id?: string | null
          usage_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_user_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "olive_skills"
            referencedColumns: ["skill_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_memories: {
        Row: {
          category: string | null
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          importance: number | null
          is_active: boolean | null
          metadata: Json | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: number | null
          is_active?: boolean | null
          metadata?: Json | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: number | null
          is_active?: boolean | null
          metadata?: Json | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          context_data: Json | null
          conversation_state: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          context_data?: Json | null
          conversation_state?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          context_data?: Json | null
          conversation_state?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string }
      cleanup_expired_linking_tokens: { Args: never; Returns: undefined }
      create_couple: {
        Args: { p_partner_name: string; p_title: string; p_you_name: string }
        Returns: string
      }
      create_invite: {
        Args: { p_couple_id: string; p_invited_email?: string }
        Returns: Json
      }
      debug_claims: { Args: never; Returns: Json }
      debug_clerk_jwt: { Args: never; Returns: string }
      debug_clerk_user_id: { Args: never; Returns: string }
      debug_clerk_user_id_fixed: { Args: never; Returns: string }
      debug_jwt_claims: { Args: never; Returns: Json }
      find_similar_notes: {
        Args: {
          p_couple_id: string
          p_limit?: number
          p_query_embedding: string
          p_threshold?: number
          p_user_id: string
        }
        Returns: {
          id: string
          similarity: number
          summary: string
        }[]
      }
      get_clerk_user_id: { Args: never; Returns: string }
      is_couple_member: {
        Args: { couple_uuid: string; p_user_id: string }
        Returns: boolean
      }
      is_couple_member_safe: {
        Args: { couple_uuid: string; p_user_id: string }
        Returns: boolean
      }
      is_couple_owner: {
        Args: { couple_uuid: string; user_id: string }
        Returns: boolean
      }
      is_member_of_couple: {
        Args: { p_couple_id: string; p_user_id?: string }
        Returns: boolean
      }
      jwt: { Args: never; Returns: Json }
      jwt_sub: { Args: never; Returns: string }
      merge_notes: {
        Args: { p_source_id: string; p_target_id: string }
        Returns: Json
      }
      search_user_memories: {
        Args: {
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
          p_user_id: string
        }
        Returns: {
          category: string
          content: string
          id: string
          importance: number
          similarity: number
          title: string
        }[]
      }
      validate_invite: {
        Args: { p_token: string }
        Returns: {
          accepted: boolean
          couple_id: string
          expires_at: string
          partner_name: string
          revoked: boolean
          role: string
          title: string
          you_name: string
        }[]
      }
    }
    Enums: {
      invite_status: "pending" | "accepted" | "revoked"
      member_role: "owner" | "member"
      note_priority: "low" | "medium" | "high"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      invite_status: ["pending", "accepted", "revoked"],
      member_role: ["owner", "member"],
      note_priority: ["low", "medium", "high"],
    },
  },
} as const
