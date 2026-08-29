#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare const createServer: () => McpServer;
export declare const runMcpServer: () => Promise<void>;
