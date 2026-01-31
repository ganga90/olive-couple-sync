/**
 * Olive Skills System
 *
 * Manages extensible skills that enhance Olive's capabilities.
 * Skills can be triggered by:
 * - Keywords in messages
 * - Categories of tasks
 * - Explicit commands
 * - Patterns detected in behavior
 *
 * Each skill provides specialized prompts and logic for specific domains.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Skill {
  id: string;
  skill_id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  triggers: SkillTrigger[];
  is_builtin: boolean;
  enabled: boolean;
}

interface SkillTrigger {
  keyword?: string;
  category?: string;
  command?: string;
  pattern?: string;
}

interface UserSkill {
  id: string;
  user_id: string;
  skill_id: string;
  enabled: boolean;
  config: Record<string, any>;
  usage_count: number;
}

interface SkillsRequest {
  action:
    | 'list_available'
    | 'list_installed'
    | 'install'
    | 'uninstall'
    | 'configure'
    | 'match'
    | 'execute'
    | 'get_skill';
  user_id?: string;
  skill_id?: string;
  config?: Record<string, any>;
  message?: string;
  category?: string;
  context?: Record<string, any>;
}

interface SkillMatchResult {
  matched: boolean;
  skill?: Skill;
  trigger_type?: 'keyword' | 'category' | 'command' | 'pattern';
  matched_value?: string;
}

interface SkillExecutionResult {
  success: boolean;
  output?: string;
  suggestions?: string[];
  actions?: Array<{
    type: string;
    data: Record<string, any>;
  }>;
  error?: string;
}

/**
 * Call the AI service
 */
async function callAI(systemPrompt: string, userMessage: string, temperature = 0.7): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    throw new Error(`AI call failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Match a message against skill triggers
 */
function matchSkillTriggers(
  message: string,
  category: string | undefined,
  skills: Skill[]
): SkillMatchResult {
  const lowerMessage = message.toLowerCase();

  for (const skill of skills) {
    if (!skill.enabled) continue;

    for (const trigger of skill.triggers) {
      // Check keyword match
      if (trigger.keyword) {
        const keyword = trigger.keyword.toLowerCase();
        if (lowerMessage.includes(keyword)) {
          return {
            matched: true,
            skill,
            trigger_type: 'keyword',
            matched_value: trigger.keyword,
          };
        }
      }

      // Check category match
      if (trigger.category && category) {
        if (category.toLowerCase() === trigger.category.toLowerCase()) {
          return {
            matched: true,
            skill,
            trigger_type: 'category',
            matched_value: trigger.category,
          };
        }
      }

      // Check command match (starts with /)
      if (trigger.command && lowerMessage.startsWith(trigger.command.toLowerCase())) {
        return {
          matched: true,
          skill,
          trigger_type: 'command',
          matched_value: trigger.command,
        };
      }
    }
  }

  return { matched: false };
}

/**
 * Execute a skill with context
 */
async function executeSkill(
  skill: Skill,
  message: string,
  context: Record<string, any>,
  supabase: any
): Promise<SkillExecutionResult> {
  try {
    // Build the skill prompt
    const systemPrompt = `You are Olive, an AI assistant for couples. You are now using the "${skill.name}" skill.

${skill.content}

## Context
${context.memory_context || 'No memory context available'}

${context.recent_tasks ? `## Recent Tasks\n${context.recent_tasks}` : ''}

${context.patterns ? `## User Patterns\n${context.patterns}` : ''}

## Response Guidelines
- Be helpful and specific
- Provide actionable suggestions when possible
- Keep responses concise but complete
- Use the skill's specialized knowledge

Respond in a helpful, warm tone.`;

    const userInput = `User message: ${message}

${context.additional_info ? `Additional info: ${context.additional_info}` : ''}`;

    const response = await callAI(systemPrompt, userInput, 0.7);

    // Update usage count
    if (context.user_id && context.user_skill_id) {
      await supabase
        .from('olive_user_skills')
        .update({
          usage_count: supabase.sql`usage_count + 1`,
          last_used: new Date().toISOString(),
        })
        .eq('id', context.user_skill_id);
    }

    return {
      success: true,
      output: response,
    };
  } catch (error) {
    console.error('Skill execution error:', error);
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Get user's installed skills merged with builtin skills
 */
async function getUserSkills(
  supabase: any,
  userId: string
): Promise<Array<Skill & { user_config?: Record<string, any>; user_skill_id?: string }>> {
  // Get all available skills
  const { data: allSkills, error: skillsError } = await supabase
    .from('olive_skills')
    .select('*')
    .eq('enabled', true);

  if (skillsError) {
    console.error('Error fetching skills:', skillsError);
    return [];
  }

  // Get user's installed skills
  const { data: userSkills, error: userError } = await supabase
    .from('olive_user_skills')
    .select('*')
    .eq('user_id', userId)
    .eq('enabled', true);

  if (userError) {
    console.error('Error fetching user skills:', userError);
  }

  // Create a map of user skill configurations
  const userSkillMap = new Map<string, UserSkill>();
  (userSkills || []).forEach((us: UserSkill) => {
    userSkillMap.set(us.skill_id, us);
  });

  // Merge skills with user configurations
  return (allSkills || []).map((skill: Skill) => {
    const userSkill = userSkillMap.get(skill.skill_id);
    return {
      ...skill,
      // If user hasn't explicitly installed, check if it's builtin (auto-enabled)
      enabled: userSkill?.enabled ?? skill.is_builtin,
      user_config: userSkill?.config,
      user_skill_id: userSkill?.id,
    };
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: SkillsRequest = await req.json();
    const { action } = body;

    switch (action) {
      case 'list_available': {
        // List all available skills
        const { data: skills, error } = await supabase
          .from('olive_skills')
          .select('*')
          .eq('enabled', true)
          .order('category', { ascending: true });

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, skills }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list_installed': {
        if (!body.user_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const skills = await getUserSkills(supabase, body.user_id);
        const installedSkills = skills.filter((s) => s.enabled);

        return new Response(
          JSON.stringify({ success: true, skills: installedSkills }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'install': {
        if (!body.user_id || !body.skill_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id and skill_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check if skill exists
        const { data: skill } = await supabase
          .from('olive_skills')
          .select('skill_id')
          .eq('skill_id', body.skill_id)
          .single();

        if (!skill) {
          return new Response(
            JSON.stringify({ success: false, error: 'Skill not found' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Install/update skill for user
        const { data, error } = await supabase
          .from('olive_user_skills')
          .upsert({
            user_id: body.user_id,
            skill_id: body.skill_id,
            enabled: true,
            config: body.config || {},
          }, {
            onConflict: 'user_id,skill_id',
          })
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, user_skill: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'uninstall': {
        if (!body.user_id || !body.skill_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id and skill_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Disable skill for user (soft delete)
        const { error } = await supabase
          .from('olive_user_skills')
          .update({ enabled: false })
          .eq('user_id', body.user_id)
          .eq('skill_id', body.skill_id);

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'configure': {
        if (!body.user_id || !body.skill_id || !body.config) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id, skill_id, and config required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data, error } = await supabase
          .from('olive_user_skills')
          .update({ config: body.config })
          .eq('user_id', body.user_id)
          .eq('skill_id', body.skill_id)
          .select()
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, user_skill: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'match': {
        if (!body.user_id || !body.message) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id and message required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const skills = await getUserSkills(supabase, body.user_id);
        const enabledSkills = skills.filter((s) => s.enabled);
        const matchResult = matchSkillTriggers(body.message, body.category, enabledSkills);

        return new Response(
          JSON.stringify({ success: true, ...matchResult }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'execute': {
        if (!body.user_id || !body.skill_id || !body.message) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id, skill_id, and message required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get the skill
        const { data: skill, error: skillError } = await supabase
          .from('olive_skills')
          .select('*')
          .eq('skill_id', body.skill_id)
          .single();

        if (skillError || !skill) {
          return new Response(
            JSON.stringify({ success: false, error: 'Skill not found' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get user's skill config
        const { data: userSkill } = await supabase
          .from('olive_user_skills')
          .select('*')
          .eq('user_id', body.user_id)
          .eq('skill_id', body.skill_id)
          .single();

        // Build context
        const context = {
          user_id: body.user_id,
          user_skill_id: userSkill?.id,
          ...body.context,
          ...(userSkill?.config || {}),
        };

        // Execute the skill
        const result = await executeSkill(skill, body.message, context, supabase);

        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_skill': {
        if (!body.skill_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'skill_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: skill, error } = await supabase
          .from('olive_skills')
          .select('*')
          .eq('skill_id', body.skill_id)
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, skill }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Skills error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
