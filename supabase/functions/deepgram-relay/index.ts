import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  const { headers } = req;
  const upgrade = headers.get("upgrade") || "";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { 
      status: 400, 
      headers: corsHeaders 
    });
  }

  const DEEPGRAM_KEY = Deno.env.get('DEEPGRAM_OLIVE_AI');
  if (!DEEPGRAM_KEY) {
    return new Response("Deepgram API key not configured", { 
      status: 500, 
      headers: corsHeaders 
    });
  }

  console.log('[Deepgram Relay] Upgrading to WebSocket');
  const { socket, response } = Deno.upgradeWebSocket(req);

  let deepgramSocket: WebSocket | null = null;

  socket.onopen = async () => {
    console.log('[Deepgram Relay] Client connected');
    
    try {
      // Get temporary token from Deepgram
      const tokenResponse = await fetch('https://api.deepgram.com/v1/auth/grant', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${DEEPGRAM_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 300 }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('[Deepgram Relay] Token generation failed:', errorText);
        socket.close(1011, 'Token generation failed');
        return;
      }

      const tokenData = await tokenResponse.json();
      const token = tokenData.access_token;

      // Build Deepgram WebSocket URL
      const deepgramUrl = new URL('wss://api.deepgram.com/v1/listen');
      deepgramUrl.searchParams.set('model', 'nova-2');
      deepgramUrl.searchParams.set('smart_format', 'true');
      deepgramUrl.searchParams.set('interim_results', 'true');
      deepgramUrl.searchParams.set('punctuate', 'true');
      deepgramUrl.searchParams.set('token', token);

      console.log('[Deepgram Relay] Connecting to Deepgram...');
      deepgramSocket = new WebSocket(deepgramUrl.toString());

      deepgramSocket.onopen = () => {
        console.log('[Deepgram Relay] Connected to Deepgram');
        socket.send(JSON.stringify({ type: 'connected' }));
      };

      deepgramSocket.onmessage = (event) => {
        console.log('[Deepgram Relay] Received from Deepgram:', event.data);
        socket.send(event.data);
      };

      deepgramSocket.onerror = (error) => {
        console.error('[Deepgram Relay] Deepgram error:', error);
        socket.send(JSON.stringify({ 
          type: 'error', 
          message: 'Deepgram connection error' 
        }));
      };

      deepgramSocket.onclose = (event) => {
        console.log('[Deepgram Relay] Deepgram closed:', event.code, event.reason);
        socket.close(event.code, event.reason);
      };

    } catch (error) {
      console.error('[Deepgram Relay] Setup error:', error);
      socket.close(1011, 'Setup failed');
    }
  };

  socket.onmessage = (event) => {
    console.log('[Deepgram Relay] Received from client, forwarding to Deepgram');
    if (deepgramSocket && deepgramSocket.readyState === WebSocket.OPEN) {
      deepgramSocket.send(event.data);
    }
  };

  socket.onclose = () => {
    console.log('[Deepgram Relay] Client disconnected');
    if (deepgramSocket) {
      deepgramSocket.close();
    }
  };

  socket.onerror = (error) => {
    console.error('[Deepgram Relay] Client error:', error);
  };

  return response;
});