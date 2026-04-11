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
      beta_feedback: {
        Row: {
          category: string
          contact_email: string | null
          created_at: string
          id: string
          message: string
          page: string | null
          user_agent: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          category?: string
          contact_email?: string | null
          created_at?: string
          id?: string
          message: string
          page?: string | null
          user_agent?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          category?: string
          contact_email?: string | null
          created_at?: string
          id?: string
          message?: string
          page?: string | null
          user_agent?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
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
          tasks_enabled: boolean | null
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
          tasks_enabled?: boolean | null
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
          tasks_enabled?: boolean | null
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
          display_name: string | null
          id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string | null
        }
        Insert: {
          couple_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string | null
        }
        Update: {
          couple_id?: string | null
          created_at?: string
          display_name?: string | null
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
          max_members: number
          partner_name: string | null
          title: string | null
          updated_at: string
          you_name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_members?: number
          partner_name?: string | null
          title?: string | null
          updated_at?: string
          you_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          max_members?: number
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
          encrypted_original_text: string | null
          encrypted_summary: string | null
          id: string
          is_sensitive: boolean
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
          source: string | null
          source_ref: string | null
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
          encrypted_original_text?: string | null
          encrypted_summary?: string | null
          id?: string
          is_sensitive?: boolean
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
          source?: string | null
          source_ref?: string | null
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
          encrypted_original_text?: string | null
          encrypted_summary?: string | null
          id?: string
          is_sensitive?: boolean
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
          source?: string | null
          source_ref?: string | null
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
          default_privacy: string
          display_name: string | null
          expense_default_currency: string | null
          expense_default_split: string | null
          expense_tracking_mode: string | null
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
          default_privacy?: string
          display_name?: string | null
          expense_default_currency?: string | null
          expense_default_split?: string | null
          expense_tracking_mode?: string | null
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
          default_privacy?: string
          display_name?: string | null
          expense_default_currency?: string | null
          expense_default_split?: string | null
          expense_tracking_mode?: string | null
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
      decryption_audit_log: {
        Row: {
          created_at: string
          function_name: string
          id: string
          ip_address: string | null
          note_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          function_name: string
          id?: string
          ip_address?: string | null
          note_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          function_name?: string
          id?: string
          ip_address?: string | null
          note_id?: string
          user_id?: string
        }
        Relationships: []
      }
      expense_budget_limits: {
        Row: {
          category: string
          couple_id: string | null
          created_at: string
          currency: string
          id: string
          monthly_limit: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          couple_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          monthly_limit?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          couple_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          monthly_limit?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_budget_limits_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_settlements: {
        Row: {
          couple_id: string | null
          created_at: string
          currency: string
          expense_count: number
          id: string
          settled_by: string
          total_amount: number
          user_id: string
        }
        Insert: {
          couple_id?: string | null
          created_at?: string
          currency?: string
          expense_count?: number
          id?: string
          settled_by: string
          total_amount?: number
          user_id: string
        }
        Update: {
          couple_id?: string | null
          created_at?: string
          currency?: string
          expense_count?: number
          id?: string
          settled_by?: string
          total_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_settlements_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          category_icon: string | null
          couple_id: string | null
          created_at: string
          currency: string
          expense_date: string
          id: string
          is_recurring: boolean
          is_settled: boolean
          is_shared: boolean
          name: string
          next_recurrence_date: string | null
          note_id: string | null
          original_text: string | null
          paid_by: string
          parent_recurring_id: string | null
          receipt_url: string | null
          recurrence_frequency: string | null
          recurrence_interval: number | null
          settled_at: string | null
          settlement_id: string | null
          split_type: Database["public"]["Enums"]["expense_split_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string
          category_icon?: string | null
          couple_id?: string | null
          created_at?: string
          currency?: string
          expense_date?: string
          id?: string
          is_recurring?: boolean
          is_settled?: boolean
          is_shared?: boolean
          name: string
          next_recurrence_date?: string | null
          note_id?: string | null
          original_text?: string | null
          paid_by: string
          parent_recurring_id?: string | null
          receipt_url?: string | null
          recurrence_frequency?: string | null
          recurrence_interval?: number | null
          settled_at?: string | null
          settlement_id?: string | null
          split_type?: Database["public"]["Enums"]["expense_split_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          category_icon?: string | null
          couple_id?: string | null
          created_at?: string
          currency?: string
          expense_date?: string
          id?: string
          is_recurring?: boolean
          is_settled?: boolean
          is_shared?: boolean
          name?: string
          next_recurrence_date?: string | null
          note_id?: string | null
          original_text?: string | null
          paid_by?: string
          parent_recurring_id?: string | null
          receipt_url?: string | null
          recurrence_frequency?: string | null
          recurrence_interval?: number | null
          settled_at?: string | null
          settlement_id?: string | null
          split_type?: Database["public"]["Enums"]["expense_split_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "clerk_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_parent_recurring_id_fkey"
            columns: ["parent_recurring_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "expense_settlements"
            referencedColumns: ["id"]
          },
        ]
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
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json | null
          priority: number | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          priority?: number | null
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          priority?: number | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      olive_agent_runs: {
        Row: {
          agent_id: string
          completed_at: string | null
          couple_id: string | null
          error_message: string | null
          id: string
          result: Json | null
          started_at: string | null
          state: Json | null
          status: string | null
          steps_completed: number | null
          user_id: string
        }
        Insert: {
          agent_id: string
          completed_at?: string | null
          couple_id?: string | null
          error_message?: string | null
          id?: string
          result?: Json | null
          started_at?: string | null
          state?: Json | null
          status?: string | null
          steps_completed?: number | null
          user_id: string
        }
        Update: {
          agent_id?: string
          completed_at?: string | null
          couple_id?: string | null
          error_message?: string | null
          id?: string
          result?: Json | null
          started_at?: string | null
          state?: Json | null
          status?: string | null
          steps_completed?: number | null
          user_id?: string
        }
        Relationships: []
      }
      olive_chat_sessions: {
        Row: {
          couple_id: string | null
          created_at: string | null
          id: string
          last_message_at: string | null
          messages: Json
          summary: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          couple_id?: string | null
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          messages?: Json
          summary?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          couple_id?: string | null
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          messages?: Json
          summary?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_chat_sessions_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
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
      olive_email_connections: {
        Row: {
          access_token: string | null
          auto_save_tasks: boolean | null
          created_at: string | null
          email_address: string | null
          error_message: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          provider: string
          refresh_token: string | null
          scopes: string[] | null
          token_expiry: string | null
          triage_frequency: string | null
          triage_lookback_days: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token?: string | null
          auto_save_tasks?: boolean | null
          created_at?: string | null
          email_address?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          provider?: string
          refresh_token?: string | null
          scopes?: string[] | null
          token_expiry?: string | null
          triage_frequency?: string | null
          triage_lookback_days?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string | null
          auto_save_tasks?: boolean | null
          created_at?: string | null
          email_address?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          provider?: string
          refresh_token?: string | null
          scopes?: string[] | null
          token_expiry?: string | null
          triage_frequency?: string | null
          triage_lookback_days?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      olive_entities: {
        Row: {
          canonical_name: string
          couple_id: string | null
          created_at: string | null
          embedding: string | null
          entity_type: string
          first_seen: string | null
          id: string
          last_seen: string | null
          mention_count: number | null
          metadata: Json | null
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          canonical_name: string
          couple_id?: string | null
          created_at?: string | null
          embedding?: string | null
          entity_type: string
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          mention_count?: number | null
          metadata?: Json | null
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          canonical_name?: string
          couple_id?: string | null
          created_at?: string | null
          embedding?: string | null
          entity_type?: string
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          mention_count?: number | null
          metadata?: Json | null
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_entities_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_entity_communities: {
        Row: {
          cohesion: number | null
          created_at: string | null
          entity_ids: string[]
          id: string
          label: string
          metadata: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cohesion?: number | null
          created_at?: string | null
          entity_ids: string[]
          id?: string
          label: string
          metadata?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cohesion?: number | null
          created_at?: string | null
          entity_ids?: string[]
          id?: string
          label?: string
          metadata?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
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
          consolidated_into: string | null
          content: string
          created_at: string | null
          decay_factor: number
          embedding: string | null
          id: string
          importance: number | null
          is_active: boolean
          last_accessed_at: string | null
          memory_file_id: string | null
          metadata: Json | null
          source: string | null
          source_message_id: string | null
          user_id: string
        }
        Insert: {
          chunk_index?: number | null
          chunk_type?: string | null
          consolidated_into?: string | null
          content: string
          created_at?: string | null
          decay_factor?: number
          embedding?: string | null
          id?: string
          importance?: number | null
          is_active?: boolean
          last_accessed_at?: string | null
          memory_file_id?: string | null
          metadata?: Json | null
          source?: string | null
          source_message_id?: string | null
          user_id: string
        }
        Update: {
          chunk_index?: number | null
          chunk_type?: string | null
          consolidated_into?: string | null
          content?: string
          created_at?: string | null
          decay_factor?: number
          embedding?: string | null
          id?: string
          importance?: number | null
          is_active?: boolean
          last_accessed_at?: string | null
          memory_file_id?: string | null
          metadata?: Json | null
          source?: string | null
          source_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_memory_chunks_consolidated_into_fkey"
            columns: ["consolidated_into"]
            isOneToOne: false
            referencedRelation: "olive_memory_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olive_memory_chunks_memory_file_id_fkey"
            columns: ["memory_file_id"]
            isOneToOne: false
            referencedRelation: "olive_memory_files"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_memory_contradictions: {
        Row: {
          chunk_a_content: string
          chunk_a_id: string | null
          chunk_b_content: string
          chunk_b_id: string | null
          confidence: number
          contradiction_type: string
          created_at: string
          id: string
          resolution: string | null
          resolved_at: string | null
          resolved_content: string | null
          user_id: string
        }
        Insert: {
          chunk_a_content: string
          chunk_a_id?: string | null
          chunk_b_content: string
          chunk_b_id?: string | null
          confidence?: number
          contradiction_type: string
          created_at?: string
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_content?: string | null
          user_id: string
        }
        Update: {
          chunk_a_content?: string
          chunk_a_id?: string | null
          chunk_b_content?: string
          chunk_b_id?: string | null
          confidence?: number
          contradiction_type?: string
          created_at?: string
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_content?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_memory_contradictions_chunk_a_id_fkey"
            columns: ["chunk_a_id"]
            isOneToOne: false
            referencedRelation: "olive_memory_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olive_memory_contradictions_chunk_b_id_fkey"
            columns: ["chunk_b_id"]
            isOneToOne: false
            referencedRelation: "olive_memory_chunks"
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
      olive_memory_maintenance_log: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          run_type: string
          started_at: string
          stats: Json | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          run_type: string
          started_at?: string
          stats?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          run_type?: string
          started_at?: string
          stats?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
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
      olive_relationships: {
        Row: {
          confidence: string
          confidence_score: number | null
          couple_id: string | null
          created_at: string | null
          id: string
          rationale: string | null
          relationship_type: string
          source_entity_id: string
          source_note_id: string | null
          target_entity_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          confidence?: string
          confidence_score?: number | null
          couple_id?: string | null
          created_at?: string | null
          id?: string
          rationale?: string | null
          relationship_type: string
          source_entity_id: string
          source_note_id?: string | null
          target_entity_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          confidence?: string
          confidence_score?: number | null
          couple_id?: string | null
          created_at?: string | null
          id?: string
          rationale?: string | null
          relationship_type?: string
          source_entity_id?: string
          source_note_id?: string | null
          target_entity_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_relationships_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "olive_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olive_relationships_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "olive_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_router_log: {
        Row: {
          chat_type: string | null
          classification_latency_ms: number | null
          classification_model: string | null
          classified_intent: string | null
          confidence: number | null
          created_at: string | null
          id: string
          media_present: boolean | null
          raw_text: string | null
          response_model: string | null
          route_reason: string | null
          source: string
          total_latency_ms: number | null
          user_id: string | null
        }
        Insert: {
          chat_type?: string | null
          classification_latency_ms?: number | null
          classification_model?: string | null
          classified_intent?: string | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          media_present?: boolean | null
          raw_text?: string | null
          response_model?: string | null
          route_reason?: string | null
          source: string
          total_latency_ms?: number | null
          user_id?: string | null
        }
        Update: {
          chat_type?: string | null
          classification_latency_ms?: number | null
          classification_model?: string | null
          classified_intent?: string | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          media_present?: boolean | null
          raw_text?: string | null
          response_model?: string | null
          route_reason?: string | null
          source?: string
          total_latency_ms?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      olive_skills: {
        Row: {
          agent_config: Json | null
          agent_type: string | null
          category: string | null
          content: string | null
          created_at: string | null
          description: string | null
          is_active: boolean | null
          name: string
          requires_approval: boolean | null
          requires_connection: string | null
          schedule: string | null
          skill_id: string
          triggers: Json | null
        }
        Insert: {
          agent_config?: Json | null
          agent_type?: string | null
          category?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          is_active?: boolean | null
          name: string
          requires_approval?: boolean | null
          requires_connection?: string | null
          schedule?: string | null
          skill_id: string
          triggers?: Json | null
        }
        Update: {
          agent_config?: Json | null
          agent_type?: string | null
          category?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          is_active?: boolean | null
          name?: string
          requires_approval?: boolean | null
          requires_connection?: string | null
          schedule?: string | null
          skill_id?: string
          triggers?: Json | null
        }
        Relationships: []
      }
      olive_user_preferences: {
        Row: {
          created_at: string | null
          evening_review_enabled: boolean | null
          evening_review_time: string | null
          max_daily_messages: number | null
          morning_briefing_enabled: boolean | null
          morning_briefing_time: string | null
          overdue_nudge_enabled: boolean | null
          pattern_suggestions_enabled: boolean | null
          proactive_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          reminder_advance_intervals: string[]
          timezone: string | null
          updated_at: string | null
          user_id: string
          weekly_summary_day: number | null
          weekly_summary_enabled: boolean | null
          weekly_summary_time: string | null
        }
        Insert: {
          created_at?: string | null
          evening_review_enabled?: boolean | null
          evening_review_time?: string | null
          max_daily_messages?: number | null
          morning_briefing_enabled?: boolean | null
          morning_briefing_time?: string | null
          overdue_nudge_enabled?: boolean | null
          pattern_suggestions_enabled?: boolean | null
          proactive_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reminder_advance_intervals?: string[]
          timezone?: string | null
          updated_at?: string | null
          user_id: string
          weekly_summary_day?: number | null
          weekly_summary_enabled?: boolean | null
          weekly_summary_time?: string | null
        }
        Update: {
          created_at?: string | null
          evening_review_enabled?: boolean | null
          evening_review_time?: string | null
          max_daily_messages?: number | null
          morning_briefing_enabled?: boolean | null
          morning_briefing_time?: string | null
          overdue_nudge_enabled?: boolean | null
          pattern_suggestions_enabled?: boolean | null
          proactive_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reminder_advance_intervals?: string[]
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
          weekly_summary_day?: number | null
          weekly_summary_enabled?: boolean | null
          weekly_summary_time?: string | null
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
      oura_connections: {
        Row: {
          access_token: string
          created_at: string | null
          error_message: string | null
          id: string
          is_active: boolean | null
          last_sync_time: string | null
          oura_email: string | null
          oura_user_id: string | null
          refresh_token: string
          scopes: string[] | null
          share_wellness_with_partner: boolean | null
          token_expiry: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_time?: string | null
          oura_email?: string | null
          oura_user_id?: string | null
          refresh_token: string
          scopes?: string[] | null
          share_wellness_with_partner?: boolean | null
          token_expiry?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_time?: string | null
          oura_email?: string | null
          oura_user_id?: string | null
          refresh_token?: string
          scopes?: string[] | null
          share_wellness_with_partner?: boolean | null
          token_expiry?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      oura_daily_data: {
        Row: {
          active_calories: number | null
          active_minutes: number | null
          activity_score: number | null
          awake_seconds: number | null
          bedtime_end: string | null
          bedtime_start: string | null
          connection_id: string
          day: string
          deep_sleep_seconds: number | null
          id: string
          light_sleep_seconds: number | null
          raw_data: Json | null
          readiness_hrv_balance: number | null
          readiness_resting_heart_rate: number | null
          readiness_score: number | null
          readiness_temperature_deviation: number | null
          recovery_high_minutes: number | null
          rem_sleep_seconds: number | null
          resilience_daytime_recovery: number | null
          resilience_level: string | null
          resilience_sleep_recovery: number | null
          sedentary_minutes: number | null
          sleep_duration_seconds: number | null
          sleep_efficiency: number | null
          sleep_latency_seconds: number | null
          sleep_score: number | null
          steps: number | null
          stress_day_summary: string | null
          stress_high_minutes: number | null
          synced_at: string | null
          total_calories: number | null
          user_id: string
        }
        Insert: {
          active_calories?: number | null
          active_minutes?: number | null
          activity_score?: number | null
          awake_seconds?: number | null
          bedtime_end?: string | null
          bedtime_start?: string | null
          connection_id: string
          day: string
          deep_sleep_seconds?: number | null
          id?: string
          light_sleep_seconds?: number | null
          raw_data?: Json | null
          readiness_hrv_balance?: number | null
          readiness_resting_heart_rate?: number | null
          readiness_score?: number | null
          readiness_temperature_deviation?: number | null
          recovery_high_minutes?: number | null
          rem_sleep_seconds?: number | null
          resilience_daytime_recovery?: number | null
          resilience_level?: string | null
          resilience_sleep_recovery?: number | null
          sedentary_minutes?: number | null
          sleep_duration_seconds?: number | null
          sleep_efficiency?: number | null
          sleep_latency_seconds?: number | null
          sleep_score?: number | null
          steps?: number | null
          stress_day_summary?: string | null
          stress_high_minutes?: number | null
          synced_at?: string | null
          total_calories?: number | null
          user_id: string
        }
        Update: {
          active_calories?: number | null
          active_minutes?: number | null
          activity_score?: number | null
          awake_seconds?: number | null
          bedtime_end?: string | null
          bedtime_start?: string | null
          connection_id?: string
          day?: string
          deep_sleep_seconds?: number | null
          id?: string
          light_sleep_seconds?: number | null
          raw_data?: Json | null
          readiness_hrv_balance?: number | null
          readiness_resting_heart_rate?: number | null
          readiness_score?: number | null
          readiness_temperature_deviation?: number | null
          recovery_high_minutes?: number | null
          rem_sleep_seconds?: number | null
          resilience_daytime_recovery?: number | null
          resilience_level?: string | null
          resilience_sleep_recovery?: number | null
          sedentary_minutes?: number | null
          sleep_duration_seconds?: number | null
          sleep_efficiency?: number | null
          sleep_latency_seconds?: number | null
          sleep_score?: number | null
          steps?: number | null
          stress_day_summary?: string | null
          stress_high_minutes?: number | null
          synced_at?: string | null
          total_calories?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oura_daily_data_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "oura_connections"
            referencedColumns: ["id"]
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
          couple_id: string | null
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
          couple_id?: string | null
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
          couple_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "user_memories_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
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
      add_member_to_space: {
        Args: {
          p_couple_id: string
          p_display_name: string
          p_role?: Database["public"]["Enums"]["member_role"]
          p_user_id: string
        }
        Returns: string
      }
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
      find_shared_entities: {
        Args: { p_couple_id: string; p_min_similarity?: number }
        Returns: {
          entity_a_id: string
          entity_a_name: string
          entity_a_user: string
          entity_b_id: string
          entity_b_name: string
          entity_b_user: string
          entity_type: string
          name_similarity: number
        }[]
      }
      find_similar_chunks: {
        Args: {
          p_embedding: string
          p_limit?: number
          p_threshold?: number
          p_user_id: string
        }
        Returns: {
          chunk_type: string
          content: string
          created_at: string
          id: string
          importance: number
          similarity: number
          source: string
        }[]
      }
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
      get_active_compilation_users: {
        Args: never
        Returns: {
          note_count: number
          user_id: string
        }[]
      }
      get_clerk_user_id: { Args: never; Returns: string }
      get_couple_compiled_files: {
        Args: { p_couple_id: string; p_file_types?: string[] }
        Returns: {
          content: string
          content_hash: string
          file_type: string
          id: string
          token_count: number
          updated_at: string
          user_id: string
        }[]
      }
      get_decay_candidates: {
        Args: { p_limit?: number; p_stale_days?: number; p_user_id: string }
        Returns: {
          content: string
          created_at: string
          days_stale: number
          decay_factor: number
          id: string
          importance: number
          last_accessed_at: string
        }[]
      }
      get_memory_health: { Args: { p_user_id: string }; Returns: Json }
      get_partner_task_patterns: {
        Args: { p_couple_id: string; p_days?: number }
        Returns: {
          category: string
          completed_tasks: number
          completion_rate: number
          display_name: string
          total_tasks: number
          user_id: string
        }[]
      }
      get_space_members: {
        Args: { p_couple_id: string }
        Returns: {
          display_name: string
          joined_at: string
          member_id: string
          profile_display_name: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: boolean
      }
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
      is_couple_owner_safe: {
        Args: { p_couple_id: string; p_user_id: string }
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
      normalize_category: { Args: { raw_category: string }; Returns: string }
      search_entities: {
        Args: {
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
          p_user_id: string
        }
        Returns: {
          canonical_name: string
          entity_type: string
          id: string
          mention_count: number
          metadata: Json
          name: string
          similarity: number
        }[]
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
      app_role: "admin" | "user"
      expense_split_type:
        | "you_paid_split"
        | "you_owed_full"
        | "partner_paid_split"
        | "partner_owed_full"
        | "individual"
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
      app_role: ["admin", "user"],
      expense_split_type: [
        "you_paid_split",
        "you_owed_full",
        "partner_paid_split",
        "partner_owed_full",
        "individual",
      ],
      invite_status: ["pending", "accepted", "revoked"],
      member_role: ["owner", "member"],
      note_priority: ["low", "medium", "high"],
    },
  },
} as const
