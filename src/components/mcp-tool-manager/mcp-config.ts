/**
 * MCP Configuration Helper
 *
 * Handles loading and validating MCP server configurations
 */

import { MCPServerConfig } from './types.ts';

export interface MCPConfigFile {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    transport?: 'stdio' | 'http';
    disabled?: boolean;
    timeout?: number;
    maxRetries?: number;
  }>;
}

/**
 * Load MCP server configurations from a JSON file
 */
export async function loadMCPConfig(configPath: string): Promise<MCPServerConfig[]> {
  try {
    const configText = await Deno.readTextFile(configPath);
    const config = JSON.parse(configText) as MCPConfigFile;

    if (!config.mcpServers) {
      return [];
    }

    const servers: MCPServerConfig[] = [];

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      // Skip disabled servers
      if (serverConfig.disabled === true) {
        continue;
      }

      servers.push({
        name,
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: serverConfig.env,
        transport: serverConfig.transport || 'stdio',
        enabled: true,
        timeout: serverConfig.timeout || 30000,
        maxRetries: serverConfig.maxRetries || 3
      });
    }

    return servers;

  } catch (error) {
    console.error(`Failed to load MCP config from ${configPath}:`, error);
    return [];
  }
}

/**
 * Create a default MCP configuration file
 */
export function createDefaultMCPConfig(): MCPConfigFile {
  return {
    mcpServers: {
      "example-server": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-example"],
        transport: "stdio",
        disabled: true
      }
    }
  };
}

/**
 * Validate an MCP server configuration
 */
export function validateMCPServerConfig(config: MCPServerConfig): string[] {
  const errors: string[] = [];

  if (!config.name) {
    errors.push('Server name is required');
  }

  if (!config.command) {
    errors.push('Server command is required');
  }

  if (config.transport !== 'stdio' && config.transport !== 'http') {
    errors.push('Transport must be either "stdio" or "http"');
  }

  if (config.timeout && config.timeout < 1000) {
    errors.push('Timeout must be at least 1000ms');
  }

  return errors;
}