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
    console.error('[Deepgram Relay] DEEPGRAM_OLIVE_AI environment variable not set');
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
      // Connect directly to Deepgram using API key (simpler than token approach)
      const deepgramUrl = new URL('wss://api.deepgram.com/v1/listen');
      deepgramUrl.searchParams.set('model', 'nova-2');
      deepgramUrl.searchParams.set('smart_format', 'true');
      deepgramUrl.searchParams.set('interim_results', 'true');
      deepgramUrl.searchParams.set('punctuate', 'true');

      console.log('[Deepgram Relay] Connecting to Deepgram with API key...');
      deepgramSocket = new WebSocket(deepgramUrl.toString(), [], {
        headers: {
          'Authorization': `Token ${DEEPGRAM_KEY}`,
        },
      });

      deepgramSocket.onopen = () => {
        console.log('[Deepgram Relay] Connected to Deepgram successfully');
        socket.send(JSON.stringify({ type: 'connected' }));
      };

      deepgramSocket.onmessage = (event) => {
        try {
          const data = typeof event.data === 'string' ? event.data : event.data.toString();
          console.log('[Deepgram Relay] Received from Deepgram:', data.substring(0, 100));
          socket.send(data);
        } catch (e) {
          console.error('[Deepgram Relay] Error forwarding message:', e);
        }
      };

      deepgramSocket.onerror = (error) => {
        console.error('[Deepgram Relay] Deepgram WebSocket error:', error);
        socket.send(JSON.stringify({ 
          type: 'error', 
          message: 'Failed to connect to Deepgram service' 
        }));
      };

      deepgramSocket.onclose = (event) => {
        console.log('[Deepgram Relay] Deepgram connection closed:', event.code, event.reason);
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(event.code, event.reason);
        }
      };

      // Set a timeout for connection
      setTimeout(() => {
        if (deepgramSocket.readyState !== WebSocket.OPEN) {
          console.error('[Deepgram Relay] Connection timeout');
          deepgramSocket.close();
          socket.send(JSON.stringify({ 
            type: 'error', 
            message: 'Connection timeout' 
          }));
        }
      }, 10000);

    } catch (error) {
      console.error('[Deepgram Relay] Setup error:', error);
      socket.send(JSON.stringify({ 
        type: 'error', 
        message: `Setup failed: ${error.message}` 
      }));
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