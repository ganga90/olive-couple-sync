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
          assigned_to: string | null
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
          space_id: string | null
          summary: string
          tags: string[] | null
          task_owner: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
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
          space_id?: string | null
          summary: string
          tags?: string[] | null
          task_owner?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
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
          space_id?: string | null
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
          {
            foreignKeyName: "clerk_notes_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
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
      note_mentions: {
        Row: {
          created_at: string
          id: string
          mentioned_by: string
          mentioned_user_id: string
          note_id: string | null
          read_at: string | null
          space_id: string | null
          thread_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mentioned_by: string
          mentioned_user_id: string
          note_id?: string | null
          read_at?: string | null
          space_id?: string | null
          thread_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mentioned_by?: string
          mentioned_user_id?: string
          note_id?: string | null
          read_at?: string | null
          space_id?: string | null
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "note_mentions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "clerk_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "note_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      note_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          note_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          note_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          note_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_reactions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "clerk_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      note_threads: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          note_id: string
          parent_id: string | null
          space_id: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          note_id: string
          parent_id?: string | null
          space_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          note_id?: string
          parent_id?: string | null
          space_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_threads_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "clerk_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_threads_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "note_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_threads_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
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
      olive_agent_executions: {
        Row: {
          agent_id: string
          agent_name: string | null
          checkpoint: Json | null
          completed_at: string | null
          current_step: number
          error_message: string | null
          id: string
          input_payload: Json
          max_retries: number | null
          next_retry_at: string | null
          output: Json | null
          queued_at: string
          required_trust_level: number | null
          retry_count: number | null
          space_id: string | null
          started_at: string | null
          status: string
          steps: Json
          total_steps: number
          trust_action_id: string | null
          user_id: string
        }
        Insert: {
          agent_id: string
          agent_name?: string | null
          checkpoint?: Json | null
          completed_at?: string | null
          current_step?: number
          error_message?: string | null
          id?: string
          input_payload?: Json
          max_retries?: number | null
          next_retry_at?: string | null
          output?: Json | null
          queued_at?: string
          required_trust_level?: number | null
          retry_count?: number | null
          space_id?: string | null
          started_at?: string | null
          status?: string
          steps?: Json
          total_steps?: number
          trust_action_id?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          agent_name?: string | null
          checkpoint?: Json | null
          completed_at?: string | null
          current_step?: number
          error_message?: string | null
          id?: string
          input_payload?: Json
          max_retries?: number | null
          next_retry_at?: string | null
          output?: Json | null
          queued_at?: string
          required_trust_level?: number | null
          retry_count?: number | null
          space_id?: string | null
          started_at?: string | null
          status?: string
          steps?: Json
          total_steps?: number
          trust_action_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_agent_executions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olive_agent_executions_trust_action_id_fkey"
            columns: ["trust_action_id"]
            isOneToOne: false
            referencedRelation: "olive_trust_actions"
            referencedColumns: ["id"]
          },
        ]
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
      olive_briefings: {
        Row: {
          briefing_type: string
          covers_from: string | null
          covers_to: string | null
          created_at: string
          delegation_count: number | null
          delivered_via: string[] | null
          id: string
          read_at: string | null
          sections: Json
          space_id: string | null
          summary: string
          task_count: number | null
          title: string
          user_id: string
        }
        Insert: {
          briefing_type?: string
          covers_from?: string | null
          covers_to?: string | null
          created_at?: string
          delegation_count?: number | null
          delivered_via?: string[] | null
          id?: string
          read_at?: string | null
          sections?: Json
          space_id?: string | null
          summary: string
          task_count?: number | null
          title: string
          user_id: string
        }
        Update: {
          briefing_type?: string
          covers_from?: string | null
          covers_to?: string | null
          created_at?: string
          delegation_count?: number | null
          delivered_via?: string[] | null
          id?: string
          read_at?: string | null
          sections?: Json
          space_id?: string | null
          summary?: string
          task_count?: number | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_briefings_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
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
      olive_client_activity: {
        Row: {
          activity_type: string
          client_id: string
          created_at: string
          description: string | null
          from_value: string | null
          id: string
          metadata: Json | null
          to_value: string | null
          user_id: string
        }
        Insert: {
          activity_type: string
          client_id: string
          created_at?: string
          description?: string | null
          from_value?: string | null
          id?: string
          metadata?: Json | null
          to_value?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string
          client_id?: string
          created_at?: string
          description?: string | null
          from_value?: string | null
          id?: string
          metadata?: Json | null
          to_value?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_client_activity_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "olive_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_clients: {
        Row: {
          actual_value: number | null
          company: string | null
          created_at: string
          currency: string
          email: string | null
          estimated_value: number | null
          follow_up_date: string | null
          id: string
          is_archived: boolean
          last_contact: string | null
          metadata: Json | null
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          space_id: string
          stage: string
          stage_changed_at: string
          tags: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_value?: number | null
          company?: string | null
          created_at?: string
          currency?: string
          email?: string | null
          estimated_value?: number | null
          follow_up_date?: string | null
          id?: string
          is_archived?: boolean
          last_contact?: string | null
          metadata?: Json | null
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          space_id: string
          stage?: string
          stage_changed_at?: string
          tags?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_value?: number | null
          company?: string | null
          created_at?: string
          currency?: string
          email?: string | null
          estimated_value?: number | null
          follow_up_date?: string | null
          id?: string
          is_archived?: boolean
          last_contact?: string | null
          metadata?: Json | null
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          space_id?: string
          stage?: string
          stage_changed_at?: string
          tags?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_clients_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_conflicts: {
        Row: {
          conflict_type: string
          description: string | null
          detected_at: string
          entity_a_id: string
          entity_a_type: string
          entity_b_id: string
          entity_b_type: string
          id: string
          metadata: Json | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          space_id: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          conflict_type: string
          description?: string | null
          detected_at?: string
          entity_a_id: string
          entity_a_type: string
          entity_b_id: string
          entity_b_type: string
          id?: string
          metadata?: Json | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          space_id: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          conflict_type?: string
          description?: string | null
          detected_at?: string
          entity_a_id?: string
          entity_a_type?: string
          entity_b_id?: string
          entity_b_type?: string
          id?: string
          metadata?: Json | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          space_id?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_conflicts_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_consolidation_runs: {
        Row: {
          chunks_compacted: number | null
          completed_at: string | null
          daily_logs_compacted: number | null
          error_message: string | null
          id: string
          memories_archived: number | null
          memories_deduplicated: number | null
          memories_merged: number | null
          memories_scanned: number | null
          merge_details: Json | null
          run_type: string
          started_at: string
          status: string
          token_savings: number | null
          user_id: string
        }
        Insert: {
          chunks_compacted?: number | null
          completed_at?: string | null
          daily_logs_compacted?: number | null
          error_message?: string | null
          id?: string
          memories_archived?: number | null
          memories_deduplicated?: number | null
          memories_merged?: number | null
          memories_scanned?: number | null
          merge_details?: Json | null
          run_type?: string
          started_at?: string
          status?: string
          token_savings?: number | null
          user_id: string
        }
        Update: {
          chunks_compacted?: number | null
          completed_at?: string | null
          daily_logs_compacted?: number | null
          error_message?: string | null
          id?: string
          memories_archived?: number | null
          memories_deduplicated?: number | null
          memories_merged?: number | null
          memories_scanned?: number | null
          merge_details?: Json | null
          run_type?: string
          started_at?: string
          status?: string
          token_savings?: number | null
          user_id?: string
        }
        Relationships: []
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
      olive_cross_space_insights: {
        Row: {
          confidence: number | null
          created_at: string
          description: string
          expires_at: string | null
          id: string
          insight_type: string
          metadata: Json | null
          source_spaces: Json
          status: string
          suggestion: string | null
          title: string
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          description: string
          expires_at?: string | null
          id?: string
          insight_type: string
          metadata?: Json | null
          source_spaces?: Json
          status?: string
          suggestion?: string | null
          title: string
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          description?: string
          expires_at?: string | null
          id?: string
          insight_type?: string
          metadata?: Json | null
          source_spaces?: Json
          status?: string
          suggestion?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      olive_decisions: {
        Row: {
          alternatives: Json | null
          category: string | null
          context: string | null
          created_at: string
          decision_date: string
          description: string | null
          id: string
          is_archived: boolean
          outcome: string | null
          outcome_date: string | null
          participants: Json | null
          rationale: string | null
          related_note_ids: Json | null
          space_id: string
          status: string
          tags: Json | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alternatives?: Json | null
          category?: string | null
          context?: string | null
          created_at?: string
          decision_date?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          outcome?: string | null
          outcome_date?: string | null
          participants?: Json | null
          rationale?: string | null
          related_note_ids?: Json | null
          space_id: string
          status?: string
          tags?: Json | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alternatives?: Json | null
          category?: string | null
          context?: string | null
          created_at?: string
          decision_date?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          outcome?: string | null
          outcome_date?: string | null
          participants?: Json | null
          rationale?: string | null
          related_note_ids?: Json | null
          space_id?: string
          status?: string
          tags?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_decisions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_delegations: {
        Row: {
          agent_execution_id: string | null
          completed_at: string | null
          created_at: string
          delegated_by: string
          delegated_to: string
          description: string | null
          id: string
          last_notified_at: string | null
          note_id: string | null
          notified_via: string[] | null
          priority: string | null
          reasoning: string | null
          reassign_reason: string | null
          reassigned_to: string | null
          reminder_count: number | null
          responded_at: string | null
          response_note: string | null
          snoozed_until: string | null
          space_id: string
          status: string
          suggested_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agent_execution_id?: string | null
          completed_at?: string | null
          created_at?: string
          delegated_by: string
          delegated_to: string
          description?: string | null
          id?: string
          last_notified_at?: string | null
          note_id?: string | null
          notified_via?: string[] | null
          priority?: string | null
          reasoning?: string | null
          reassign_reason?: string | null
          reassigned_to?: string | null
          reminder_count?: number | null
          responded_at?: string | null
          response_note?: string | null
          snoozed_until?: string | null
          space_id: string
          status?: string
          suggested_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agent_execution_id?: string | null
          completed_at?: string | null
          created_at?: string
          delegated_by?: string
          delegated_to?: string
          description?: string | null
          id?: string
          last_notified_at?: string | null
          note_id?: string | null
          notified_via?: string[] | null
          priority?: string | null
          reasoning?: string | null
          reassign_reason?: string | null
          reassigned_to?: string | null
          reminder_count?: number | null
          responded_at?: string | null
          response_note?: string | null
          snoozed_until?: string | null
          space_id?: string
          status?: string
          suggested_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_delegations_agent_execution_id_fkey"
            columns: ["agent_execution_id"]
            isOneToOne: false
            referencedRelation: "olive_agent_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olive_delegations_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
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
      olive_engagement_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      olive_engagement_metrics: {
        Row: {
          avg_response_time_seconds: number | null
          last_interaction: string | null
          messages_responded_7d: number
          messages_sent_7d: number
          proactive_accepted_7d: number
          proactive_ignored_7d: number
          proactive_rejected_7d: number
          score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_response_time_seconds?: number | null
          last_interaction?: string | null
          messages_responded_7d?: number
          messages_sent_7d?: number
          proactive_accepted_7d?: number
          proactive_ignored_7d?: number
          proactive_rejected_7d?: number
          score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_response_time_seconds?: number | null
          last_interaction?: string | null
          messages_responded_7d?: number
          messages_sent_7d?: number
          proactive_accepted_7d?: number
          proactive_ignored_7d?: number
          proactive_rejected_7d?: number
          score?: number
          updated_at?: string
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
      olive_expense_split_shares: {
        Row: {
          amount: number
          id: string
          is_paid: boolean
          paid_at: string | null
          percentage: number | null
          split_id: string
          user_id: string
        }
        Insert: {
          amount: number
          id?: string
          is_paid?: boolean
          paid_at?: string | null
          percentage?: number | null
          split_id: string
          user_id: string
        }
        Update: {
          amount?: number
          id?: string
          is_paid?: boolean
          paid_at?: string | null
          percentage?: number | null
          split_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_expense_split_shares_split_id_fkey"
            columns: ["split_id"]
            isOneToOne: false
            referencedRelation: "olive_expense_splits"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_expense_splits: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          description: string
          id: string
          is_settled: boolean
          settled_at: string | null
          space_id: string
          split_type: string
          total_amount: number
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          currency?: string
          description: string
          id?: string
          is_settled?: boolean
          settled_at?: string | null
          space_id: string
          split_type?: string
          total_amount: number
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          description?: string
          id?: string
          is_settled?: boolean
          settled_at?: string | null
          space_id?: string
          split_type?: string
          total_amount?: number
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_expense_splits_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
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
      olive_industry_templates: {
        Row: {
          budget_categories: Json
          created_at: string
          description: string | null
          icon: string | null
          id: string
          industry: string
          is_active: boolean
          lists: Json
          name: string
          note_categories: Json
          proactive_rules: Json
          skills: Json
          soul_hints: Json
          updated_at: string
          version: number
        }
        Insert: {
          budget_categories?: Json
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          industry: string
          is_active?: boolean
          lists?: Json
          name: string
          note_categories?: Json
          proactive_rules?: Json
          skills?: Json
          soul_hints?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          budget_categories?: Json
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          industry?: string
          is_active?: boolean
          lists?: Json
          name?: string
          note_categories?: Json
          proactive_rules?: Json
          skills?: Json
          soul_hints?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      olive_llm_calls: {
        Row: {
          cost_usd: number | null
          created_at: string
          error_message: string | null
          function_name: string
          id: string
          latency_ms: number | null
          metadata: Json | null
          model: string
          prompt_version: string | null
          status: string
          tokens_in: number | null
          tokens_out: number | null
          user_id: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          function_name: string
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          model: string
          prompt_version?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          function_name?: string
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          model?: string
          prompt_version?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string | null
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
          space_id: string | null
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
          space_id?: string | null
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
          space_id?: string | null
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
      olive_memory_relevance: {
        Row: {
          access_count: number | null
          archive_reason: string | null
          archived_at: string | null
          created_at: string
          decay_rate: number | null
          id: string
          is_archived: boolean | null
          last_accessed_at: string | null
          memory_id: string
          relevance_score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          access_count?: number | null
          archive_reason?: string | null
          archived_at?: string | null
          created_at?: string
          decay_rate?: number | null
          id?: string
          is_archived?: boolean | null
          last_accessed_at?: string | null
          memory_id: string
          relevance_score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          access_count?: number | null
          archive_reason?: string | null
          archived_at?: string | null
          created_at?: string
          decay_rate?: number | null
          id?: string
          is_archived?: boolean | null
          last_accessed_at?: string | null
          memory_id?: string
          relevance_score?: number
          updated_at?: string
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
          space_id: string | null
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
          space_id?: string | null
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
          space_id?: string | null
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
      olive_poll_votes: {
        Row: {
          id: string
          option_ids: Json
          poll_id: string
          ranking: Json | null
          user_id: string
          voted_at: string
        }
        Insert: {
          id?: string
          option_ids?: Json
          poll_id: string
          ranking?: Json | null
          user_id: string
          voted_at?: string
        }
        Update: {
          id?: string
          option_ids?: Json
          poll_id?: string
          ranking?: Json | null
          user_id?: string
          voted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "olive_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_polls: {
        Row: {
          allow_add_options: boolean
          anonymous: boolean
          closes_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          options: Json
          poll_type: string
          question: string
          space_id: string
          status: string
          updated_at: string
        }
        Insert: {
          allow_add_options?: boolean
          anonymous?: boolean
          closes_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          options?: Json
          poll_type?: string
          question: string
          space_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          allow_add_options?: boolean
          anonymous?: boolean
          closes_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          options?: Json
          poll_type?: string
          question?: string
          space_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_polls_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_pricing_plans: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          is_popular: boolean
          max_ai_requests_per_day: number
          max_file_storage_mb: number
          max_members_per_space: number
          max_notes_per_month: number
          max_spaces: number
          max_whatsapp_messages_per_day: number
          name: string
          plan_id: string
          price_monthly_cents: number
          price_yearly_cents: number
          sort_order: number
          stripe_price_id_monthly: string | null
          stripe_price_id_yearly: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          is_popular?: boolean
          max_ai_requests_per_day?: number
          max_file_storage_mb?: number
          max_members_per_space?: number
          max_notes_per_month?: number
          max_spaces?: number
          max_whatsapp_messages_per_day?: number
          name: string
          plan_id: string
          price_monthly_cents?: number
          price_yearly_cents?: number
          sort_order?: number
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          is_popular?: boolean
          max_ai_requests_per_day?: number
          max_file_storage_mb?: number
          max_members_per_space?: number
          max_notes_per_month?: number
          max_spaces?: number
          max_whatsapp_messages_per_day?: number
          name?: string
          plan_id?: string
          price_monthly_cents?: number
          price_yearly_cents?: number
          sort_order?: number
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
        }
        Relationships: []
      }
      olive_reflections: {
        Row: {
          action_detail: Json | null
          action_type: string
          applied_to_soul: boolean
          confidence: number | null
          created_at: string
          id: string
          lesson: string | null
          outcome: string
          space_id: string | null
          user_id: string
          user_modification: string | null
        }
        Insert: {
          action_detail?: Json | null
          action_type: string
          applied_to_soul?: boolean
          confidence?: number | null
          created_at?: string
          id?: string
          lesson?: string | null
          outcome: string
          space_id?: string | null
          user_id: string
          user_modification?: string | null
        }
        Update: {
          action_detail?: Json | null
          action_type?: string
          applied_to_soul?: boolean
          confidence?: number | null
          created_at?: string
          id?: string
          lesson?: string | null
          outcome?: string
          space_id?: string | null
          user_id?: string
          user_modification?: string | null
        }
        Relationships: []
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
      olive_soul_evolution_log: {
        Row: {
          changes_summary: string[] | null
          created_at: string
          drift_details: Json | null
          drift_score: number | null
          id: string
          layer_type: string
          post_snapshot_version: number | null
          pre_snapshot_version: number | null
          proposals_applied: number | null
          proposals_blocked: number | null
          proposals_count: number | null
          proposals_deferred: number | null
          rollback_reason: string | null
          rollback_to_version: number | null
          trigger: string | null
          user_id: string
          was_rate_limited: boolean | null
          was_rollback: boolean | null
        }
        Insert: {
          changes_summary?: string[] | null
          created_at?: string
          drift_details?: Json | null
          drift_score?: number | null
          id?: string
          layer_type: string
          post_snapshot_version?: number | null
          pre_snapshot_version?: number | null
          proposals_applied?: number | null
          proposals_blocked?: number | null
          proposals_count?: number | null
          proposals_deferred?: number | null
          rollback_reason?: string | null
          rollback_to_version?: number | null
          trigger?: string | null
          user_id: string
          was_rate_limited?: boolean | null
          was_rollback?: boolean | null
        }
        Update: {
          changes_summary?: string[] | null
          created_at?: string
          drift_details?: Json | null
          drift_score?: number | null
          id?: string
          layer_type?: string
          post_snapshot_version?: number | null
          pre_snapshot_version?: number | null
          proposals_applied?: number | null
          proposals_blocked?: number | null
          proposals_count?: number | null
          proposals_deferred?: number | null
          rollback_reason?: string | null
          rollback_to_version?: number | null
          trigger?: string | null
          user_id?: string
          was_rate_limited?: boolean | null
          was_rollback?: boolean | null
        }
        Relationships: []
      }
      olive_soul_layers: {
        Row: {
          content: Json
          content_rendered: string | null
          created_at: string
          evolved_at: string
          id: string
          is_locked: boolean
          layer_type: string
          owner_id: string | null
          owner_type: string
          token_count: number | null
          version: number
        }
        Insert: {
          content?: Json
          content_rendered?: string | null
          created_at?: string
          evolved_at?: string
          id?: string
          is_locked?: boolean
          layer_type: string
          owner_id?: string | null
          owner_type: string
          token_count?: number | null
          version?: number
        }
        Update: {
          content?: Json
          content_rendered?: string | null
          created_at?: string
          evolved_at?: string
          id?: string
          is_locked?: boolean
          layer_type?: string
          owner_id?: string | null
          owner_type?: string
          token_count?: number | null
          version?: number
        }
        Relationships: []
      }
      olive_soul_rollbacks: {
        Row: {
          applied_at: string | null
          created_at: string
          error_message: string | null
          from_version: number
          id: string
          layer_id: string
          layer_type: string
          reason: string
          requested_by: string
          status: string
          to_version: number
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          error_message?: string | null
          from_version: number
          id?: string
          layer_id: string
          layer_type: string
          reason: string
          requested_by?: string
          status?: string
          to_version: number
          user_id: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          error_message?: string | null
          from_version?: number
          id?: string
          layer_id?: string
          layer_type?: string
          reason?: string
          requested_by?: string
          status?: string
          to_version?: number
          user_id?: string
        }
        Relationships: []
      }
      olive_soul_versions: {
        Row: {
          change_summary: string | null
          content: Json
          content_rendered: string | null
          created_at: string
          id: string
          layer_id: string
          trigger: string | null
          version: number
        }
        Insert: {
          change_summary?: string | null
          content: Json
          content_rendered?: string | null
          created_at?: string
          id?: string
          layer_id: string
          trigger?: string | null
          version: number
        }
        Update: {
          change_summary?: string | null
          content?: Json
          content_rendered?: string | null
          created_at?: string
          id?: string
          layer_id?: string
          trigger?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "olive_soul_versions_layer_id_fkey"
            columns: ["layer_id"]
            isOneToOne: false
            referencedRelation: "olive_soul_layers"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_space_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string | null
          role: Database["public"]["Enums"]["space_role"]
          space_id: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invited_by: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["space_role"]
          space_id: string
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["space_role"]
          space_id?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_space_invites_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_space_members: {
        Row: {
          id: string
          joined_at: string
          nickname: string | null
          role: Database["public"]["Enums"]["space_role"]
          space_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          nickname?: string | null
          role?: Database["public"]["Enums"]["space_role"]
          space_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          nickname?: string | null
          role?: Database["public"]["Enums"]["space_role"]
          space_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_space_members_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_space_templates: {
        Row: {
          applied_at: string
          applied_by: string
          config_overrides: Json | null
          id: string
          space_id: string
          template_id: string
        }
        Insert: {
          applied_at?: string
          applied_by: string
          config_overrides?: Json | null
          id?: string
          space_id: string
          template_id: string
        }
        Update: {
          applied_at?: string
          applied_by?: string
          config_overrides?: Json | null
          id?: string
          space_id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_space_templates_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olive_space_templates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "olive_industry_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_spaces: {
        Row: {
          couple_id: string | null
          created_at: string
          created_by: string
          icon: string | null
          id: string
          max_members: number
          name: string
          settings: Json
          type: Database["public"]["Enums"]["space_type"]
          updated_at: string
        }
        Insert: {
          couple_id?: string | null
          created_at?: string
          created_by: string
          icon?: string | null
          id?: string
          max_members?: number
          name?: string
          settings?: Json
          type?: Database["public"]["Enums"]["space_type"]
          updated_at?: string
        }
        Update: {
          couple_id?: string | null
          created_at?: string
          created_by?: string
          icon?: string | null
          id?: string
          max_members?: number
          name?: string
          settings?: Json
          type?: Database["public"]["Enums"]["space_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_spaces_couple_id_fkey"
            columns: ["couple_id"]
            isOneToOne: false
            referencedRelation: "clerk_couples"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_subscriptions: {
        Row: {
          billing_cycle: string
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json | null
          plan_id: string
          revenucat_subscriber_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_cycle?: string
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json | null
          plan_id: string
          revenucat_subscriber_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_cycle?: string
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json | null
          plan_id?: string
          revenucat_subscriber_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      olive_trust_actions: {
        Row: {
          action_description: string
          action_payload: Json
          action_type: string
          created_at: string
          executed_at: string | null
          execution_result: Json | null
          expires_at: string
          id: string
          required_level: number
          responded_at: string | null
          space_id: string | null
          status: string
          trigger_context: Json | null
          trigger_type: string | null
          trust_level: number
          user_id: string
          user_response: string | null
        }
        Insert: {
          action_description: string
          action_payload?: Json
          action_type: string
          created_at?: string
          executed_at?: string | null
          execution_result?: Json | null
          expires_at?: string
          id?: string
          required_level?: number
          responded_at?: string | null
          space_id?: string | null
          status?: string
          trigger_context?: Json | null
          trigger_type?: string | null
          trust_level?: number
          user_id: string
          user_response?: string | null
        }
        Update: {
          action_description?: string
          action_payload?: Json
          action_type?: string
          created_at?: string
          executed_at?: string | null
          execution_result?: Json | null
          expires_at?: string
          id?: string
          required_level?: number
          responded_at?: string | null
          space_id?: string | null
          status?: string
          trigger_context?: Json | null
          trigger_type?: string | null
          trust_level?: number
          user_id?: string
          user_response?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "olive_trust_actions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_trust_notifications: {
        Row: {
          acted_on_at: string | null
          body: string
          created_at: string
          dismissed_at: string | null
          id: string
          metadata: Json
          read_at: string | null
          title: string
          trust_action_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          acted_on_at?: string | null
          body: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          metadata?: Json
          read_at?: string | null
          title: string
          trust_action_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          acted_on_at?: string | null
          body?: string
          created_at?: string
          dismissed_at?: string | null
          id?: string
          metadata?: Json
          read_at?: string | null
          title?: string
          trust_action_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_trust_notifications_trust_action_id_fkey"
            columns: ["trust_action_id"]
            isOneToOne: false
            referencedRelation: "olive_trust_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_usage_meters: {
        Row: {
          ai_requests: number
          created_at: string
          delegations_created: number
          file_storage_bytes: number
          file_uploads: number
          id: string
          meter_date: string
          notes_created: number
          search_queries: number
          updated_at: string
          user_id: string
          whatsapp_messages_received: number
          whatsapp_messages_sent: number
          workflow_runs: number
        }
        Insert: {
          ai_requests?: number
          created_at?: string
          delegations_created?: number
          file_storage_bytes?: number
          file_uploads?: number
          id?: string
          meter_date?: string
          notes_created?: number
          search_queries?: number
          updated_at?: string
          user_id: string
          whatsapp_messages_received?: number
          whatsapp_messages_sent?: number
          workflow_runs?: number
        }
        Update: {
          ai_requests?: number
          created_at?: string
          delegations_created?: number
          file_storage_bytes?: number
          file_uploads?: number
          id?: string
          meter_date?: string
          notes_created?: number
          search_queries?: number
          updated_at?: string
          user_id?: string
          whatsapp_messages_received?: number
          whatsapp_messages_sent?: number
          workflow_runs?: number
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
          plan_id: string | null
          proactive_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          reminder_advance_intervals: string[]
          soul_enabled: boolean
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
          plan_id?: string | null
          proactive_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reminder_advance_intervals?: string[]
          soul_enabled?: boolean
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
          plan_id?: string | null
          proactive_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          reminder_advance_intervals?: string[]
          soul_enabled?: boolean
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
      olive_workflow_instances: {
        Row: {
          config: Json | null
          created_at: string
          enabled_by: string
          id: string
          is_enabled: boolean
          last_run_at: string | null
          last_run_status: string | null
          run_count: number
          schedule_override: string | null
          space_id: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          enabled_by: string
          id?: string
          is_enabled?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          run_count?: number
          schedule_override?: string | null
          space_id: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          enabled_by?: string
          id?: string
          is_enabled?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          run_count?: number
          schedule_override?: string | null
          space_id?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_workflow_instances_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olive_workflow_instances_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "olive_workflow_templates"
            referencedColumns: ["workflow_id"]
          },
        ]
      }
      olive_workflow_runs: {
        Row: {
          completed_at: string | null
          error: string | null
          id: string
          instance_id: string
          output: Json | null
          space_id: string
          started_at: string
          status: string
          steps_completed: number | null
          steps_total: number | null
          triggered_by: string
          workflow_id: string
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          id?: string
          instance_id: string
          output?: Json | null
          space_id: string
          started_at?: string
          status?: string
          steps_completed?: number | null
          steps_total?: number | null
          triggered_by?: string
          workflow_id: string
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          id?: string
          instance_id?: string
          output?: Json | null
          space_id?: string
          started_at?: string
          status?: string
          steps_completed?: number | null
          steps_total?: number | null
          triggered_by?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "olive_workflow_runs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "olive_workflow_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      olive_workflow_templates: {
        Row: {
          applicable_space_types: Json | null
          category: string
          created_at: string
          default_schedule: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          is_builtin: boolean
          min_space_members: number | null
          name: string
          output_channel: string
          output_type: string
          requires_feature: Json | null
          schedule_options: Json | null
          steps: Json
          updated_at: string
          workflow_id: string
        }
        Insert: {
          applicable_space_types?: Json | null
          category?: string
          created_at?: string
          default_schedule: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_builtin?: boolean
          min_space_members?: number | null
          name: string
          output_channel?: string
          output_type?: string
          requires_feature?: Json | null
          schedule_options?: Json | null
          steps?: Json
          updated_at?: string
          workflow_id: string
        }
        Update: {
          applicable_space_types?: Json | null
          category?: string
          created_at?: string
          default_schedule?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_builtin?: boolean
          min_space_members?: number | null
          name?: string
          output_channel?: string
          output_type?: string
          requires_feature?: Json | null
          schedule_options?: Json | null
          steps?: Json
          updated_at?: string
          workflow_id?: string
        }
        Relationships: []
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
      space_activity: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          space_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          space_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "space_activity_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "olive_spaces"
            referencedColumns: ["id"]
          },
        ]
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
      olive_llm_analytics: {
        Row: {
          avg_latency_ms: number | null
          call_count: number | null
          day: string | null
          error_count: number | null
          function_name: string | null
          model: string | null
          p95_latency_ms: number | null
          total_cost_usd: number | null
          total_tokens_in: number | null
          total_tokens_out: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string }
      accept_space_invite: {
        Args: { p_token: string }
        Returns: {
          id: string
          joined_at: string
          nickname: string | null
          role: Database["public"]["Enums"]["space_role"]
          space_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "olive_space_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_member_to_space: {
        Args: {
          p_couple_id: string
          p_display_name: string
          p_role?: Database["public"]["Enums"]["member_role"]
          p_user_id: string
        }
        Returns: string
      }
      apply_memory_decay: {
        Args: { p_archive_threshold?: number; p_user_id: string }
        Returns: number
      }
      boost_memory_relevance: {
        Args: { p_boost?: number; p_memory_id: string; p_user_id: string }
        Returns: undefined
      }
      check_quota: {
        Args: { p_meter: string; p_user_id: string }
        Returns: {
          current_usage: number
          is_within_quota: boolean
          max_allowed: number
        }[]
      }
      cleanup_expired_linking_tokens: { Args: never; Returns: undefined }
      compute_engagement_score: { Args: { p_user_id: string }; Returns: number }
      create_couple: {
        Args: { p_partner_name: string; p_title: string; p_you_name: string }
        Returns: string
      }
      create_invite: {
        Args: { p_couple_id: string; p_invited_email?: string }
        Returns: Json
      }
      create_space: {
        Args: {
          p_icon?: string
          p_name: string
          p_settings?: Json
          p_type?: string
        }
        Returns: {
          couple_id: string | null
          created_at: string
          created_by: string
          icon: string | null
          id: string
          max_members: number
          name: string
          settings: Json
          type: Database["public"]["Enums"]["space_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "olive_spaces"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_space_invite: {
        Args: { p_invited_email?: string; p_role?: string; p_space_id: string }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string | null
          role: Database["public"]["Enums"]["space_role"]
          space_id: string
          status: string
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "olive_space_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      debug_claims: { Args: never; Returns: Json }
      debug_clerk_jwt: { Args: never; Returns: string }
      debug_clerk_user_id: { Args: never; Returns: string }
      debug_clerk_user_id_fixed: { Args: never; Returns: string }
      debug_jwt_claims: { Args: never; Returns: Json }
      expire_old_trust_actions: { Args: never; Returns: undefined }
      fetch_top_memory_chunks: {
        Args: { p_limit?: number; p_min_importance?: number; p_user_id: string }
        Returns: {
          chunk_type: string
          content: string
          created_at: string
          decay_factor: number
          id: string
          importance: number
          source: string
        }[]
      }
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
      get_chunks_needing_embeddings: {
        Args: { p_limit?: number }
        Returns: {
          content: string
          id: string
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
      get_notes_needing_embeddings: {
        Args: { p_limit?: number }
        Returns: {
          content: string
          id: string
          user_id: string
        }[]
      }
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
      get_user_spaces: {
        Args: never
        Returns: {
          couple_id: string
          created_at: string
          created_by: string
          icon: string
          id: string
          max_members: number
          member_count: number
          name: string
          settings: Json
          type: Database["public"]["Enums"]["space_type"]
          updated_at: string
          user_role: Database["public"]["Enums"]["space_role"]
        }[]
      }
      has_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: boolean
      }
      hybrid_search_notes: {
        Args: {
          p_couple_id: string
          p_limit?: number
          p_query: string
          p_query_embedding: string
          p_user_id: string
          p_vector_weight?: number
        }
        Returns: {
          category: string
          completed: boolean
          due_date: string
          id: string
          original_text: string
          priority: string
          score: number
          summary: string
        }[]
      }
      increment_usage: {
        Args: { p_amount?: number; p_meter: string; p_user_id: string }
        Returns: undefined
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
      is_space_member: {
        Args: { p_space_id: string; p_user_id: string }
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
      search_memory_chunks: {
        Args: {
          p_limit?: number
          p_min_importance?: number
          p_query_embedding: string
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
      space_role: "owner" | "admin" | "member"
      space_type: "couple" | "family" | "household" | "business" | "custom"
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
      space_role: ["owner", "admin", "member"],
      space_type: ["couple", "family", "household", "business", "custom"],
    },
  },
} as const
