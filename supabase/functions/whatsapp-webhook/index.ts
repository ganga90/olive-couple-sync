import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// DETERMINISTIC ROUTING - "Strict Gatekeeper"
// ============================================================================
// SEARCH: starts with Show, Find, List, Search, Get, ?, or contains "my tasks/list/reminders"
// MERGE: message is exactly "merge" (case-insensitive)  
// CREATE: Everything else (default)
// ============================================================================

type IntentResult = { intent: 'SEARCH' | 'MERGE' | 'CREATE' | 'CHAT' | 'CONTEXTUAL_ASK' | 'TASK_ACTION'; isUrgent?: boolean; cleanMessage?: string };

// Task action types for management commands
type TaskActionType = 
  | 'complete'      // "done with X", "mark X complete"
  | 'set_priority'  // "make X urgent", "prioritize X"
  | 'set_due'       // "X is due tomorrow"
  | 'assign'        // "assign X to partner"
  | 'edit'          // "change X to Y", "rename X"
  | 'delete'        // "delete X", "remove X"
  | 'move'          // "move X to groceries list"
  | 'remind';       // "remind me about X tomorrow"

type QueryType = 'urgent' | 'today' | 'tomorrow' | 'recent' | 'overdue' | 'general' | null;

// Chat subtypes for specialized AI handling
type ChatType = 
  | 'briefing'            // "good morning olive", "morning briefing", "start my day"
  | 'weekly_summary'      // "summarize my week", "how was my week"
  | 'daily_focus'         // "what should I focus on", "prioritize my day"
  | 'productivity_tips'   // "give me tips", "help me be productive"
  | 'progress_check'      // "how am I doing", "my progress"
  | 'motivation'          // "motivate me", "I'm stressed"
  | 'planning'            // "help me plan", "what's next"
  | 'greeting'            // "hi", "hello"
  | 'help'                // "what can you do", "help"
  | 'general';            // Catch-all for other questions

// ============================================================================
// TEXT NORMALIZATION - Handle iOS/Android typographic characters
// ============================================================================
function normalizeText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0]/g, ' ');
}

// ============================================================================
// CHAT TYPE DETECTION - Classify conversational queries
// ============================================================================
function detectChatType(message: string): ChatType {
  const lower = message.toLowerCase();
  
  // Briefing patterns - comprehensive morning overview (today AND tomorrow)
  if (/\b(morning\s+)?briefing\b/i.test(lower) ||
      /\bstart\s+my\s+day\b/i.test(lower) ||
      /\bmy\s+day\s+ahead\b/i.test(lower) ||
      /\bgive\s+me\s+(a\s+)?rundown\b/i.test(lower) ||
      /\b(what'?s|whats)\s+(on\s+)?(my\s+)?(schedule|agenda|calendar|day|plate)\s*(today|for today|tomorrow|for tomorrow)?\b/i.test(lower) ||
      /\b(what'?s|whats)\s+(for|on)\s+(today|tomorrow)\b/i.test(lower) ||
      /\b(what|which)\s+(tasks?|things?|items?)\s+(are|do i have)\s+(on|for|due)\s+(my\s+)?(day|today|tomorrow)\b/i.test(lower) ||
      /\b(my|the)\s+(agenda|schedule|plan)\s+(for\s+)?(today|tomorrow)\b/i.test(lower) ||
      /\bgood\s+morning\s+olive\b/i.test(lower) ||
      /\bmorning\s+olive\b/i.test(lower) ||
      /\bbrief\s+me\b/i.test(lower) ||
      /\bdaily\s+briefing\b/i.test(lower)) {
    return 'briefing';
  }
  
  // Weekly summary patterns
  if (/\b(summarize|recap|review)\s+(my\s+)?(week|weekly|past\s+7|last\s+7)/i.test(lower) ||
      /\b(how\s+was|how'?s)\s+(my\s+)?week/i.test(lower) ||
      /\bweek(ly)?\s+(summary|recap|review)/i.test(lower) ||
      /\bwhat\s+did\s+i\s+(do|accomplish|complete)\s+(this|last)\s+week/i.test(lower)) {
    return 'weekly_summary';
  }
  
  // Daily focus patterns
  if (/\b(what\s+should\s+i|help\s+me)\s+(focus|prioritize|work)\s+on/i.test(lower) ||
      /\b(prioritize|plan)\s+(my\s+)?(day|today)/i.test(lower) ||
      /\bwhat'?s?\s+(most\s+)?important\s+today/i.test(lower) ||
      /\bfocus\s+(for\s+)?today/i.test(lower) ||
      /\bwhat\s+first\b/i.test(lower) ||
      /\bwhere\s+should\s+i\s+start/i.test(lower)) {
    return 'daily_focus';
  }
  
  // Productivity tips patterns
  if (/\b(productivity|efficiency)\s+(tips?|advice|suggestions?)/i.test(lower) ||
      /\bgive\s+me\s+(some\s+)?(tips?|advice|suggestions?)/i.test(lower) ||
      /\bhow\s+(can\s+i|to)\s+be\s+(more\s+)?(productive|efficient|organized)/i.test(lower) ||
      /\bhelp\s+me\s+(be|get)\s+(more\s+)?(productive|organized|efficient)/i.test(lower)) {
    return 'productivity_tips';
  }
  
  // Progress check patterns
  if (/\bhow\s+am\s+i\s+doing/i.test(lower) ||
      /\b(my|check)\s+(progress|status|stats)/i.test(lower) ||
      /\bhow\s+productive\s+(am\s+i|have\s+i\s+been)/i.test(lower) ||
      /\bam\s+i\s+on\s+track/i.test(lower)) {
    return 'progress_check';
  }
  
  // Motivation patterns
  if (/\b(motivate|encourage|inspire)\s+me/i.test(lower) ||
      /\bi'?m\s+(stressed|overwhelmed|anxious|tired|exhausted)/i.test(lower) ||
      /\b(feeling|feel)\s+(down|bad|stressed|overwhelmed)/i.test(lower) ||
      /\bneed\s+(some\s+)?(motivation|encouragement)/i.test(lower) ||
      /\btoo\s+much\s+to\s+do/i.test(lower)) {
    return 'motivation';
  }
  
  // Planning patterns
  if (/\bhelp\s+me\s+plan/i.test(lower) ||
      /\bwhat'?s?\s+next\b/i.test(lower) ||
      /\bplan\s+(my|the)\s+(day|week|tomorrow)/i.test(lower) ||
      /\bwhat\s+should\s+i\s+do\s+(next|now|after)/i.test(lower)) {
    return 'planning';
  }
  
  // Greeting patterns
  if (/^(hi|hello|hey|good\s*(morning|afternoon|evening)|thanks|thank\s*you)\b/i.test(lower) ||
      /^(how\s+are\s+you|how'?s\s+it\s+going)/i.test(lower)) {
    return 'greeting';
  }
  
  // Help patterns
  if (/^(who\s+are\s+you|what\s+can\s+you\s+do|help\b|commands)/i.test(lower) ||
      /\bwhat\s+are\s+your\s+(features|capabilities)/i.test(lower)) {
    return 'help';
  }
  
  return 'general';
}

function determineIntent(message: string, hasMedia: boolean): IntentResult & { queryType?: QueryType; chatType?: ChatType; actionType?: TaskActionType; actionTarget?: string } {
  const trimmed = message.trim();
  const normalized = normalizeText(trimmed);
  const lower = normalized.toLowerCase();
  
  console.log('[Intent Detection] Original:', trimmed);
  console.log('[Intent Detection] Normalized:', normalized);
  
  // ============================================================================
  // QUICK-SEARCH SYNTAX - Power user shortcuts
  // ============================================================================
  
  if (normalized.startsWith('?')) {
    console.log('[Intent Detection] Matched: ? prefix (forced SEARCH)');
    return { intent: 'SEARCH', cleanMessage: normalized.slice(1).trim() };
  }
  
  if (normalized.startsWith('!')) {
    console.log('[Intent Detection] Matched: ! prefix (forced URGENT CREATE)');
    return { intent: 'CREATE', isUrgent: true, cleanMessage: normalized.slice(1).trim() };
  }
  
  if (normalized.startsWith('/')) {
    console.log('[Intent Detection] Matched: / prefix (forced CREATE)');
    return { intent: 'CREATE', cleanMessage: normalized.slice(1).trim() };
  }
  
  // MERGE: exact match only
  if (lower === 'merge') {
    console.log('[Intent Detection] Matched: merge command');
    return { intent: 'MERGE' };
  }
  
  const isQuestion = lower.endsWith('?') || /^(what|where|when|who|how|why|can|do|does|is|are|which|any|recommend|suggest|so\s+what)\b/i.test(lower);
  
  // ============================================================================
  // QUESTION EARLY-EXIT: Skip task action patterns for questions.
  // Task actions are imperative commands ("done with X", "make X urgent").
  // Questions ("what's for tomorrow?", "what's on my agenda?") must route
  // to SEARCH / CHAT / CONTEXTUAL_ASK handlers below.
  // ============================================================================
  if (!isQuestion) {
  // ============================================================================
  // TASK ACTION PATTERNS - Edit, complete, prioritize, assign
  // ============================================================================
  
  // Complete/Done patterns
  const completeMatch = lower.match(/^(?:done|complete|completed|finished|mark(?:ed)?\s+(?:as\s+)?(?:done|complete)|checked? off)\s*(?:with\s+)?(?:the\s+)?(.+)?$/i);
  if (completeMatch) {
    console.log('[Intent Detection] Matched: complete action');
    return { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: completeMatch[1]?.trim() };
  }
  
  // Priority patterns
  const priorityMatch = lower.match(/^(?:make|set|mark)\s+(.+?)\s+(?:as\s+)?(?:urgent|high\s*(?:priority)?|important|priority|low\s*(?:priority)?)/i) ||
                        lower.match(/^(?:prioritize|urgent)\s+(.+)/i);
  if (priorityMatch) {
    console.log('[Intent Detection] Matched: set priority action');
    return { intent: 'TASK_ACTION', actionType: 'set_priority', actionTarget: priorityMatch[1]?.trim() };
  }
  
  // Due date patterns - REQUIRE a verb prefix to avoid false positives on questions
  const dueMatch = lower.match(/^(?:set|make|move)\s+(.+?)\s+(?:is\s+)?(?:due|for)\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|\d+.+)/i) ||
                   lower.match(/^(.+?)\s+is\s+due\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|\d+.+)/i);
  if (dueMatch) {
    console.log('[Intent Detection] Matched: set due date action');
    return { intent: 'TASK_ACTION', actionType: 'set_due', actionTarget: dueMatch[1]?.trim(), cleanMessage: dueMatch[2] };
  }
  
  // Assign patterns
  const assignMatch = lower.match(/^(?:assign|give)\s+(.+?)\s+to\s+(partner|.+)/i);
  if (assignMatch) {
    console.log('[Intent Detection] Matched: assign action');
    return { intent: 'TASK_ACTION', actionType: 'assign', actionTarget: assignMatch[1]?.trim(), cleanMessage: assignMatch[2] };
  }
  
  // Delete patterns
  const deleteMatch = lower.match(/^(?:delete|remove|cancel)\s+(?:the\s+)?(?:task\s+)?(.+)/i);
  if (deleteMatch) {
    console.log('[Intent Detection] Matched: delete action');
    return { intent: 'TASK_ACTION', actionType: 'delete', actionTarget: deleteMatch[1]?.trim() };
  }
  
  // Move to list patterns
  const moveMatch = lower.match(/^(?:move|add)\s+(.+?)\s+to\s+(.+?)(?:\s+list)?$/i);
  if (moveMatch) {
    console.log('[Intent Detection] Matched: move action');
    return { intent: 'TASK_ACTION', actionType: 'move', actionTarget: moveMatch[1]?.trim(), cleanMessage: moveMatch[2] };
  }
  
  // Remind patterns
  const remindMatch = lower.match(/^(?:remind\s+(?:me|us)\s+(?:about\s+)?|set\s+(?:a\s+)?reminder\s+(?:for\s+)?)(.+)/i);
  if (remindMatch) {
    console.log('[Intent Detection] Matched: remind action');
    return { intent: 'TASK_ACTION', actionType: 'remind', actionTarget: remindMatch[1]?.trim() };
  }

  } // end !isQuestion guard
  
  // ============================================================================
  // CONTEXTUAL SEARCH PATTERNS - Semantic questions needing AI understanding
  // ============================================================================
  
  // These are questions that ask for recommendations or search within their data semantically
  const contextualPatterns = [
    /\b(?:any|good|best|recommend|suggest|ideas?\s+for|options?\s+for)\b.*\b(?:in\s+my|from\s+my|saved)\b/i,
    /\bwhat\s+(?:books?|restaurants?|movies?|shows?|recipes?|ideas?|places?|items?)\s+(?:do\s+i|did\s+i|have\s+i)\s+(?:have|save)/i,
    /\bwhat(?:'s|s)?\s+(?:in\s+my|on\s+my)\b.*\b(?:list|saved|wishlist|reading|watch|bucket)/i,
    /\b(?:find|search|look)\s+(?:for\s+)?(?:something|anything)\b.*\b(?:in\s+my|from\s+my)\b/i,
    /\b(?:recommend|suggest)\s+(?:something|anything|a)\b.*\b(?:from|based on|in)\s+my\b/i,
    /\b(?:help\s+me\s+(?:find|pick|choose))\b.*\b(?:from\s+my|in\s+my)\b/i,
    /\bdo\s+i\s+have\s+(?:any|a)\b.*\b(?:saved|in\s+my\s+list)/i,
    /\b(?:what|which)\s+(?:restaurant|book|movie|place|idea)\s+(?:should|would)\s+(?:i|we)\b/i,
    /\bany\s+(?:restaurants?|books?|movies?|ideas?|recommendations?|suggestions?|places?|recipes?)\b.*(?:for|about|from)\b/i,
  ];
  
  if (contextualPatterns.some(p => p.test(lower)) && isQuestion) {
    console.log('[Intent Detection] Matched: CONTEXTUAL_ASK (semantic question about saved items)');
    return { intent: 'CONTEXTUAL_ASK', cleanMessage: normalized };
  }
  
  // ============================================================================
  // SIMPLE SEARCH PATTERNS - Listing items without semantic understanding
  // ============================================================================
  
  if (/what'?s?\s+(is\s+)?urgent/i.test(lower) || 
      /urgent\s*\?$/i.test(lower) || 
      /urgent\s+tasks?/i.test(lower) ||
      (lower.includes('urgent') && isQuestion)) {
    console.log('[Intent Detection] Matched: urgent query pattern');
    return { intent: 'SEARCH', queryType: 'urgent' };
  }
  
  if (/what'?s?\s+(on\s+my\s+day|due\s+today|for\s+today)/i.test(lower) || 
      /today'?s?\s+tasks?/i.test(lower) ||
      /due\s+today/i.test(lower)) {
    console.log('[Intent Detection] Matched: today query pattern');
    return { intent: 'SEARCH', queryType: 'today' };
  }
  
  // Tomorrow queries - schedule/agenda for tomorrow
  if (/what'?s?\s+(?:on\s+)?(?:my\s+)?(?:day|agenda|schedule|calendar|plate|plan)?\s*(?:for\s+)?tomorrow/i.test(lower) ||
      /what'?s?\s+(?:due\s+)?tomorrow/i.test(lower) ||
      /what'?s?\s+for\s+tomorrow/i.test(lower) ||
      /tomorrow'?s?\s+(?:tasks?|agenda|schedule|plan)/i.test(lower) ||
      /due\s+tomorrow/i.test(lower) ||
      /\b(?:what|which)\s+(?:tasks?|things?|items?)\s+.*(?:tomorrow|for\s+tomorrow)\b/i.test(lower) ||
      /\b(?:my|the)\s+(?:agenda|schedule|plan)\s+(?:for\s+)?tomorrow\b/i.test(lower) ||
      /\b(?:agenda|schedule|plan)\s+(?:for\s+)?tomorrow\b/i.test(lower) ||
      /\b(?:so\s+)?what(?:'s|s)?\s+(?:is\s+)?(?:on\s+)?(?:my\s+)?(?:agenda|schedule|calendar|day|plate|plan)\s+(?:for\s+)?(?:tomorrow)\b/i.test(lower)) {
    console.log('[Intent Detection] Matched: tomorrow query pattern');
    return { intent: 'SEARCH', queryType: 'tomorrow' };
  }
  
  if (/what'?s?\s+recent/i.test(lower) || 
      /recent\s+tasks?/i.test(lower) || 
      /latest\s+tasks?/i.test(lower) ||
      /what\s+did\s+i\s+(add|save)/i.test(lower)) {
    console.log('[Intent Detection] Matched: recent query pattern');
    return { intent: 'SEARCH', queryType: 'recent' };
  }
  
  if (/what'?s?\s+overdue/i.test(lower) || 
      /overdue\s*\?$/i.test(lower) ||
      /overdue\s+tasks?/i.test(lower) ||
      (lower.includes('overdue') && isQuestion)) {
    console.log('[Intent Detection] Matched: overdue query pattern');
    return { intent: 'SEARCH', queryType: 'overdue' };
  }
  
  if (/what'?s?\s+pending/i.test(lower) || 
      /pending\s+tasks?/i.test(lower) ||
      (lower.includes('pending') && isQuestion)) {
    console.log('[Intent Detection] Matched: pending query pattern');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  if (/what\s+(do\s+i\s+have|are\s+my\s+tasks?|tasks?\s+do\s+i)/i.test(lower)) {
    console.log('[Intent Detection] Matched: what do I have pattern');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // Simple list display commands
  const searchStarters = ['show', 'list', 'get'];
  if (searchStarters.some(s => lower.startsWith(s + ' ') || lower === s)) {
    console.log('[Intent Detection] Matched: search starter keyword');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // "Find" with specific list names = SEARCH, but "find me something" = CONTEXTUAL_ASK
  if (/^find\s+(?:my\s+)?(\w+)\s+(?:list|tasks?)$/i.test(lower)) {
    console.log('[Intent Detection] Matched: find specific list pattern');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // "Search" command for specific items
  if (/^search\s+/i.test(lower)) {
    console.log('[Intent Detection] Matched: search command -> CONTEXTUAL_ASK');
    return { intent: 'CONTEXTUAL_ASK', cleanMessage: normalized };
  }
  
  // Simple "my tasks/list" queries
  if (/^(?:show\s+)?my\s+(tasks?|list|lists?|reminders?|items?|to-?do)$/i.test(lower)) {
    console.log('[Intent Detection] Matched: show my tasks pattern');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // Specific list requests (show my groceries list)
  if (/^(?:show|display|what'?s\s+(?:in|on))\s+(?:my\s+)?(\w+(?:\s+\w+)?)\s+(?:list|tasks?)$/i.test(lower)) {
    console.log('[Intent Detection] Matched: specific list request');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  if (/^(how many|do i have|check my|see my)/i.test(lower)) {
    console.log('[Intent Detection] Matched: question about content');
    return { intent: 'SEARCH', queryType: 'general' };
  }
  
  // ============================================================================
  // CHAT INTENT - Conversational AI with subtype detection
  // ============================================================================
  if (isQuestion && !hasMedia) {
    const chatType = detectChatType(normalized);
    // If it's a general question, route to CONTEXTUAL_ASK for richer handling
    if (chatType === 'general') {
      console.log('[Intent Detection] General question -> CONTEXTUAL_ASK');
      return { intent: 'CONTEXTUAL_ASK', cleanMessage: normalized };
    }
    console.log('[Intent Detection] Matched: CHAT intent, type:', chatType);
    return { intent: 'CHAT', cleanMessage: normalized, chatType };
  }
  
  // Check for non-question chat patterns (statements that should trigger chat)
  const statementChatPatterns = [
    /^(hi|hello|hey)\b/i,
    /^good\s*(morning|afternoon|evening)(\s+olive)?\b/i,
    /^morning\s+olive\b/i,
    /^briefing\b/i,
    /^start\s+my\s+day\b/i,
    /^(motivate|encourage|inspire)\s+me/i,
    /\bi'?m\s+(stressed|overwhelmed|anxious)/i,
    /^(summarize|recap)\s+(my\s+)?week/i,
    /^plan\s+(my|the)\s+(day|week)/i,
    /^(prioritize|focus)\s+(my\s+)?/i,
    /^brief\s+me\b/i
  ];
  
  if (statementChatPatterns.some(p => p.test(lower)) && !hasMedia) {
    const chatType = detectChatType(normalized);
    console.log('[Intent Detection] Matched: statement-based CHAT, type:', chatType);
    return { intent: 'CHAT', cleanMessage: normalized, chatType };
  }
  
  console.log('[Intent Detection] No pattern matched -> CREATE (default)');
  return { intent: 'CREATE' };
}

// Standardize phone number format
function standardizePhoneNumber(rawNumber: string): string {
  let cleaned = rawNumber.replace(/^whatsapp:/, '').replace(/\D/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

// Call Lovable AI
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
    const errorText = await response.text();
    console.error('Lovable AI error:', response.status, errorText);
    throw new Error(`AI call failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No response from AI');
  return text;
}

// ============================================================================
// OLIVE SKILLS - Match and execute specialized skills based on triggers
// ============================================================================
interface SkillMatch {
  matched: boolean;
  skill?: {
    skill_id: string;
    name: string;
    content: string;
    category: string;
  };
  trigger_type?: 'keyword' | 'category' | 'command';
  matched_value?: string;
}

async function matchUserSkills(
  supabase: any,
  userId: string,
  message: string,
  noteCategory?: string
): Promise<SkillMatch> {
  const lowerMessage = message.toLowerCase();
  
  try {
    // Get user's enabled skills (either explicitly enabled or builtin)
    const { data: userSkills } = await supabase
      .from('olive_user_skills')
      .select('skill_id, enabled')
      .eq('user_id', userId)
      .eq('enabled', true);
    
    const enabledSkillIds = new Set(userSkills?.map((s: any) => s.skill_id) || []);
    
    // Get all active skills
    const { data: allSkills } = await supabase
      .from('olive_skills')
      .select('skill_id, name, content, category, triggers')
      .eq('is_active', true);
    
    if (!allSkills || allSkills.length === 0) {
      return { matched: false };
    }
    
    // Check each skill's triggers
    for (const skill of allSkills) {
      // Skip if user hasn't enabled and it's not a default skill they should have
      // For now, all active skills are available to all users
      if (!skill.triggers || !skill.content) continue;
      
      const triggers = Array.isArray(skill.triggers) ? skill.triggers : [];
      
      for (const trigger of triggers) {
        // Check keyword match
        if (trigger.keyword) {
          const keyword = trigger.keyword.toLowerCase();
          if (lowerMessage.includes(keyword)) {
            console.log(`[Skills] Matched skill "${skill.name}" via keyword "${keyword}"`);
            return {
              matched: true,
              skill: {
                skill_id: skill.skill_id,
                name: skill.name,
                content: skill.content,
                category: skill.category || 'general'
              },
              trigger_type: 'keyword',
              matched_value: trigger.keyword
            };
          }
        }
        
        // Check category match
        if (trigger.category && noteCategory) {
          if (noteCategory.toLowerCase() === trigger.category.toLowerCase()) {
            console.log(`[Skills] Matched skill "${skill.name}" via category "${trigger.category}"`);
            return {
              matched: true,
              skill: {
                skill_id: skill.skill_id,
                name: skill.name,
                content: skill.content,
                category: skill.category || 'general'
              },
              trigger_type: 'category',
              matched_value: trigger.category
            };
          }
        }
        
        // Check command match (starts with /)
        if (trigger.command && lowerMessage.startsWith(trigger.command.toLowerCase())) {
          console.log(`[Skills] Matched skill "${skill.name}" via command "${trigger.command}"`);
          return {
            matched: true,
            skill: {
              skill_id: skill.skill_id,
              name: skill.name,
              content: skill.content,
              category: skill.category || 'general'
            },
            trigger_type: 'command',
            matched_value: trigger.command
          };
        }
      }
    }
    
    return { matched: false };
  } catch (error) {
    console.error('[Skills] Error matching skills:', error);
    return { matched: false };
  }
}

// Generate embedding for similarity search
async function generateEmbedding(text: string): Promise<number[] | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured for embeddings');
    return null;
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    });

    if (!response.ok) {
      console.error('Embedding API error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

// Helper to create TwiML response with media
function createTwimlResponse(messageText: string, mediaUrl?: string): string {
  if (mediaUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message><Body>${messageText}</Body><Media>${mediaUrl}</Media></Message></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${messageText}</Message></Response>`;
}

// Helper to download and upload media to Supabase Storage
async function downloadAndUploadMedia(
  twilioMediaUrl: string,
  mediaType: string,
  supabase: any
): Promise<string | null> {
  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.error('Twilio credentials not configured');
      return null;
    }

    const authHeader = `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`;
    const mediaResponse = await fetch(twilioMediaUrl, {
      headers: { 'Authorization': authHeader }
    });

    if (!mediaResponse.ok) {
      console.error('Failed to download media from Twilio:', mediaResponse.status);
      return null;
    }

    const mediaBlob = await mediaResponse.blob();
    const arrayBuffer = await mediaBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const ext = mediaType.split('/')[1] || 'bin';
    const timestamp = new Date().getTime();
    const randomStr = Math.random().toString(36).substring(7);
    const filename = `${timestamp}_${randomStr}.${ext}`;
    const filePath = `${filename}`;

    const { data, error } = await supabase.storage
      .from('whatsapp-media')
      .upload(filePath, uint8Array, {
        contentType: mediaType,
        upsert: false
      });

    if (error) {
      console.error('Failed to upload media to Supabase:', error);
      return null;
    }

    // Use signed URL for private bucket access (1 year expiry for stored URLs)
    const { data: signedData, error: signedError } = await supabase.storage
      .from('whatsapp-media')
      .createSignedUrl(filePath, 60 * 60 * 24 * 365);

    if (signedError || !signedData?.signedUrl) {
      console.error('Failed to create signed URL:', signedError);
      return null;
    }

    console.log('Successfully uploaded media with signed URL');
    return signedData.signedUrl;
  } catch (error) {
    console.error('Error downloading/uploading media:', error);
    return null;
  }
}

// Constants for input validation
const MAX_MESSAGE_LENGTH = 10000;
const MAX_MEDIA_COUNT = 10;
const TWILIO_MEDIA_DOMAIN = 'api.twilio.com';

function isValidTwilioMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith(TWILIO_MEDIA_DOMAIN) || parsed.hostname.includes('twilio');
  } catch {
    return false;
  }
}

function isValidCoordinates(lat: string | null, lon: string | null): boolean {
  if (!lat || !lon) return true;
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);
  return !isNaN(latitude) && !isNaN(longitude) && 
         latitude >= -90 && latitude <= 90 && 
         longitude >= -180 && longitude <= 180;
}

// Parse natural language date/time expressions
function parseNaturalDate(expression: string, timezone: string = 'America/New_York'): { date: string | null; time: string | null; readable: string } {
  const now = new Date();
  const lowerExpr = expression.toLowerCase().trim();
  
  const formatDate = (d: Date): string => d.toISOString();
  
  const monthNames: Record<string, number> = {
    'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
    'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
    'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9, 'november': 10, 'nov': 10, 'december': 11, 'dec': 11
  };
  
  const getNextDayOfWeek = (dayName: string): Date => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(dayName.toLowerCase());
    if (targetDay === -1) return now;
    
    const result = new Date(now);
    const currentDay = result.getDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    result.setDate(result.getDate() + daysToAdd);
    result.setHours(9, 0, 0, 0);
    return result;
  };
  
  let hours: number | null = null;
  let minutes: number = 0;
  
  const timeMatch = lowerExpr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    const potentialHour = parseInt(timeMatch[1]);
    const meridiem = timeMatch[3]?.toLowerCase();
    
    if (meridiem || potentialHour <= 12) {
      hours = potentialHour;
      minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    }
  }
  
  if (lowerExpr.includes('morning')) { hours = hours ?? 9; }
  else if (lowerExpr.includes('noon') || lowerExpr.includes('midday')) { hours = hours ?? 12; }
  else if (lowerExpr.includes('afternoon')) { hours = hours ?? 14; }
  else if (lowerExpr.includes('evening')) { hours = hours ?? 18; }
  else if (lowerExpr.includes('night')) { hours = hours ?? 20; }
  
  let targetDate: Date | null = null;
  let readable = '';
  
  if (lowerExpr.includes('today')) {
    targetDate = new Date(now);
    readable = 'today';
  } else if (lowerExpr.includes('tomorrow')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 1);
    readable = 'tomorrow';
  } else if (lowerExpr.includes('day after tomorrow')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 2);
    readable = 'day after tomorrow';
  } else if (lowerExpr.includes('next week')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 7);
    readable = 'next week';
  } else if (lowerExpr.includes('in a week') || lowerExpr.includes('in 1 week')) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 7);
    readable = 'in a week';
  }
  
  const inMinutesMatch = lowerExpr.match(/in\s+(\d+)\s*(?:min(?:ute)?s?)/i);
  const inHoursMatch = lowerExpr.match(/in\s+(\d+)\s*(?:hour?s?|hr?s?)/i);
  const inDaysMatch = lowerExpr.match(/in\s+(\d+)\s*days?/i);
  
  if (inMinutesMatch) {
    targetDate = new Date(now);
    targetDate.setMinutes(targetDate.getMinutes() + parseInt(inMinutesMatch[1]));
    readable = `in ${inMinutesMatch[1]} minutes`;
  } else if (inHoursMatch) {
    targetDate = new Date(now);
    targetDate.setHours(targetDate.getHours() + parseInt(inHoursMatch[1]));
    readable = `in ${inHoursMatch[1]} hour(s)`;
  } else if (inDaysMatch) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + parseInt(inDaysMatch[1]));
    readable = `in ${inDaysMatch[1]} day(s)`;
  }
  
  if (!targetDate) {
    const monthFirstMatch = lowerExpr.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
    const dayFirstMatch = lowerExpr.match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+|\s*-?\s*)(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i);
    
    let monthNum: number | undefined;
    let dayNum: number | undefined;
    
    if (monthFirstMatch) {
      monthNum = monthNames[monthFirstMatch[1].toLowerCase()];
      dayNum = parseInt(monthFirstMatch[2]);
    } else if (dayFirstMatch) {
      dayNum = parseInt(dayFirstMatch[1]);
      monthNum = monthNames[dayFirstMatch[2].toLowerCase()];
    }
    
    if (monthNum !== undefined && dayNum !== undefined && dayNum >= 1 && dayNum <= 31) {
      targetDate = new Date(now);
      targetDate.setMonth(monthNum, dayNum);
      
      if (targetDate < now) {
        targetDate.setFullYear(targetDate.getFullYear() + 1);
      }
      
      const monthDisplayNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                                  'July', 'August', 'September', 'October', 'November', 'December'];
      readable = `${monthDisplayNames[monthNum]} ${dayNum}`;
    }
  }
  
  if (!targetDate) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const day of dayNames) {
      if (lowerExpr.includes(day) || lowerExpr.includes(day.substring(0, 3))) {
        targetDate = getNextDayOfWeek(day);
        readable = `next ${day.charAt(0).toUpperCase() + day.slice(1)}`;
        break;
      }
    }
  }
  
  if (targetDate && hours !== null) {
    targetDate.setHours(hours, minutes, 0, 0);
    readable += ` at ${hours > 12 ? hours - 12 : hours === 0 ? 12 : hours}:${minutes.toString().padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  } else if (targetDate && hours === null) {
    targetDate.setHours(9, 0, 0, 0);
    readable += ' at 9:00 AM';
  }
  
  if (!targetDate) {
    return { date: null, time: null, readable: 'unknown' };
  }
  
  return {
    date: formatDate(targetDate),
    time: formatDate(targetDate),
    readable
  };
}

// Search for a task by keywords in summary
async function searchTaskByKeywords(
  supabase: any, 
  userId: string, 
  coupleId: string | null, 
  keywords: string[]
): Promise<any | null> {
  let query = supabase
    .from('clerk_notes')
    .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
    .eq('completed', false)
    .order('created_at', { ascending: false })
    .limit(50);
  
  if (coupleId) {
    query = query.eq('couple_id', coupleId);
  } else {
    query = query.eq('author_id', userId);
  }
  
  const { data: tasks, error } = await query;
  
  if (error || !tasks || tasks.length === 0) {
    return null;
  }
  
  const scoredTasks = tasks.map((task: any) => {
    const summaryLower = task.summary.toLowerCase();
    let score = 0;
    
    for (const keyword of keywords) {
      const keywordLower = keyword.toLowerCase();
      if (keywordLower.length < 2) continue;
      
      if (summaryLower.includes(keywordLower)) {
        if (summaryLower.split(/\s+/).some((word: string) => word === keywordLower)) {
          score += 10;
        } else {
          score += 5;
        }
      }
    }
    
    return { ...task, score };
  });
  
  scoredTasks.sort((a: any, b: any) => b.score - a.score);
  
  if (scoredTasks[0]?.score > 0) {
    return scoredTasks[0];
  }
  
  return null;
}

// Find similar notes using embedding similarity
async function findSimilarNotes(
  supabase: any,
  userId: string,
  coupleId: string | null | undefined,
  embedding: number[],
  excludeId: string
): Promise<{ id: string; summary: string; similarity: number } | null> {
  try {
    // Use the database function for similarity search
    const { data, error } = await supabase.rpc('find_similar_notes', {
      p_user_id: userId,
      p_couple_id: coupleId,
      p_query_embedding: JSON.stringify(embedding),
      p_threshold: 0.85,
      p_limit: 5
    });

    if (error) {
      console.error('Error finding similar notes:', error);
      return null;
    }

    // Filter out the just-created note
    const matches = (data || []).filter((n: any) => n.id !== excludeId);
    
    if (matches.length > 0) {
      return {
        id: matches[0].id,
        summary: matches[0].summary,
        similarity: matches[0].similarity
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error in findSimilarNotes:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse Twilio webhook body
    const formData = await req.formData();
    const fromNumber = standardizePhoneNumber(formData.get('From') as string);
    const rawMessageBody = formData.get('Body') as string;
    
    if (rawMessageBody && rawMessageBody.length > MAX_MESSAGE_LENGTH) {
      console.warn('[Validation] Message too long:', rawMessageBody.length, 'chars');
      return new Response(
        createTwimlResponse('Your message is too long. Please keep messages under 10,000 characters.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    const messageBody = rawMessageBody?.trim();
    
    const latitude = formData.get('Latitude') as string | null;
    const longitude = formData.get('Longitude') as string | null;
    
    if (!isValidCoordinates(latitude, longitude)) {
      console.warn('[Validation] Invalid coordinates:', { latitude, longitude });
      return new Response(
        createTwimlResponse('Invalid location data received. Please try sharing your location again.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');
    
    if (numMedia > MAX_MEDIA_COUNT) {
      console.warn('[Validation] Too many media attachments:', numMedia);
      return new Response(
        createTwimlResponse(`Too many attachments (${numMedia}). Please send up to ${MAX_MEDIA_COUNT} files at a time.`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }
    
    const hadIncomingMedia = numMedia > 0;
    const mediaUrls: string[] = [];
    const mediaTypes: string[] = [];
    let mediaDownloadFailed = false;

    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = formData.get(`MediaUrl${i}`) as string;
      const mediaType = formData.get(`MediaContentType${i}`) as string || 'application/octet-stream';
      
      if (mediaUrl) {
        if (!isValidTwilioMediaUrl(mediaUrl)) {
          console.warn('[Validation] Invalid media URL:', mediaUrl);
          mediaDownloadFailed = true;
          continue;
        }
        
        const publicUrl = await downloadAndUploadMedia(mediaUrl, mediaType, supabase);
        if (publicUrl) {
          mediaUrls.push(publicUrl);
          mediaTypes.push(mediaType);
        } else {
          mediaDownloadFailed = true;
        }
      }
    }

    console.log('Incoming WhatsApp message:', { 
      fromNumber, 
      messageBody: messageBody?.substring(0, 100),
      numMedia,
      uploadedMedia: mediaUrls.length
    });

    // Handle location sharing
    if (latitude && longitude && !messageBody && mediaUrls.length === 0) {
      return new Response(
        createTwimlResponse(`📍 Thanks for sharing your location! (${latitude}, ${longitude})\n\nYou can add a task with this location by sending a message like:\n"Buy groceries at this location"`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Handle media-only messages - process them
    if (mediaUrls.length > 0 && !messageBody) {
      console.log('[WhatsApp] Processing media-only message');
    }

    if (!messageBody && mediaUrls.length === 0) {
      if (hadIncomingMedia && mediaDownloadFailed) {
        console.warn('[WhatsApp] User attached media but download failed');
        return new Response(
          createTwimlResponse(
            "I see you attached a photo or file, but I couldn't download it from WhatsApp. " +
            "Please try sending it again, or add a short caption describing what you want to save."
          ),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      
      return new Response(
        createTwimlResponse('Please send a message, share your location 📍, or attach media 📎'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Check for linking token
    const tokenMatch = messageBody?.match(/(?:My Olive Token is )?(LINK_[A-Z0-9]+)/i);
    if (tokenMatch) {
      const token = tokenMatch[1].toUpperCase();
      console.log('Processing linking token:', token);
      
      const { data: tokenData, error: tokenError } = await supabase
        .from('linking_tokens')
        .select('user_id')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .is('used_at', null)
        .single();

      if (tokenError || !tokenData) {
        console.error('Token lookup error:', tokenError);
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Invalid or expired token. Please generate a new one from the Olive app.</Message></Response>',
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      const { error: updateError } = await supabase
        .from('clerk_profiles')
        .update({ phone_number: fromNumber })
        .eq('id', tokenData.user_id);

      if (updateError) {
        console.error('Error linking WhatsApp:', updateError);
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Failed to link your account. Please try again.</Message></Response>',
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      await supabase
        .from('linking_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', token);

      console.log('WhatsApp account linked successfully for user:', tokenData.user_id);

      const successImage = 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=400&q=80';
      return new Response(
        createTwimlResponse(
          '✅ Your Olive account is successfully linked!\n\nYou can now:\n• Send brain dumps to organize\n• Share locations 📍 with tasks\n• Ask about your tasks\n• Send images 📸 or voice notes 🎤',
          successImage
        ),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Authenticate user by WhatsApp number
    const { data: profiles, error: profileError } = await supabase
      .from('clerk_profiles')
      .select('id, display_name, timezone')
      .eq('phone_number', fromNumber)
      .limit(1);

    const profile = profiles?.[0];

    if (profileError || !profile) {
      console.error('Profile lookup error:', profileError);
      return new Response(
        createTwimlResponse(
          '👋 Hi! To use Olive via WhatsApp, please link your account first:\n\n' +
          '1️⃣ Open the Olive app\n' +
          '2️⃣ Go to Profile/Settings\n' +
          '3️⃣ Tap "Link WhatsApp"\n' +
          '4️⃣ Send the token here\n\n' +
          'Then I can help organize your tasks, locations, and more!'
        ),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    console.log('Authenticated user:', profile.id, profile.display_name);
    const userId = profile.id;

    // Get or create session
    let { data: session } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (!session) {
      const { data: newSession, error: sessionError } = await supabase
        .from('user_sessions')
        .insert({ user_id: userId, conversation_state: 'IDLE' })
        .select()
        .single();

      if (sessionError) {
        console.error('Error creating session:', sessionError);
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, there was an error. Please try again.</Message></Response>',
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      session = newSession;
    }

    // Get user's couple_id for shared notes
    const { data: coupleMember } = await supabase
      .from('clerk_couple_members')
      .select('couple_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    const coupleId = coupleMember?.couple_id || null;

    // ========================================================================
    // HANDLE AWAITING_CONFIRMATION STATE
    // ========================================================================
    if (session.conversation_state === 'AWAITING_CONFIRMATION') {
      const contextData = session.context_data as any;
      const isAffirmative = /^(yes|yeah|yep|sure|ok|okay|confirm|si|sí|do it|go ahead|please|y)$/i.test(messageBody.trim());
      const isNegative = /^(no|nope|nah|cancel|nevermind|never mind|n)$/i.test(messageBody.trim());

      // Reset session state first
      await supabase
        .from('user_sessions')
        .update({ conversation_state: 'IDLE', context_data: null, updated_at: new Date().toISOString() })
        .eq('id', session.id);

      if (isNegative) {
        return new Response(
          createTwimlResponse('👍 No problem, I cancelled that action.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      if (!isAffirmative) {
        return new Response(
          createTwimlResponse('I didn\'t understand. Please reply "yes" to confirm or "no" to cancel.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Execute the pending action
      const pendingAction = contextData?.pending_action;
      
      if (pendingAction?.type === 'assign') {
        const { error: updateError } = await supabase
          .from('clerk_notes')
          .update({ 
            task_owner: pendingAction.target_user_id, 
            updated_at: new Date().toISOString() 
          })
          .eq('id', pendingAction.task_id);

        if (updateError) {
          console.error('Error assigning task:', updateError);
          return new Response(
            createTwimlResponse('Sorry, I couldn\'t assign that task. Please try again.'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }

        return new Response(
          createTwimlResponse(`✅ Done! I assigned "${pendingAction.task_summary}" to ${pendingAction.target_name}. 🎯`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'set_due_date') {
        await supabase
          .from('clerk_notes')
          .update({ 
            due_date: pendingAction.date, 
            updated_at: new Date().toISOString() 
          })
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`✅ Done! "${pendingAction.task_summary}" is now due ${pendingAction.readable}. 📅`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'set_reminder') {
        const updateData: any = { 
          reminder_time: pendingAction.time, 
          updated_at: new Date().toISOString() 
        };
        
        if (!pendingAction.has_due_date) {
          updateData.due_date = pendingAction.time;
        }
        
        await supabase
          .from('clerk_notes')
          .update(updateData)
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`✅ Done! I'll remind you about "${pendingAction.task_summary}" ${pendingAction.readable}. ⏰`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'delete') {
        await supabase
          .from('clerk_notes')
          .delete()
          .eq('id', pendingAction.task_id);

        return new Response(
          createTwimlResponse(`🗑️ Done! "${pendingAction.task_summary}" has been deleted.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else if (pendingAction?.type === 'merge') {
        // Execute merge using the database function
        const { data: mergeResult, error: mergeError } = await supabase.rpc('merge_notes', {
          p_source_id: pendingAction.source_id,
          p_target_id: pendingAction.target_id
        });

        if (mergeError) {
          console.error('Error merging notes:', mergeError);
          return new Response(
            createTwimlResponse('Sorry, I couldn\'t merge those notes. Please try again.'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }

        return new Response(
          createTwimlResponse(`✅ Merged! Combined your note into: "${pendingAction.target_summary}"\n\n🔗 Manage: https://witholive.app`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      return new Response(
        createTwimlResponse('Something went wrong with the confirmation. Please try again.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // ========================================================================
    // DETERMINISTIC ROUTING - "Strict Gatekeeper"
    // ========================================================================
    const intentResult = determineIntent(messageBody || '', mediaUrls.length > 0);
    const { intent, isUrgent, cleanMessage } = intentResult;
    // Use cleanMessage if prefix was stripped, otherwise use original
    const effectiveMessage = cleanMessage ?? messageBody;
    console.log('Deterministic intent:', intent, 'isUrgent:', isUrgent, 'for message:', effectiveMessage?.substring(0, 50));

    // ========================================================================
    // MERGE COMMAND HANDLER
    // ========================================================================
    if (intent === 'MERGE') {
      // Find the most recently created note by this user (within last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const { data: recentNotes, error: recentError } = await supabase
        .from('clerk_notes')
        .select('id, summary, embedding, created_at')
        .eq('author_id', userId)
        .eq('completed', false)
        .gte('created_at', fiveMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      if (recentError || !recentNotes || recentNotes.length === 0) {
        return new Response(
          createTwimlResponse('I don\'t see any recent tasks to merge. The Merge command works within 5 minutes of creating a task.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      const sourceNote = recentNotes[0];

      // If we have an embedding, find similar notes
      let targetNote: { id: string; summary: string } | null = null;

      if (sourceNote.embedding) {
        const similar = await findSimilarNotes(supabase, userId, coupleId, sourceNote.embedding, sourceNote.id);
        if (similar) {
          targetNote = { id: similar.id, summary: similar.summary };
        }
      }

      // Fallback: generate embedding from summary if we don't have one stored
      if (!targetNote) {
        const embedding = await generateEmbedding(sourceNote.summary);
        if (embedding) {
          const similar = await findSimilarNotes(supabase, userId, coupleId, embedding, sourceNote.id);
          if (similar) {
            targetNote = { id: similar.id, summary: similar.summary };
          }
        }
      }

      if (!targetNote) {
        return new Response(
          createTwimlResponse(`I couldn't find a similar task to merge "${sourceNote.summary}" with. The task remains as-is.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Ask for confirmation before merging
      await supabase
        .from('user_sessions')
        .update({ 
          conversation_state: 'AWAITING_CONFIRMATION', 
          context_data: {
            pending_action: {
              type: 'merge',
              source_id: sourceNote.id,
              source_summary: sourceNote.summary,
              target_id: targetNote.id,
              target_summary: targetNote.summary
            }
          },
          updated_at: new Date().toISOString() 
        })
        .eq('id', session.id);

      return new Response(
        createTwimlResponse(`🔀 Merge "${sourceNote.summary}" into "${targetNote.summary}"?\n\nReply "yes" to confirm or "no" to cancel.`),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // ========================================================================
    // SEARCH INTENT - Consultation with Context-Aware Responses
    // ========================================================================
    if (intent === 'SEARCH') {
      // Get queryType from intent result for contextual responses
      const queryType = (intentResult as any).queryType as QueryType;
      
      // Fetch user's tasks and lists
      const { data: tasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, due_date, completed, priority, category, list_id, items, task_owner, created_at')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .order('created_at', { ascending: false })
        .limit(100);

      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name, description')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);

      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);

      // Check if asking about a specific list
      const listNameMatch = effectiveMessage?.toLowerCase().match(/(?:what'?s in|show me|list)\s+(?:my\s+)?(\w+(?:\s+\w+)?)\s+(?:list|tasks?)/i);
      let specificList: string | null = null;
      
      if (listNameMatch) {
        const requestedList = listNameMatch[1].toLowerCase();
        for (const [listId, listName] of listIdToName) {
          if ((listName as string).toLowerCase().includes(requestedList) || requestedList.includes((listName as string).toLowerCase())) {
            specificList = listId;
            break;
          }
        }
      }

      if (specificList && tasks) {
        const relevantTasks = tasks.filter(t => t.list_id === specificList && !t.completed);
        
        if (relevantTasks.length === 0) {
          return new Response(
            createTwimlResponse(`Your ${listIdToName.get(specificList)} list is empty! 🎉`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        const listName = listIdToName.get(specificList);
        const itemsList = relevantTasks.map((t, i) => {
          const items = t.items && t.items.length > 0 ? `\n  ${t.items.join('\n  ')}` : '';
          return `${i + 1}. ${t.summary}${items}`;
        }).join('\n\n');
        
        return new Response(
          createTwimlResponse(`📋 ${listName}:\n\n${itemsList}\n\n💡 Say "mark as done" to complete items`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // General task summary
      if (!tasks || tasks.length === 0) {
        return new Response(
          createTwimlResponse('You don\'t have any tasks yet! Send me something to save like "Buy groceries tomorrow" 🛒'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      const activeTasks = tasks.filter(t => !t.completed);
      const urgentTasks = activeTasks.filter(t => t.priority === 'high');
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      
      const dueTodayTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return dueDate >= today && dueDate < tomorrow;
      });
      
      const overdueTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return dueDate < today;
      });
      
      // Get recent tasks (last 24 hours)
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const recentTasks = activeTasks.filter(t => new Date(t.created_at) >= oneDayAgo);

      // ================================================================
      // CONTEXTUAL QUERY RESPONSES
      // ================================================================
      
      // Handle "what's urgent" query
      if (queryType === 'urgent') {
        if (urgentTasks.length === 0) {
          return new Response(
            createTwimlResponse('🎉 Great news! You have no urgent tasks right now.\n\n💡 Use "!" prefix to mark tasks as urgent (e.g., "!call mom")'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        const urgentList = urgentTasks.slice(0, 8).map((t, i) => {
          const dueInfo = t.due_date ? ` (Due: ${new Date(t.due_date).toLocaleDateString()})` : '';
          return `${i + 1}. ${t.summary}${dueInfo}`;
        }).join('\n');
        
        const moreText = urgentTasks.length > 8 ? `\n\n...and ${urgentTasks.length - 8} more urgent tasks` : '';
        
        return new Response(
          createTwimlResponse(`🔥 ${urgentTasks.length} Urgent Task${urgentTasks.length === 1 ? '' : 's'}:\n\n${urgentList}${moreText}\n\n🔗 Manage: https://witholive.app`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      
      // Handle "what's due today" query
      if (queryType === 'today') {
        if (dueTodayTasks.length === 0) {
          return new Response(
            createTwimlResponse('📅 Nothing due today! You\'re all caught up.\n\n💡 Try "what\'s urgent" to see high-priority tasks'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        const todayList = dueTodayTasks.slice(0, 8).map((t, i) => {
          const priority = t.priority === 'high' ? ' 🔥' : '';
          return `${i + 1}. ${t.summary}${priority}`;
        }).join('\n');
        
        const moreText = dueTodayTasks.length > 8 ? `\n\n...and ${dueTodayTasks.length - 8} more` : '';
        
        return new Response(
          createTwimlResponse(`📅 ${dueTodayTasks.length} Task${dueTodayTasks.length === 1 ? '' : 's'} Due Today:\n\n${todayList}${moreText}\n\n🔗 Manage: https://witholive.app`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      
      // Handle "what's due tomorrow" query
      if (queryType === 'tomorrow') {
        const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
        const dueTomorrowTasks = activeTasks.filter(t => {
          if (!t.due_date) return false;
          const dueDate = new Date(t.due_date);
          return dueDate >= tomorrow && dueDate < dayAfterTomorrow;
        });
        
        // Also fetch calendar events for tomorrow
        let tomorrowCalendarEvents: string[] = [];
        try {
          const { data: calConnection } = await supabase
            .from('calendar_connections')
            .select('id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1)
            .single();
          
          if (calConnection) {
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, all_day')
              .eq('connection_id', calConnection.id)
              .gte('start_time', tomorrow.toISOString())
              .lt('start_time', dayAfterTomorrow.toISOString())
              .order('start_time', { ascending: true })
              .limit(10);
            
            tomorrowCalendarEvents = (events || []).map(e => {
              if (e.all_day) return `• ${e.title} (all day)`;
              const time = new Date(e.start_time).toLocaleTimeString('en-US', { 
                hour: 'numeric', minute: '2-digit', hour12: true 
              });
              return `• ${time}: ${e.title}`;
            });
          }
        } catch (calErr) {
          console.warn('[WhatsApp] Calendar fetch error for tomorrow:', calErr);
        }
        
        if (dueTomorrowTasks.length === 0 && tomorrowCalendarEvents.length === 0) {
          return new Response(
            createTwimlResponse('📅 Nothing scheduled for tomorrow! Enjoy your free day.\n\n💡 Try "what\'s urgent" to see high-priority tasks'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        let response = '📅 Tomorrow\'s Agenda:\n';
        
        if (tomorrowCalendarEvents.length > 0) {
          response += `\n🗓️ Calendar (${tomorrowCalendarEvents.length}):\n${tomorrowCalendarEvents.join('\n')}\n`;
        }
        
        if (dueTomorrowTasks.length > 0) {
          const tomorrowList = dueTomorrowTasks.slice(0, 8).map((t, i) => {
            const priority = t.priority === 'high' ? ' 🔥' : '';
            return `${i + 1}. ${t.summary}${priority}`;
          }).join('\n');
          const moreText = dueTomorrowTasks.length > 8 ? `\n...and ${dueTomorrowTasks.length - 8} more` : '';
          response += `\n📋 Tasks Due (${dueTomorrowTasks.length}):\n${tomorrowList}${moreText}\n`;
        }
        
        // Also mention overdue tasks as context
        if (overdueTasks.length > 0) {
          response += `\n⚠️ Also: ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} to catch up on`;
        }
        
        response += '\n\n🔗 Manage: https://witholive.app';
        
        return new Response(
          createTwimlResponse(response),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      
      // Handle "what's recent" query
      if (queryType === 'recent') {
        if (recentTasks.length === 0) {
          // Fallback to showing last 5 active tasks regardless of creation time
          const lastFive = activeTasks.slice(0, 5);
          if (lastFive.length === 0) {
            return new Response(
              createTwimlResponse('No recent tasks found. Send me something to save!'),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          const recentList = lastFive.map((t, i) => `${i + 1}. ${t.summary}`).join('\n');
          return new Response(
            createTwimlResponse(`📝 Your Latest Tasks:\n\n${recentList}\n\n🔗 Manage: https://witholive.app`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        const recentList = recentTasks.slice(0, 8).map((t, i) => {
          const priority = t.priority === 'high' ? ' 🔥' : '';
          return `${i + 1}. ${t.summary}${priority}`;
        }).join('\n');
        
        const moreText = recentTasks.length > 8 ? `\n\n...and ${recentTasks.length - 8} more` : '';
        
        return new Response(
          createTwimlResponse(`🕐 ${recentTasks.length} Task${recentTasks.length === 1 ? '' : 's'} Added Recently:\n\n${recentList}${moreText}\n\n🔗 Manage: https://witholive.app`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      
      // Handle "what's overdue" query
      if (queryType === 'overdue') {
        if (overdueTasks.length === 0) {
          return new Response(
            createTwimlResponse('✅ No overdue tasks! You\'re on track.\n\n💡 Try "what\'s due today" to see today\'s tasks'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        const overdueList = overdueTasks.slice(0, 8).map((t, i) => {
          const dueDate = new Date(t.due_date!);
          const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
          return `${i + 1}. ${t.summary} (${daysOverdue}d overdue)`;
        }).join('\n');
        
        const moreText = overdueTasks.length > 8 ? `\n\n...and ${overdueTasks.length - 8} more` : '';
        
        return new Response(
          createTwimlResponse(`⚠️ ${overdueTasks.length} Overdue Task${overdueTasks.length === 1 ? '' : 's'}:\n\n${overdueList}${moreText}\n\n🔗 Manage: https://witholive.app`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }

      // Default: General task summary
      let summary = `📊 Your Tasks:\n`;
      summary += `• Active: ${activeTasks.length}\n`;
      if (urgentTasks.length > 0) summary += `• Urgent: ${urgentTasks.length} 🔥\n`;
      if (dueTodayTasks.length > 0) summary += `• Due today: ${dueTodayTasks.length}\n`;
      if (overdueTasks.length > 0) summary += `• Overdue: ${overdueTasks.length} ⚠️\n`;

      if (urgentTasks.length > 0) {
        summary += `\n⚡ Urgent:\n`;
        summary += urgentTasks.slice(0, 3).map((t, i) => `${i + 1}. ${t.summary}`).join('\n');
      } else if (activeTasks.length > 0) {
        summary += `\n📝 Recent:\n`;
        summary += activeTasks.slice(0, 5).map((t, i) => `${i + 1}. ${t.summary}`).join('\n');
      }

      summary += '\n\n💡 Try: "what\'s urgent", "what\'s due today", or "show my groceries list"';

      return new Response(
        createTwimlResponse(summary),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // ========================================================================
    // TASK ACTION HANDLER - Edit, complete, prioritize, assign, etc.
    // ========================================================================
    if (intent === 'TASK_ACTION') {
      const actionType = (intentResult as any).actionType as TaskActionType;
      const actionTarget = (intentResult as any).actionTarget as string;
      console.log('[WhatsApp] Processing TASK_ACTION:', actionType, 'target:', actionTarget);
      
      if (!actionTarget) {
        return new Response(
          createTwimlResponse('I need to know which task you want to modify. Try "done with buy milk" or "make groceries urgent".'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      
      // Extract keywords from the target to find the task
      const keywords = actionTarget.split(/\s+/).filter(w => w.length > 2);
      const foundTask = await searchTaskByKeywords(supabase, userId, coupleId, keywords);
      
      if (!foundTask) {
        return new Response(
          createTwimlResponse(`I couldn't find a task matching "${actionTarget}". Try "show my tasks" to see your list.`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
      
      switch (actionType) {
        case 'complete': {
          const { error } = await supabase
            .from('clerk_notes')
            .update({ completed: true, updated_at: new Date().toISOString() })
            .eq('id', foundTask.id);
          
          if (error) {
            return new Response(
              createTwimlResponse('Sorry, I couldn\'t complete that task. Please try again.'),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          return new Response(
            createTwimlResponse(`✅ Done! Marked "${foundTask.summary}" as complete. Great job! 🎉`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        case 'set_priority': {
          const msgLower = (effectiveMessage || '').toLowerCase();
          const newPriority = msgLower.includes('low') ? 'low' : 'high';
          const { error } = await supabase
            .from('clerk_notes')
            .update({ priority: newPriority, updated_at: new Date().toISOString() })
            .eq('id', foundTask.id);
          
          if (error) {
            return new Response(
              createTwimlResponse('Sorry, I couldn\'t update the priority. Please try again.'),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          const emoji = newPriority === 'high' ? '🔥' : '📌';
          return new Response(
            createTwimlResponse(`${emoji} Updated! "${foundTask.summary}" is now ${newPriority} priority.`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        case 'set_due': {
          const dateExpr = effectiveMessage || 'tomorrow';
          const parsed = parseNaturalDate(dateExpr, profile.timezone || 'America/New_York');
          
          if (!parsed.date) {
            return new Response(
              createTwimlResponse(`I couldn't understand the date "${dateExpr}". Try "tomorrow", "monday", or "next week".`),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          // Ask for confirmation
          await supabase
            .from('user_sessions')
            .update({ 
              conversation_state: 'AWAITING_CONFIRMATION', 
              context_data: {
                pending_action: {
                  type: 'set_due_date',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  date: parsed.date,
                  readable: parsed.readable
                }
              },
              updated_at: new Date().toISOString() 
            })
            .eq('id', session.id);
          
          return new Response(
            createTwimlResponse(`📅 Set "${foundTask.summary}" due ${parsed.readable}?\n\nReply "yes" to confirm.`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        case 'assign': {
          if (!coupleId) {
            return new Response(
              createTwimlResponse('You need to be in a shared space to assign tasks. Invite a partner from the app!'),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          // Find partner
          const { data: partnerMember } = await supabase
            .from('clerk_couple_members')
            .select('user_id')
            .eq('couple_id', coupleId)
            .neq('user_id', userId)
            .limit(1)
            .single();
          
          if (!partnerMember) {
            return new Response(
              createTwimlResponse('I couldn\'t find your partner. Make sure they\'ve accepted your invite!'),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          // Get partner name
          const { data: coupleData } = await supabase
            .from('clerk_couples')
            .select('you_name, partner_name, created_by')
            .eq('id', coupleId)
            .single();
          
          const isCreator = coupleData?.created_by === userId;
          const partnerName = isCreator ? (coupleData?.partner_name || 'Partner') : (coupleData?.you_name || 'Partner');
          
          // Ask for confirmation
          await supabase
            .from('user_sessions')
            .update({ 
              conversation_state: 'AWAITING_CONFIRMATION', 
              context_data: {
                pending_action: {
                  type: 'assign',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  target_user_id: partnerMember.user_id,
                  target_name: partnerName
                }
              },
              updated_at: new Date().toISOString() 
            })
            .eq('id', session.id);
          
          return new Response(
            createTwimlResponse(`🤝 Assign "${foundTask.summary}" to ${partnerName}?\n\nReply "yes" to confirm.`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        case 'delete': {
          // Ask for confirmation
          await supabase
            .from('user_sessions')
            .update({ 
              conversation_state: 'AWAITING_CONFIRMATION', 
              context_data: {
                pending_action: {
                  type: 'delete',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary
                }
              },
              updated_at: new Date().toISOString() 
            })
            .eq('id', session.id);
          
          return new Response(
            createTwimlResponse(`🗑️ Delete "${foundTask.summary}"?\n\nReply "yes" to confirm or "no" to cancel.`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        case 'move': {
          const targetListName = effectiveMessage?.trim();
          
          // Find or create target list
          const { data: existingList } = await supabase
            .from('clerk_lists')
            .select('id, name')
            .ilike('name', `%${targetListName}%`)
            .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
            .limit(1)
            .single();
          
          if (existingList) {
            const { error } = await supabase
              .from('clerk_notes')
              .update({ list_id: existingList.id, updated_at: new Date().toISOString() })
              .eq('id', foundTask.id);
            
            if (!error) {
              return new Response(
                createTwimlResponse(`📂 Moved "${foundTask.summary}" to ${existingList.name}!`),
                { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
              );
            }
          }
          
          // Create new list
          const { data: newList, error: createError } = await supabase
            .from('clerk_lists')
            .insert({ 
              name: targetListName, 
              author_id: userId, 
              couple_id: coupleId,
              is_manual: true
            })
            .select('id, name')
            .single();
          
          if (newList) {
            await supabase
              .from('clerk_notes')
              .update({ list_id: newList.id, updated_at: new Date().toISOString() })
              .eq('id', foundTask.id);
            
            return new Response(
              createTwimlResponse(`📂 Created "${newList.name}" list and moved "${foundTask.summary}" there!`),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          return new Response(
            createTwimlResponse('Sorry, I couldn\'t move that task. Please try again.'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        case 'remind': {
          const reminderExpr = actionTarget;
          const parsed = parseNaturalDate(reminderExpr, profile.timezone || 'America/New_York');
          
          if (parsed.date) {
            // Ask for confirmation
            await supabase
              .from('user_sessions')
              .update({ 
                conversation_state: 'AWAITING_CONFIRMATION', 
                context_data: {
                  pending_action: {
                    type: 'set_reminder',
                    task_id: foundTask.id,
                    task_summary: foundTask.summary,
                    time: parsed.date,
                    readable: parsed.readable,
                    has_due_date: !!foundTask.due_date
                  }
                },
                updated_at: new Date().toISOString() 
              })
              .eq('id', session.id);
            
            return new Response(
              createTwimlResponse(`⏰ Set reminder for "${foundTask.summary}" ${parsed.readable}?\n\nReply "yes" to confirm.`),
              { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
            );
          }
          
          // No time specified - set for tomorrow 9am as default
          const tomorrowReminder = new Date();
          tomorrowReminder.setDate(tomorrowReminder.getDate() + 1);
          tomorrowReminder.setHours(9, 0, 0, 0);
          
          await supabase
            .from('user_sessions')
            .update({ 
              conversation_state: 'AWAITING_CONFIRMATION', 
              context_data: {
                pending_action: {
                  type: 'set_reminder',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  time: tomorrowReminder.toISOString(),
                  readable: 'tomorrow at 9:00 AM',
                  has_due_date: !!foundTask.due_date
                }
              },
              updated_at: new Date().toISOString() 
            })
            .eq('id', session.id);
          
          return new Response(
            createTwimlResponse(`⏰ Set reminder for "${foundTask.summary}" tomorrow at 9:00 AM?\n\nReply "yes" to confirm.`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        default:
          return new Response(
            createTwimlResponse('I didn\'t understand that action. Try "done with [task]", "make [task] urgent", or "assign [task] to partner".'),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
      }
    }

    // ========================================================================
    // CONTEXTUAL ASK HANDLER - AI-powered semantic search with saved items
    // ========================================================================
    if (intent === 'CONTEXTUAL_ASK') {
      console.log('[WhatsApp] Processing CONTEXTUAL_ASK for:', effectiveMessage?.substring(0, 50));
      
      // Build comprehensive saved items context (like ask-olive-individual)
      const { data: allTasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, category, list_id, items, tags, priority, due_date, completed')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .order('created_at', { ascending: false })
        .limit(200);
      
      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name, description')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);
      
      const { data: memories } = await supabase
        .from('user_memories')
        .select('title, content, category')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(15);
      
      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);
      
      // Build rich saved items context
      let savedItemsContext = '\n## USER\'S LISTS AND SAVED ITEMS:\n';
      
      // Group tasks by list
      const tasksByList = new Map<string, any[]>();
      const uncategorizedTasks: any[] = [];
      
      allTasks?.forEach(task => {
        if (task.list_id && listIdToName.has(task.list_id)) {
          const listName = listIdToName.get(task.list_id);
          if (!tasksByList.has(listName)) {
            tasksByList.set(listName, []);
          }
          tasksByList.get(listName)!.push(task);
        } else {
          uncategorizedTasks.push(task);
        }
      });
      
      // Format lists with their items
      tasksByList.forEach((tasks, listName) => {
        savedItemsContext += `\n### ${listName}:\n`;
        tasks.slice(0, 20).forEach(task => {
          const status = task.completed ? '✓' : '○';
          const priority = task.priority === 'high' ? ' 🔥' : '';
          const dueInfo = task.due_date ? ` (Due: ${new Date(task.due_date).toLocaleDateString()})` : '';
          savedItemsContext += `- ${status} ${task.summary}${priority}${dueInfo}\n`;
          
          // Include sub-items if present
          if (task.items && task.items.length > 0) {
            task.items.slice(0, 5).forEach((item: string) => {
              savedItemsContext += `  • ${item}\n`;
            });
          }
        });
        if (tasks.length > 20) {
          savedItemsContext += `  ...and ${tasks.length - 20} more items\n`;
        }
      });
      
      // Add uncategorized tasks
      if (uncategorizedTasks.length > 0) {
        savedItemsContext += `\n### Uncategorized Tasks:\n`;
        uncategorizedTasks.slice(0, 10).forEach(task => {
          const status = task.completed ? '✓' : '○';
          savedItemsContext += `- ${status} ${task.summary}\n`;
        });
      }
      
      // Add memories context
      let memoryContext = '';
      if (memories && memories.length > 0) {
        memoryContext = '\n## USER MEMORIES & PREFERENCES:\n';
        memories.forEach(m => {
          memoryContext += `- ${m.title}: ${m.content}\n`;
        });
      }
      
      // Build the AI prompt
      const systemPrompt = `You are Olive, a friendly and intelligent AI assistant for the Olive app. The user is asking a question about their saved items.

CRITICAL INSTRUCTIONS:
1. You MUST answer based on the user's actual saved data provided below
2. Be specific - reference actual item names, lists, and details from their data
3. If they ask for recommendations, ONLY suggest items from their saved lists
4. If you can't find what they're looking for in their data, say so clearly
5. Be concise (max 400 chars for WhatsApp) but helpful
6. Use emojis sparingly for warmth

${savedItemsContext}
${memoryContext}

USER'S QUESTION: ${effectiveMessage}

Respond with helpful, specific information from their saved items. If asking for a restaurant, book, or recommendation, check their lists first!`;

      try {
        const response = await callAI(systemPrompt, effectiveMessage || '', 0.7);
        
        return new Response(
          createTwimlResponse(response.slice(0, 1500)),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } catch (error) {
        console.error('[WhatsApp] Contextual AI error:', error);
        
        // Fallback: Try to find relevant items manually
        const searchTerms = (effectiveMessage || '').toLowerCase().split(/\s+/);
        const matchingTasks = allTasks?.filter(t => 
          searchTerms.some(term => 
            t.summary.toLowerCase().includes(term) || 
            t.items?.some((i: string) => i.toLowerCase().includes(term))
          )
        ).slice(0, 5);
        
        if (matchingTasks && matchingTasks.length > 0) {
          const results = matchingTasks.map(t => `• ${t.summary}`).join('\n');
          return new Response(
            createTwimlResponse(`📋 Found these matching items:\n\n${results}\n\n🔗 Manage: https://witholive.app`),
            { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
          );
        }
        
        return new Response(
          createTwimlResponse('I couldn\'t find matching items in your lists. Try "show my tasks" to see everything.'),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
    }

    // ========================================================================
    // CHAT INTENT - Context-Aware Conversational AI Responses
    // ========================================================================
    if (intent === 'CHAT') {
      const chatType = (intentResult as any).chatType as ChatType || 'general';
      console.log('[WhatsApp] Processing CHAT intent, type:', chatType, 'message:', effectiveMessage?.substring(0, 50));
      
      // ================================================================
      // RICH CONTEXT FETCHING - Gather all relevant user data
      // ================================================================
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      
      // Fetch tasks with extended data for analysis
      const { data: allTasks } = await supabase
        .from('clerk_notes')
        .select('id, summary, due_date, completed, priority, category, list_id, items, created_at, updated_at, task_owner')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
        .order('created_at', { ascending: false })
        .limit(100);
      
      // Fetch user memories for personalization
      const { data: memories } = await supabase
        .from('user_memories')
        .select('title, content, category, importance')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('importance', { ascending: false })
        .limit(10);
      
      // Fetch behavioral patterns
      const { data: patterns } = await supabase
        .from('olive_patterns')
        .select('pattern_type, pattern_data, confidence')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('confidence', 0.6)
        .limit(5);
      
      // Fetch lists for context
      const { data: lists } = await supabase
        .from('clerk_lists')
        .select('id, name')
        .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`);
      
      const listIdToName = new Map(lists?.map(l => [l.id, l.name]) || []);
      
      // ================================================================
      // PARTNER CONTEXT - Fetch partner data when in a couple
      // ================================================================
      let partnerContext = '';
      let partnerName = '';
      
      if (coupleId) {
        try {
          // Get couple info and partner name
          const { data: coupleData } = await supabase
            .from('clerk_couples')
            .select('you_name, partner_name, created_by')
            .eq('id', coupleId)
            .single();
          
          if (coupleData) {
            // Determine which name belongs to partner based on who created the couple
            const isCreator = coupleData.created_by === userId;
            partnerName = isCreator ? (coupleData.partner_name || 'Partner') : (coupleData.you_name || 'Partner');
            
            // Get partner's user_id
            const { data: partnerMember } = await supabase
              .from('clerk_couple_members')
              .select('user_id')
              .eq('couple_id', coupleId)
              .neq('user_id', userId)
              .limit(1)
              .single();
            
            if (partnerMember?.user_id) {
              // Fetch partner's recent activity (last 48 hours)
              const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
              
              // Tasks partner added recently
              const { data: partnerRecentTasks } = await supabase
                .from('clerk_notes')
                .select('summary, created_at, priority')
                .eq('author_id', partnerMember.user_id)
                .eq('couple_id', coupleId)
                .gte('created_at', twoDaysAgo.toISOString())
                .order('created_at', { ascending: false })
                .limit(5);
              
              // Tasks assigned to current user by partner
              const { data: assignedByPartner } = await supabase
                .from('clerk_notes')
                .select('summary, due_date, priority')
                .eq('couple_id', coupleId)
                .eq('author_id', partnerMember.user_id)
                .eq('task_owner', userId)
                .eq('completed', false)
                .limit(3);
              
              // Tasks you assigned to partner
              const { data: assignedToPartner } = await supabase
                .from('clerk_notes')
                .select('summary, due_date, priority, completed')
                .eq('couple_id', coupleId)
                .eq('author_id', userId)
                .eq('task_owner', partnerMember.user_id)
                .eq('completed', false)
                .limit(3);
              
              // Build partner context string
              const partnerRecentSummaries = partnerRecentTasks?.slice(0, 3).map(t => t.summary) || [];
              const assignedToMe = assignedByPartner?.map(t => t.summary) || [];
              const myAssignments = assignedToPartner?.map(t => t.summary) || [];
              
              if (partnerRecentSummaries.length > 0 || assignedToMe.length > 0 || myAssignments.length > 0) {
                partnerContext = `
## Partner Activity (${partnerName}):
${partnerRecentSummaries.length > 0 ? `- Recently added: ${partnerRecentSummaries.join(', ')}` : ''}
${assignedToMe.length > 0 ? `- Assigned to you: ${assignedToMe.join(', ')}` : ''}
${myAssignments.length > 0 ? `- You assigned to ${partnerName}: ${myAssignments.join(', ')}` : ''}
`;
              }
            }
          }
        } catch (partnerErr) {
          console.error('[WhatsApp Chat] Partner context fetch error (non-blocking):', partnerErr);
        }
      }
      
      // ================================================================
      // CALENDAR EVENTS - Fetch for briefing context (today + tomorrow)
      // ================================================================
      let calendarContext = '';
      let todayEvents: Array<{ title: string; start_time: string; all_day: boolean }> = [];
      let tomorrowEvents: Array<{ title: string; start_time: string; all_day: boolean }> = [];
      
      // Detect if user is asking about tomorrow specifically
      const isTomorrowQuery = /\btomorrow\b/i.test(effectiveMessage || '');
      
      if (chatType === 'briefing') {
        try {
          // Get user's calendar connection
          const { data: calConnection } = await supabase
            .from('calendar_connections')
            .select('id, calendar_name')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1)
            .single();
          
          if (calConnection) {
            // Fetch today's events
            const todayStart = today.toISOString();
            const todayEnd = tomorrow.toISOString();
            
            const { data: events } = await supabase
              .from('calendar_events')
              .select('title, start_time, end_time, all_day, location')
              .eq('connection_id', calConnection.id)
              .gte('start_time', todayStart)
              .lt('start_time', todayEnd)
              .order('start_time', { ascending: true })
              .limit(10);
            
            todayEvents = events || [];
            
            // Also fetch tomorrow's events
            const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
            const { data: tmrwEvents } = await supabase
              .from('calendar_events')
              .select('title, start_time, end_time, all_day, location')
              .eq('connection_id', calConnection.id)
              .gte('start_time', tomorrow.toISOString())
              .lt('start_time', dayAfterTomorrow.toISOString())
              .order('start_time', { ascending: true })
              .limit(10);
            
            tomorrowEvents = tmrwEvents || [];
            
            const formatEvents = (evts: typeof todayEvents) => evts.map(e => {
              if (e.all_day) return `• ${e.title} (all day)`;
              const time = new Date(e.start_time).toLocaleTimeString('en-US', { 
                hour: 'numeric', minute: '2-digit', hour12: true 
              });
              return `• ${time}: ${e.title}`;
            }).join('\n');
            
            if (isTomorrowQuery) {
              // Focus on tomorrow's context
              calendarContext = tomorrowEvents.length > 0
                ? `\n## Tomorrow's Calendar (${tomorrowEvents.length} events):\n${formatEvents(tomorrowEvents)}\n`
                : '\n## Tomorrow\'s Calendar:\nNo events scheduled for tomorrow.\n';
            } else {
              // Show today (and tomorrow preview)
              calendarContext = todayEvents.length > 0
                ? `\n## Today's Calendar (${todayEvents.length} events):\n${formatEvents(todayEvents)}\n`
                : '\n## Today\'s Calendar:\nNo events scheduled today - clear schedule!\n';
              
              if (tomorrowEvents.length > 0) {
                calendarContext += `\n## Tomorrow Preview (${tomorrowEvents.length} events):\n${formatEvents(tomorrowEvents)}\n`;
              }
            }
          }
        } catch (calErr) {
          console.error('[WhatsApp Chat] Calendar fetch error (non-blocking):', calErr);
        }
      }
      
      // ================================================================
      // TASK ANALYTICS - Compute insights from task data
      // ================================================================
      const activeTasks = allTasks?.filter(t => !t.completed) || [];
      const completedTasks = allTasks?.filter(t => t.completed) || [];
      const urgentTasks = activeTasks.filter(t => t.priority === 'high');
      const overdueTasks = activeTasks.filter(t => t.due_date && new Date(t.due_date) < today);
      const dueTodayTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return dueDate >= today && dueDate < tomorrow;
      });
      const dueTomorrowTasks = activeTasks.filter(t => {
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
        return dueDate >= tomorrow && dueDate < dayAfterTomorrow;
      });
      
      // Weekly analytics
      const tasksCreatedThisWeek = allTasks?.filter(t => new Date(t.created_at) >= oneWeekAgo) || [];
      const tasksCompletedThisWeek = completedTasks.filter(t => 
        t.updated_at && new Date(t.updated_at) >= oneWeekAgo
      );
      
      // Category distribution
      const categoryCount: Record<string, number> = {};
      activeTasks.forEach(t => {
        const cat = t.category || 'uncategorized';
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
      });
      const topCategories = Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, count]) => `${cat}: ${count}`);
      
      // List distribution
      const listCount: Record<string, number> = {};
      activeTasks.forEach(t => {
        if (t.list_id) {
          const listName = listIdToName.get(t.list_id) || 'Unknown';
          listCount[listName] = (listCount[listName] || 0) + 1;
        }
      });
      const topLists = Object.entries(listCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([list, count]) => `${list}: ${count}`);
      
      // ================================================================
      // BUILD CONTEXT OBJECT FOR AI
      // ================================================================
      const taskContext = {
        total_active: activeTasks.length,
        urgent: urgentTasks.length,
        overdue: overdueTasks.length,
        due_today: dueTodayTasks.length,
        due_tomorrow: dueTomorrowTasks.length,
        created_this_week: tasksCreatedThisWeek.length,
        completed_this_week: tasksCompletedThisWeek.length,
        top_categories: topCategories,
        top_lists: topLists,
        completion_rate: tasksCreatedThisWeek.length > 0 
          ? Math.round((tasksCompletedThisWeek.length / tasksCreatedThisWeek.length) * 100)
          : 0
      };
      
      const memoryContext = memories?.map(m => `${m.title}: ${m.content}`).join('; ') || 'No personalization data yet.';
      
      const patternContext = patterns?.map(p => {
        const data = p.pattern_data as any;
        return `${p.pattern_type}: ${data.description || JSON.stringify(data)}`;
      }).join('; ') || 'No behavioral patterns detected yet.';
      
      // Top urgent/overdue for specific recommendations
      const topUrgentTasks = urgentTasks.slice(0, 3).map(t => t.summary);
      const topOverdueTasks = overdueTasks.slice(0, 3).map(t => t.summary);
      const topTodayTasks = dueTodayTasks.slice(0, 3).map(t => t.summary);
      
      // ================================================================
      // OLIVE SKILLS MATCHING - Check if a skill should enhance the response
      // ================================================================
      const skillMatch = await matchUserSkills(supabase, userId, effectiveMessage || '');
      let skillContext = '';
      
      if (skillMatch.matched && skillMatch.skill) {
        console.log(`[WhatsApp Chat] Skill matched: ${skillMatch.skill.name} via ${skillMatch.trigger_type}: ${skillMatch.matched_value}`);
        skillContext = `
## 🧩 Active Skill: ${skillMatch.skill.name}
${skillMatch.skill.content}

IMPORTANT: Use the above skill knowledge to enhance your response with domain-specific expertise.
`;
        
        // Track skill usage
        try {
          await supabase
            .from('olive_user_skills')
            .upsert({
              user_id: userId,
              skill_id: skillMatch.skill.skill_id,
              enabled: true,
              usage_count: 1,
              last_used_at: new Date().toISOString()
            }, {
              onConflict: 'user_id,skill_id'
            });
        } catch (trackErr) {
          console.warn('[Skills] Failed to track usage:', trackErr);
        }
      }
      
      // ================================================================
      // SPECIALIZED SYSTEM PROMPTS BY CHAT TYPE
      // ================================================================
      let systemPrompt: string;
      let userPromptEnhancement = '';
      
      const baseContext = `
## User Task Analytics:
- Active tasks: ${taskContext.total_active}
- Urgent (high priority): ${taskContext.urgent}
- Overdue: ${taskContext.overdue}
- Due today: ${taskContext.due_today}
- Due tomorrow: ${taskContext.due_tomorrow}
- Created this week: ${taskContext.created_this_week}
- Completed this week: ${taskContext.completed_this_week}
- Completion rate: ${taskContext.completion_rate}%
- Top categories: ${taskContext.top_categories.join(', ') || 'None'}
- Top lists: ${taskContext.top_lists.join(', ') || 'None'}

## User Memories/Preferences:
${memoryContext}

## Behavioral Patterns:
${patternContext}
${partnerContext}
${skillContext}
## Current Priorities:
- Urgent tasks: ${topUrgentTasks.join(', ') || 'None'}
- Overdue tasks: ${topOverdueTasks.join(', ') || 'None'}
- Due today: ${topTodayTasks.join(', ') || 'None'}
- Due tomorrow: ${dueTomorrowTasks.slice(0, 3).map(t => t.summary).join(', ') || 'None'}
`;
      
      switch (chatType) {
        case 'briefing':
          // Comprehensive briefing with schedule, focus, and partner context
          const briefingCalendar = calendarContext || '\n## Today\'s Calendar:\nNo calendar connected - connect in settings to see events!\n';
          const briefingPartner = partnerContext || (coupleId ? '' : '');
          
          // Determine if user is asking about tomorrow
          const briefingTimeframe = isTomorrowQuery ? 'tomorrow' : 'today';
          const briefingEmoji = isTomorrowQuery ? '📅' : '🌅';
          const briefingTitle = isTomorrowQuery ? 'Tomorrow\'s Preview' : 'Morning Briefing';
          
          systemPrompt = `You are Olive, providing a comprehensive ${briefingTitle} to help the user plan.

${baseContext}
${briefingCalendar}
${briefingPartner}
Your task: Deliver a complete but concise ${briefingTitle} focused on ${briefingTimeframe} (under 600 chars for WhatsApp).

Structure your response:
${briefingEmoji} **${briefingTitle}**

1. **Schedule Snapshot**: Mention ${briefingTimeframe}'s calendar events (if any) or note a clear schedule
2. **${isTomorrowQuery ? 'Tomorrow\'s' : 'Today\'s'} Focus**: Top 2-3 priorities ${isTomorrowQuery ? 'for tomorrow' : '(overdue first, then urgent, then due today)'}
3. **Quick Stats**: ${taskContext.total_active} active tasks, ${taskContext.urgent} urgent, ${taskContext.overdue} overdue, ${taskContext.due_tomorrow} due tomorrow
${partnerName ? `4. **${partnerName} Update**: Brief note on partner's recent activity or assignments (if any)` : ''}
5. **Encouragement**: One motivating line personalized to their situation

IMPORTANT: The user asked "${effectiveMessage}". If they ask about "tomorrow", focus on TOMORROW's tasks and events, not today's.

Be warm, organized, and actionable. Use emojis thoughtfully.`;
          userPromptEnhancement = isTomorrowQuery
            ? `\n\nGive me my complete preview for tomorrow.`
            : `\n\nGive me my complete morning briefing for today.`;
          break;
          
        case 'weekly_summary':
          systemPrompt = `You are Olive, a warm AI assistant providing a personalized weekly summary. 
          
${baseContext}

Your task: Provide a concise, encouraging weekly recap (under 400 chars for WhatsApp).
Include:
1. Tasks completed vs created (celebrate wins!)
2. Current workload snapshot
3. One actionable insight based on patterns
4. Brief motivational note

Use emojis thoughtfully. Be warm but concise.`;
          break;
          
        case 'daily_focus':
          systemPrompt = `You are Olive, helping the user prioritize their day.

${baseContext}

Your task: Suggest 2-3 specific tasks to focus on today (under 400 chars).
Prioritization logic:
1. FIRST: Overdue tasks (catch up!)
2. SECOND: Urgent/high-priority tasks  
3. THIRD: Tasks due today
4. Consider user's patterns and energy levels if known

Be specific - name actual tasks. Be encouraging but direct.`;
          userPromptEnhancement = `\n\nPlease recommend my top priorities for today based on my task data.`;
          break;
          
        case 'productivity_tips':
          systemPrompt = `You are Olive, providing personalized productivity advice.

${baseContext}

Your task: Give 2-3 specific, actionable productivity tips (under 500 chars).
Personalize based on:
- Their completion rate (${taskContext.completion_rate}%)
- Their overdue tasks (${taskContext.overdue})
- Their behavioral patterns
- Their categories/lists (what they're working on)

Avoid generic advice. Be specific to THEIR situation.`;
          break;
          
        case 'progress_check':
          systemPrompt = `You are Olive, giving an honest but supportive progress report.

${baseContext}

Your task: Provide a brief progress check (under 400 chars).
Include:
1. Completion rate assessment (${taskContext.completion_rate}%)
2. What's going well (celebrate!)
3. What needs attention (gently)
4. Quick tip for improvement

Be honest but encouraging. Never shame.`;
          break;
          
        case 'motivation':
          systemPrompt = `You are Olive, a supportive and understanding AI companion.

${baseContext}

The user seems stressed or needs motivation. Your task:
1. Acknowledge their feelings warmly
2. Put their workload in perspective
3. Suggest ONE small, achievable action
4. End with genuine encouragement

Keep under 400 chars. Be empathetic, not dismissive. No toxic positivity.`;
          break;
          
        case 'planning':
          systemPrompt = `You are Olive, helping the user plan ahead.

${baseContext}

Your task: Help them see what's coming and plan effectively (under 400 chars).
Consider:
- What's due soon (today, tomorrow, this week)
- What's overdue and needs rescheduling
- Suggest breaking down large tasks if needed

Be practical and forward-looking.`;
          break;
          
        case 'greeting':
          systemPrompt = `You are Olive, a warm and friendly AI assistant.

${baseContext}

The user is greeting you. Respond warmly (under 250 chars) with:
1. A friendly greeting back
2. A quick status hint (e.g., "You've got ${taskContext.urgent} urgent items" or "Looking good today!")
3. An offer to help

Be natural and personable.`;
          break;
          
        case 'help':
          systemPrompt = `You are Olive, explaining your capabilities.

Context: The user wants to know what you can do.

Response (under 400 chars):
Explain you can:
• Save tasks via brain dumps
• Track urgent/overdue items
• Summarize their week
• Give personalized focus recommendations
• Provide productivity tips
• Set reminders

Suggest trying: "What's urgent?", "Summarize my week", or "What should I focus on?"`;
          break;
          
        default: // 'general'
          systemPrompt = `You are Olive, a warm and helpful AI assistant for personal organization.

${baseContext}

Guidelines:
- Be friendly, concise, and helpful (under 350 chars for WhatsApp)
- Use the context above to personalize your response
- If they ask something you can help with (tasks, productivity), do so
- If they ask about specific tasks, use the data above
- Suggest relevant commands if appropriate ("what's urgent", "summarize my week", etc.)
- Use emojis warmly but sparingly 🫒`;
      }
      
      try {
        const enhancedMessage = (effectiveMessage || '') + userPromptEnhancement;
        console.log('[WhatsApp Chat] Calling AI for chatType:', chatType);
        
        const chatResponse = await callAI(systemPrompt, enhancedMessage, 0.7);
        
        return new Response(
          createTwimlResponse(chatResponse.slice(0, 1500)),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } catch (error) {
        console.error('[WhatsApp] Chat AI error:', error);
        
        // Fallback responses by type
        let fallbackMessage: string;
        switch (chatType) {
          case 'briefing':
            // Rich fallback briefing without AI
            const calEventCount = todayEvents.length;
            const calSummary = calEventCount > 0 
              ? `📅 ${calEventCount} event${calEventCount > 1 ? 's' : ''} today`
              : '📅 Clear calendar';
            const focusList = [
              ...topOverdueTasks.slice(0, 1).map(t => `⚠️ Overdue: ${t}`),
              ...topUrgentTasks.slice(0, 1).map(t => `🔥 Urgent: ${t}`),
              ...topTodayTasks.slice(0, 1).map(t => `📌 Due today: ${t}`)
            ].slice(0, 3);
            const partnerNote = partnerName ? `\n👥 ${partnerName}'s activity in the app` : '';
            
            fallbackMessage = `🌅 Morning Briefing\n\n${calSummary}\n\n🎯 Focus:\n${focusList.length > 0 ? focusList.join('\n') : '• No urgent items!'}\n\n📊 ${taskContext.total_active} active | ${taskContext.urgent} urgent | ${taskContext.overdue} overdue${partnerNote}\n\n✨ Have a great day!`;
            break;
          case 'weekly_summary':
            fallbackMessage = `📊 Your Week:\n• Created: ${taskContext.created_this_week} tasks\n• Completed: ${taskContext.completed_this_week}\n• Active: ${taskContext.total_active} (${taskContext.urgent} urgent)\n\n💡 Try "what's urgent?" for priorities`;
            break;
          case 'daily_focus':
            if (overdueTasks.length > 0) {
              fallbackMessage = `🎯 Focus Today:\n1. Clear overdue: ${topOverdueTasks[0] || 'Check your overdue items'}\n${topTodayTasks.length > 0 ? `2. Then: ${topTodayTasks[0]}` : ''}\n\n🔗 witholive.app`;
            } else if (dueTodayTasks.length > 0) {
              fallbackMessage = `🎯 Today's Priorities:\n${topTodayTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n✨ You've got this!`;
            } else {
              fallbackMessage = `🎯 No urgent deadlines today! Consider tackling urgent tasks:\n${topUrgentTasks[0] || 'Check your task list'}\n\n💪 Stay proactive!`;
            }
            break;
          case 'motivation':
            fallbackMessage = `💚 You're doing great! ${taskContext.completed_this_week} tasks done this week.\n\nOne step at a time. Start with just one small task - momentum builds! 🫒`;
            break;
          default:
            fallbackMessage = '🫒 Hi! I\'m Olive.\n\nTry:\n• "Morning briefing"\n• "Summarize my week"\n• "What should I focus on?"\n• "What\'s urgent?"\n\nOr just tell me what\'s on your mind!';
        }
        
        return new Response(
          createTwimlResponse(fallbackMessage),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
    }

    // ========================================================================
    // CREATE INTENT (Default) - Capture First
    // ========================================================================
    // Prepare note data - use effectiveMessage (stripped of prefix if any)
    const notePayload: any = { 
      text: effectiveMessage || '', 
      user_id: userId,
      couple_id: coupleId,
      timezone: profile.timezone || 'America/New_York',
      // Pass urgency flag from ! prefix
      force_priority: isUrgent ? 'high' : undefined
    };
    
    if (latitude && longitude) {
      notePayload.location = { latitude, longitude };
      if (notePayload.text) {
        notePayload.text = `${notePayload.text} (Location: ${latitude}, ${longitude})`;
      }
    }
    
    if (mediaUrls.length > 0) {
      notePayload.media = mediaUrls;
      notePayload.mediaTypes = mediaTypes; // Pass content types for PDF detection
      console.log('[WhatsApp] Sending', mediaUrls.length, 'media file(s) for AI processing, types:', mediaTypes);
    }

    // Process the note with AI
    const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
      body: notePayload
    });

    if (processError) {
      console.error('Error processing note:', processError);
      return new Response(
        createTwimlResponse('Sorry, I had trouble processing that. Please try again.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

    // Insert the processed note(s) into the database
    try {
      let insertedNoteId: string | null = null;
      let insertedNoteSummary: string = '';
      let insertedListId: string | null = null;
      
      // Random tips for unique notes
      const randomTips = [
        "Reply 'Make it urgent' to change priority",
        "Reply 'Show my tasks' to see your list",
        "You can send voice notes too! 🎤",
        "Reply 'Move to Work' to switch lists",
        "Use ! prefix for urgent tasks (e.g., !call mom)"
      ];
      const getRandomTip = () => randomTips[Math.floor(Math.random() * randomTips.length)];
      
      // Helper to get list name from list_id
      async function getListName(listId: string | null): Promise<string> {
        if (!listId) return 'Tasks';
        
        const { data: list } = await supabase
          .from('clerk_lists')
          .select('name')
          .eq('id', listId)
          .single();
        
        return list?.name || 'Tasks';
      }
      
      if (processData.multiple && Array.isArray(processData.notes)) {
        // Insert multiple notes
        const notesToInsert = processData.notes.map((note: any) => ({
          author_id: userId,
          couple_id: coupleId,
          original_text: messageBody,
          summary: note.summary,
          category: note.category || 'task',
          due_date: note.due_date,
          reminder_time: note.reminder_time,
          recurrence_frequency: note.recurrence_frequency,
          recurrence_interval: note.recurrence_interval,
          priority: isUrgent ? 'high' : (note.priority || 'medium'),
          tags: note.tags || [],
          items: note.items || [],
          task_owner: note.task_owner,
          list_id: note.list_id,
          location: latitude && longitude ? { latitude, longitude } : null,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null,
          completed: false
        }));

        const { data: insertedNotes, error: insertError } = await supabase
          .from('clerk_notes')
          .insert(notesToInsert)
          .select('id, summary, list_id');

        if (insertError) throw insertError;

        // Get list name for the first item (they likely share the same list)
        const primaryListId = insertedNotes?.[0]?.list_id;
        const listName = await getListName(primaryListId);
        
        const count = processData.notes.length;
        const itemsList = insertedNotes?.slice(0, 3).map(n => `• ${n.summary}`).join('\n') || '';
        const moreText = count > 3 ? `\n...and ${count - 3} more` : '';
        
        return new Response(
          createTwimlResponse(`✅ Saved ${count} items!\n${itemsList}${moreText}\n\n📂 Added to: ${listName}\n\n🔗 Manage: https://witholive.app\n\n💡 ${getRandomTip()}`),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      } else {
        // Single note
        const noteData = {
          author_id: userId,
          couple_id: coupleId,
          original_text: messageBody,
          summary: processData.summary,
          category: processData.category || 'task',
          due_date: processData.due_date,
          reminder_time: processData.reminder_time,
          recurrence_frequency: processData.recurrence_frequency,
          recurrence_interval: processData.recurrence_interval,
          priority: isUrgent ? 'high' : (processData.priority || 'medium'),
          tags: processData.tags || [],
          items: processData.items || [],
          task_owner: processData.task_owner,
          list_id: processData.list_id,
          location: latitude && longitude ? { latitude, longitude } : null,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null,
          completed: false
        };

        const { data: insertedNote, error: insertError } = await supabase
          .from('clerk_notes')
          .insert(noteData)
          .select('id, summary, list_id')
          .single();

        if (insertError) throw insertError;

        insertedNoteId = insertedNote.id;
        insertedNoteSummary = insertedNote.summary;
        insertedListId = insertedNote.list_id;

        // Get the list name for rich feedback
        const listName = await getListName(insertedListId);

        // ================================================================
        // POST-INSERTION: Background Duplicate Detection
        // ================================================================
        let duplicateWarning: { found: boolean; targetId: string; targetTitle: string } | null = null;

        try {
          // Generate embedding for the new note
          const embedding = await generateEmbedding(insertedNoteSummary);
          
          if (embedding && insertedNoteId) {
            // Store the embedding for future similarity searches
            await supabase
              .from('clerk_notes')
              .update({ embedding: JSON.stringify(embedding) })
              .eq('id', insertedNoteId);

            // Search for similar existing notes (only if coupleId is available and not null)
            const similarNote = (coupleId && typeof coupleId === 'string') ? await findSimilarNotes(supabase, userId, coupleId, embedding, insertedNoteId) : null;
            
            if (similarNote) {
              duplicateWarning = {
                found: true,
                targetId: similarNote.id,
                targetTitle: similarNote.summary
              };
              console.log('[Duplicate Detection] Found similar note:', similarNote.summary, 'similarity:', similarNote.similarity);
            }
          }
        } catch (dupError) {
          console.error('Duplicate detection error (non-blocking):', dupError);
          // Non-blocking - continue with the response even if duplicate detection fails
        }

        // ================================================================
        // RICH RESPONSE BUILDER
        // ================================================================
        let confirmationMessage: string;
        
        if (duplicateWarning?.found) {
          // Scenario B: Duplicate detected - no tip to avoid clutter
          confirmationMessage = [
            `✅ Saved: ${insertedNoteSummary}`,
            `📂 Added to: ${listName}`,
            ``,
            `⚠️ Similar task found: "${duplicateWarning.targetTitle}"`,
            `Reply "Merge" to combine them.`
          ].join('\n');
        } else {
          // Scenario A: Unique note - include tip
          confirmationMessage = [
            `✅ Saved: ${insertedNoteSummary}`,
            `📂 Added to: ${listName}`,
            ``,
            `🔗 Manage: https://witholive.app`,
            ``,
            `💡 ${getRandomTip()}`
          ].join('\n');
        }
        
        return new Response(
          createTwimlResponse(confirmationMessage),
          { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
        );
      }
    } catch (insertError) {
      console.error('Database insertion error:', insertError);
      return new Response(
        createTwimlResponse('I understood your task but had trouble saving it. Please try again.'),
        { headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
      );
    }

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    return new Response(
      createTwimlResponse('Sorry, something went wrong. Please try again later. 🔄'),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
    );
  }
});
