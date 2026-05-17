/**
 * Olive MCP Client
 *
 * Allows Olive to connect to MCP servers (e.g., calendar, email, files)
 * to extend its capabilities.
 *
 * This is a lightweight client implementation suitable for browser/mobile.
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPServerConfig {
  name: string;
  description?: string;
  endpoint: string; // WebSocket or HTTP endpoint
  apiKey?: string;
}

export interface MCPClientOptions {
  onToolResult?: (tool: string, result: any) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * MCP Client for connecting Olive to external MCP servers
 */
export class MCPClient {
  private servers: Map<string, MCPServerConfig> = new Map();
  private connections: Map<string, WebSocket> = new Map();
  private tools: Map<string, MCPTool[]> = new Map();
  private resources: Map<string, MCPResource[]> = new Map();
  private prompts: Map<string, MCPPrompt[]> = new Map();
  private options: MCPClientOptions;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();

  constructor(options: MCPClientOptions = {}) {
    this.options = options;
  }

  /**
   * Register an MCP server
   */
  addServer(config: MCPServerConfig): void {
    this.servers.set(config.name, config);
  }

  /**
   * Connect to a registered server
   */
  async connect(serverName: string): Promise<void> {
    const config = this.servers.get(serverName);
    if (!config) {
      throw new Error(`Server "${serverName}" not registered`);
    }

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(config.endpoint);

        ws.onopen = async () => {
          console.log(`[MCP] Connected to ${serverName}`);
          this.connections.set(serverName, ws);
          this.options.onConnectionChange?.(true);

          // Initialize - get capabilities
          try {
            await this.initialize(serverName);
            await this.discoverCapabilities(serverName);
            resolve();
          } catch (err) {
            reject(err);
          }
        };

        ws.onmessage = (event) => {
          this.handleMessage(serverName, event.data);
        };

        ws.onerror = (error) => {
          console.error(`[MCP] Error with ${serverName}:`, error);
          this.options.onError?.(new Error(`WebSocket error: ${error}`));
        };

        ws.onclose = () => {
          console.log(`[MCP] Disconnected from ${serverName}`);
          this.connections.delete(serverName);
          this.tools.delete(serverName);
          this.resources.delete(serverName);
          this.prompts.delete(serverName);
          this.options.onConnectionChange?.(false);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from a server
   */
  disconnect(serverName: string): void {
    const ws = this.connections.get(serverName);
    if (ws) {
      ws.close();
    }
  }

  /**
   * Disconnect from all servers
   */
  disconnectAll(): void {
    for (const serverName of this.connections.keys()) {
      this.disconnect(serverName);
    }
  }

  /**
   * Send a request to a server
   */
  private async sendRequest(serverName: string, method: string, params?: any): Promise<any> {
    const ws = this.connections.get(serverName);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Not connected to ${serverName}`);
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      ws.send(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(serverName: string, data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.id && this.pendingRequests.has(message.id)) {
        const { resolve, reject } = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);

        if (message.error) {
          reject(new Error(message.error.message || 'Request failed'));
        } else {
          resolve(message.result);
        }
      }
    } catch (error) {
      console.error('[MCP] Failed to parse message:', error);
    }
  }

  /**
   * Initialize connection with server
   */
  private async initialize(serverName: string): Promise<void> {
    await this.sendRequest(serverName, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        sampling: {},
      },
      clientInfo: {
        name: 'olive-app',
        version: '1.0.0',
      },
    });
  }

  /**
   * Discover server capabilities
   */
  private async discoverCapabilities(serverName: string): Promise<void> {
    // Get tools
    try {
      const toolsResult = await this.sendRequest(serverName, 'tools/list', {});
      this.tools.set(serverName, toolsResult.tools || []);
    } catch (e) {
      console.log(`[MCP] ${serverName} doesn't support tools`);
    }

    // Get resources
    try {
      const resourcesResult = await this.sendRequest(serverName, 'resources/list', {});
      this.resources.set(serverName, resourcesResult.resources || []);
    } catch (e) {
      console.log(`[MCP] ${serverName} doesn't support resources`);
    }

    // Get prompts
    try {
      const promptsResult = await this.sendRequest(serverName, 'prompts/list', {});
      this.prompts.set(serverName, promptsResult.prompts || []);
    } catch (e) {
      console.log(`[MCP] ${serverName} doesn't support prompts`);
    }
  }

  /**
   * Get available tools from all connected servers
   */
  getAllTools(): Array<{ server: string; tool: MCPTool }> {
    const result: Array<{ server: string; tool: MCPTool }> = [];
    for (const [server, tools] of this.tools.entries()) {
      for (const tool of tools) {
        result.push({ server, tool });
      }
    }
    return result;
  }

  /**
   * Get available resources from all connected servers
   */
  getAllResources(): Array<{ server: string; resource: MCPResource }> {
    const result: Array<{ server: string; resource: MCPResource }> = [];
    for (const [server, resources] of this.resources.entries()) {
      for (const resource of resources) {
        result.push({ server, resource });
      }
    }
    return result;
  }

  /**
   * Call a tool on a server
   */
  async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<any> {
    const result = await this.sendRequest(serverName, 'tools/call', {
      name: toolName,
      arguments: args,
    });

    this.options.onToolResult?.(toolName, result);
    return result;
  }

  /**
   * Read a resource from a server
   */
  async readResource(serverName: string, uri: string): Promise<any> {
    const result = await this.sendRequest(serverName, 'resources/read', { uri });
    return result;
  }

  /**
   * Get a prompt from a server
   */
  async getPrompt(serverName: string, promptName: string, args?: Record<string, any>): Promise<any> {
    const result = await this.sendRequest(serverName, 'prompts/get', {
      name: promptName,
      arguments: args,
    });
    return result;
  }

  /**
   * Check if connected to a server
   */
  isConnected(serverName: string): boolean {
    const ws = this.connections.get(serverName);
    return ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get list of connected servers
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys()).filter(name =>
      this.connections.get(name)?.readyState === WebSocket.OPEN
    );
  }
}

// Singleton instance
let mcpClient: MCPClient | null = null;

/**
 * Get or create the MCP client instance
 */
export function getMCPClient(options?: MCPClientOptions): MCPClient {
  if (!mcpClient) {
    mcpClient = new MCPClient(options);
  }
  return mcpClient;
}

/**
 * Pre-configured MCP servers that Olive can connect to
 */
export const OLIVE_MCP_INTEGRATIONS = {
  // Example integrations - these would need actual endpoints
  calendar: {
    name: 'calendar',
    description: 'Google Calendar integration via MCP',
    endpoint: 'wss://mcp.witholive.app/calendar',
  },
  email: {
    name: 'email',
    description: 'Email integration via MCP',
    endpoint: 'wss://mcp.witholive.app/email',
  },
  files: {
    name: 'files',
    description: 'File storage integration via MCP',
    endpoint: 'wss://mcp.witholive.app/files',
  },
};
