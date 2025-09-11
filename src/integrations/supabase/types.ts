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
          couple_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          invited_email: string | null
          status: string
          token: string
        }
        Insert: {
          couple_id: string
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          invited_email?: string | null
          status?: string
          token: string
        }
        Update: {
          couple_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          invited_email?: string | null
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
          category: string
          completed: boolean
          couple_id: string | null
          created_at: string
          due_date: string | null
          id: string
          items: string[] | null
          list_id: string | null
          original_text: string
          priority: Database["public"]["Enums"]["note_priority"] | null
          summary: string
          tags: string[] | null
          task_owner: string | null
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          category: string
          completed?: boolean
          couple_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          items?: string[] | null
          list_id?: string | null
          original_text: string
          priority?: Database["public"]["Enums"]["note_priority"] | null
          summary: string
          tags?: string[] | null
          task_owner?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          category?: string
          completed?: boolean
          couple_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          items?: string[] | null
          list_id?: string | null
          original_text?: string
          priority?: Database["public"]["Enums"]["note_priority"] | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: {
        Args: { p_token: string }
        Returns: string
      }
      create_couple: {
        Args: { p_partner_name: string; p_title: string; p_you_name: string }
        Returns: string
      }
      create_invite: {
        Args: { p_couple_id: string; p_invited_email?: string }
        Returns: Json
      }
      debug_claims: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      debug_clerk_jwt: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      debug_clerk_user_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      debug_clerk_user_id_fixed: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      debug_jwt_claims: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_clerk_user_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      is_couple_member: {
        Args: { couple_uuid: string; user_id: string }
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
      jwt: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      jwt_sub: {
        Args: Record<PropertyKey, never>
        Returns: string
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
