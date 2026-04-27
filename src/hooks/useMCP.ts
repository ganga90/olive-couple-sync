/**
 * React hook for MCP (Model Context Protocol) integration
 *
 * Provides a simple interface for React components to interact with
 * MCP servers and extend Olive's capabilities.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MCPClient,
  MCPServerConfig,
  MCPTool,
  MCPResource,
  getMCPClient,
} from '@/lib/mcp/client';

export interface UseMCPOptions {
  autoConnect?: boolean;
  servers?: MCPServerConfig[];
}

export interface UseMCPReturn {
  // Connection state
  isConnected: boolean;
  connectedServers: string[];
  isConnecting: boolean;
  error: Error | null;

  // Capabilities
  tools: Array<{ server: string; tool: MCPTool }>;
  resources: Array<{ server: string; resource: MCPResource }>;

  // Actions
  connect: (serverName: string) => Promise<void>;
  disconnect: (serverName: string) => void;
  disconnectAll: () => void;
  addServer: (config: MCPServerConfig) => void;

  // Tool execution
  callTool: (serverName: string, toolName: string, args: Record<string, any>) => Promise<any>;
  readResource: (serverName: string, uri: string) => Promise<any>;

  // Client instance (for advanced usage)
  client: MCPClient;
}

/**
 * Hook for MCP integration
 */
export function useMCP(options: UseMCPOptions = {}): UseMCPReturn {
  const { autoConnect = false, servers = [] } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [connectedServers, setConnectedServers] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tools, setTools] = useState<Array<{ server: string; tool: MCPTool }>>([]);
  const [resources, setResources] = useState<Array<{ server: string; resource: MCPResource }>>([]);

  const clientRef = useRef<MCPClient | null>(null);

  // Initialize client
  useEffect(() => {
    clientRef.current = getMCPClient({
      onConnectionChange: (connected) => {
        setIsConnected(connected);
        updateCapabilities();
      },
      onError: (err) => {
        setError(err);
      },
    });

    // Add configured servers
    servers.forEach(server => {
      clientRef.current?.addServer(server);
    });

    // Auto-connect if enabled
    if (autoConnect && servers.length > 0) {
      servers.forEach(server => {
        connect(server.name).catch(console.error);
      });
    }

    return () => {
      clientRef.current?.disconnectAll();
    };
  }, []);

  // Update capabilities from all connected servers
  const updateCapabilities = useCallback(() => {
    if (clientRef.current) {
      setTools(clientRef.current.getAllTools());
      setResources(clientRef.current.getAllResources());
      setConnectedServers(clientRef.current.getConnectedServers());
    }
  }, []);

  // Connect to a server
  const connect = useCallback(async (serverName: string) => {
    if (!clientRef.current) return;

    setIsConnecting(true);
    setError(null);

    try {
      await clientRef.current.connect(serverName);
      updateCapabilities();
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [updateCapabilities]);

  // Disconnect from a server
  const disconnect = useCallback((serverName: string) => {
    clientRef.current?.disconnect(serverName);
    updateCapabilities();
  }, [updateCapabilities]);

  // Disconnect from all servers
  const disconnectAll = useCallback(() => {
    clientRef.current?.disconnectAll();
    updateCapabilities();
  }, [updateCapabilities]);

  // Add a server configuration
  const addServer = useCallback((config: MCPServerConfig) => {
    clientRef.current?.addServer(config);
  }, []);

  // Call a tool
  const callTool = useCallback(async (
    serverName: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<any> => {
    if (!clientRef.current) {
      throw new Error('MCP client not initialized');
    }

    try {
      return await clientRef.current.callTool(serverName, toolName, args);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, []);

  // Read a resource
  const readResource = useCallback(async (
    serverName: string,
    uri: string
  ): Promise<any> => {
    if (!clientRef.current) {
      throw new Error('MCP client not initialized');
    }

    try {
      return await clientRef.current.readResource(serverName, uri);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, []);

  return {
    isConnected,
    connectedServers,
    isConnecting,
    error,
    tools,
    resources,
    connect,
    disconnect,
    disconnectAll,
    addServer,
    callTool,
    readResource,
    client: clientRef.current!,
  };
}

/**
 * Helper hook for calling a specific MCP tool
 */
export function useMCPTool(serverName: string, toolName: string) {
  const { callTool, isConnected, error } = useMCP();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [toolError, setToolError] = useState<Error | null>(null);

  const execute = useCallback(async (args: Record<string, any>) => {
    setIsLoading(true);
    setToolError(null);

    try {
      const response = await callTool(serverName, toolName, args);
      setResult(response);
      return response;
    } catch (err) {
      setToolError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [callTool, serverName, toolName]);

  return {
    execute,
    isLoading,
    result,
    error: toolError || error,
    isConnected,
  };
}

/**
 * Helper hook for reading an MCP resource
 */
export function useMCPResource(serverName: string, uri: string) {
  const { readResource, isConnected, error } = useMCP();
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [resourceError, setResourceError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setResourceError(null);

    try {
      const response = await readResource(serverName, uri);
      setData(response);
      return response;
    } catch (err) {
      setResourceError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [readResource, serverName, uri]);

  // Auto-fetch on mount if connected
  useEffect(() => {
    if (isConnected) {
      fetch().catch(console.error);
    }
  }, [isConnected, fetch]);

  return {
    fetch,
    isLoading,
    data,
    error: resourceError || error,
    isConnected,
  };
}

export default useMCP;
