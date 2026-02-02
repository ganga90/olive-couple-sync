/**
 * PROCESS-RECEIPT Edge Function
 * ============================================================================
 * Feature 1: Context-Aware Receipt Hunter
 *
 * Flow: Image → Gemini Flash (JSON) → Supabase DB → Budget Logic Check → Response
 *
 * This function:
 * 1. Receives a receipt image (URL or base64)
 * 2. Uses Gemini Vision to extract structured receipt data
 * 3. Checks against user's budget limits
 * 4. Creates a transaction record
 * 5. Returns the result with budget alerts if applicable
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ReceiptData {
  merchant: string;
  amount: number;
  date: string;  // ISO format YYYY-MM-DD
  category: string;
  line_items: LineItem[];
  payment_method: string;
  confidence: number;
}

interface LineItem {
  name: string;
  quantity: number;
  price: number;
}

interface BudgetCheck {
  status: 'ok' | 'warning' | 'over_limit';
  message: string | null;
  summary: {
    spent: number;
    limit: number;
    percentage: number;
    remaining?: number;
    overage?: number;
  } | null;
}

interface ProcessReceiptRequest {
  image_url?: string;
  base64_image?: string;
  user_id: string;
  couple_id?: string;
  source_note_id?: string;
}

// ============================================================================
// RECEIPT EXTRACTION SCHEMA (Gemini Structured Output)
// ============================================================================

const receiptExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    merchant: {
      type: Type.STRING,
      description: "Store name exactly as shown on receipt"
    },
    amount: {
      type: Type.NUMBER,
      description: "Total amount as a number (no currency symbols)"
    },
    date: {
      type: Type.STRING,
      description: "Transaction date in ISO format YYYY-MM-DD"
    },
    category: {
      type: Type.STRING,
      enum: [
        "Groceries", "Dining", "Travel", "Utilities", "Entertainment",
        "Shopping", "Health", "Transportation", "Subscriptions", "Other"
      ],
      description: "Category of the purchase"
    },
    line_items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          price: { type: Type.NUMBER }
        },
        required: ["name", "price"]
      },
      description: "Individual items on the receipt"
    },
    payment_method: {
      type: Type.STRING,
      enum: ["card", "cash", "debit", "credit", "unknown"],
      description: "Payment method used"
    },
    confidence: {
      type: Type.NUMBER,
      description: "Confidence level 0-1 of the extraction accuracy"
    }
  },
  required: ["merchant", "amount", "date", "category", "confidence"]
};

// ============================================================================
// GEMINI RECEIPT EXTRACTION
// ============================================================================

const RECEIPT_EXTRACTION_PROMPT = `You are a precise receipt parser. Extract data from this receipt image and return ONLY valid JSON.

EXTRACTION RULES:
1. merchant: Extract the store/restaurant name exactly as shown
2. amount: The TOTAL amount paid (look for "Total", "Grand Total", "Amount Due")
   - Must be a number without currency symbols
   - If unclear, use the largest amount shown
3. date: Transaction date in YYYY-MM-DD format
   - If only month/day shown, assume current year
   - If no date visible, use today's date
4. category: Choose the most appropriate category:
   - Groceries: Supermarkets, food stores (Whole Foods, Trader Joe's, Safeway)
   - Dining: Restaurants, cafes, bars, fast food
   - Travel: Hotels, flights, Uber/Lyft, parking
   - Utilities: Electric, gas, water, internet, phone
   - Entertainment: Movies, concerts, streaming, games
   - Shopping: Clothing, electronics, Amazon, general retail
   - Health: Pharmacy, doctor, gym, supplements
   - Transportation: Gas stations, car maintenance, public transit
   - Subscriptions: Recurring services, memberships
   - Other: Anything else
5. line_items: Extract individual items if clearly visible
   - quantity defaults to 1 if not shown
   - price should be the item's price
6. payment_method: card/cash/debit/credit/unknown
7. confidence: Your confidence in the extraction (0.0 to 1.0)
   - 0.9+ for clear receipts
   - 0.7-0.9 for partially readable
   - Below 0.7 for unclear/damaged

IMPORTANT:
- If any field is unclear, use your best judgment
- line_items can be empty array if not readable
- Always return valid JSON matching the schema`;

async function extractReceiptWithGemini(
  genai: GoogleGenAI,
  imageData: string,
  mimeType: string = 'image/jpeg'
): Promise<ReceiptData> {
  console.log('[process-receipt] Extracting receipt data with Gemini...');

  try {
    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: RECEIPT_EXTRACTION_PROMPT },
            {
              inlineData: {
                mimeType: mimeType,
                data: imageData
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: receiptExtractionSchema,
        temperature: 0.1,
        maxOutputTokens: 1000
      }
    });

    const responseText = response.text || '';
    console.log('[process-receipt] Gemini response:', responseText);

    const parsed = JSON.parse(responseText);

    // Validate and normalize the response
    return {
      merchant: parsed.merchant || 'Unknown Store',
      amount: typeof parsed.amount === 'number' ? parsed.amount : parseFloat(parsed.amount) || 0,
      date: parsed.date || new Date().toISOString().split('T')[0],
      category: parsed.category || 'Other',
      line_items: Array.isArray(parsed.line_items) ? parsed.line_items : [],
      payment_method: parsed.payment_method || 'unknown',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
    };

  } catch (error) {
    console.error('[process-receipt] Gemini extraction error:', error);
    throw new Error(`Failed to extract receipt data: ${error}`);
  }
}

// ============================================================================
// BUDGET CHECK LOGIC
// ============================================================================

async function checkBudgetStatus(
  supabase: SupabaseClient,
  userId: string,
  coupleId: string | null,
  category: string,
  newAmount: number
): Promise<BudgetCheck> {
  console.log('[process-receipt] Checking budget for category:', category);

  try {
    // Use the database function for budget check
    const { data, error } = await supabase.rpc('check_budget_status', {
      p_user_id: userId,
      p_category: category,
      p_new_amount: newAmount
    });

    if (error) {
      console.error('[process-receipt] Budget check RPC error:', error);
      // Return ok status if budget check fails - don't block transaction
      return { status: 'ok', message: null, summary: null };
    }

    if (!data || data.length === 0 || !data[0].limit_amount) {
      // No budget set for this category
      console.log('[process-receipt] No budget found for category:', category);
      return { status: 'ok', message: null, summary: null };
    }

    const budgetData = data[0];
    const status = budgetData.status as 'ok' | 'warning' | 'over_limit';

    let message: string | null = null;

    if (status === 'over_limit') {
      const overage = Math.abs(budgetData.remaining);
      message = `You are now $${overage.toFixed(2)} over your ${category} budget!`;
    } else if (status === 'warning') {
      const remaining = budgetData.remaining;
      const percentage = budgetData.percentage;
      message = `Heads up: You've used ${percentage.toFixed(0)}% of your ${category} budget. $${remaining.toFixed(2)} remaining.`;
    }

    return {
      status,
      message,
      summary: {
        spent: budgetData.new_total,
        limit: budgetData.limit_amount,
        percentage: budgetData.percentage,
        remaining: status !== 'over_limit' ? budgetData.remaining : undefined,
        overage: status === 'over_limit' ? Math.abs(budgetData.remaining) : undefined
      }
    };

  } catch (error) {
    console.error('[process-receipt] Budget check error:', error);
    return { status: 'ok', message: null, summary: null };
  }
}

// ============================================================================
// INSERT TRANSACTION
// ============================================================================

async function insertTransaction(
  supabase: SupabaseClient,
  userId: string,
  coupleId: string | null,
  receiptData: ReceiptData,
  budgetStatus: 'ok' | 'warning' | 'over_limit',
  imageUrl: string | null,
  sourceNoteId: string | null
): Promise<any> {
  console.log('[process-receipt] Inserting transaction...');

  const transactionData = {
    user_id: userId,
    couple_id: coupleId || null,
    amount: receiptData.amount,
    merchant: receiptData.merchant,
    category: receiptData.category,
    transaction_date: receiptData.date,
    line_items: receiptData.line_items,
    payment_method: receiptData.payment_method,
    confidence: receiptData.confidence,
    budget_status: budgetStatus,
    image_url: imageUrl,
    source_note_id: sourceNoteId || null,
    metadata: {
      extracted_at: new Date().toISOString(),
      extraction_confidence: receiptData.confidence
    }
  };

  const { data, error } = await supabase
    .from('transactions')
    .insert(transactionData)
    .select()
    .single();

  if (error) {
    console.error('[process-receipt] Insert transaction error:', error);
    throw new Error(`Failed to save transaction: ${error.message}`);
  }

  console.log('[process-receipt] Transaction saved:', data.id);
  return data;
}

// ============================================================================
// IMAGE PROCESSING HELPERS
// ============================================================================

async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  console.log('[process-receipt] Fetching image from URL...');

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();

  // Convert to base64 in chunks to avoid stack overflow
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  const base64 = btoa(binary);

  const mimeType = blob.type || 'image/jpeg';

  console.log('[process-receipt] Image fetched, size:', blob.size, 'type:', mimeType);
  return { base64, mimeType };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API key is not configured');
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase configuration is missing');
    }

    const body: ProcessReceiptRequest = await req.json();
    const { image_url, base64_image, user_id, couple_id, source_note_id } = body;

    // Validate required fields
    if (!user_id) {
      throw new Error('Missing required field: user_id');
    }

    if (!image_url && !base64_image) {
      throw new Error('Missing required field: image_url or base64_image');
    }

    console.log('[process-receipt] Processing receipt for user:', user_id);

    // Initialize clients
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Get image data
    let imageData: string;
    let mimeType: string;

    if (base64_image) {
      imageData = base64_image;
      mimeType = 'image/jpeg';  // Assume JPEG if not specified
    } else if (image_url) {
      const fetched = await fetchImageAsBase64(image_url);
      imageData = fetched.base64;
      mimeType = fetched.mimeType;
    } else {
      throw new Error('No image provided');
    }

    // Step 1: Extract receipt data with Gemini
    const receiptData = await extractReceiptWithGemini(genai, imageData, mimeType);
    console.log('[process-receipt] Extracted receipt data:', receiptData);

    // Step 2: Check budget status
    const budgetCheck = await checkBudgetStatus(
      supabase,
      user_id,
      couple_id || null,
      receiptData.category,
      receiptData.amount
    );
    console.log('[process-receipt] Budget check result:', budgetCheck);

    // Step 3: Save transaction
    const transaction = await insertTransaction(
      supabase,
      user_id,
      couple_id || null,
      receiptData,
      budgetCheck.status,
      image_url || null,
      source_note_id || null
    );

    // Step 4: If budget alert, create notification
    if (budgetCheck.status !== 'ok' && budgetCheck.message) {
      try {
        await supabase.from('notifications').insert({
          user_id: user_id,
          couple_id: couple_id || null,
          type: budgetCheck.status === 'over_limit' ? 'budget_exceeded' : 'budget_warning',
          title: budgetCheck.status === 'over_limit' ? 'Budget Exceeded!' : 'Budget Warning',
          message: budgetCheck.message,
          priority: budgetCheck.status === 'over_limit' ? 9 : 7,
          source_type: 'transaction',
          source_id: transaction.id,
          metadata: {
            category: receiptData.category,
            amount: receiptData.amount,
            merchant: receiptData.merchant,
            budget_summary: budgetCheck.summary
          }
        });
        console.log('[process-receipt] Budget notification created');
      } catch (notifError) {
        console.warn('[process-receipt] Failed to create notification:', notifError);
      }
    }

    // Build response
    const response = {
      success: true,
      transaction: {
        id: transaction.id,
        merchant: receiptData.merchant,
        amount: receiptData.amount,
        category: receiptData.category,
        date: receiptData.date,
        line_items: receiptData.line_items,
        confidence: receiptData.confidence
      },
      alert: budgetCheck.status !== 'ok',
      budget_status: budgetCheck.status,
      budget_message: budgetCheck.message,
      budget_summary: budgetCheck.summary
    };

    console.log('[process-receipt] Complete. Alert:', response.alert);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[process-receipt] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || 'Unknown error occurred'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
