#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; // For type annotation
import { ServerTransport } from "@modelcontextprotocol/sdk/server/transport.js"; // For type annotation
import { createServer } from "./createServer.js";
import { logger } from "./utils/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DatabaseManager } from "./db/DatabaseManager.js";
// import { WebSocketServerTransport } from "@modelcontextprotocol/sdk/server/ws.js"; // Example for WebSocket

const main = async () => {
    let server: McpServer | undefined;
    let transport: ServerTransport | undefined;

    const shutdown = async (signal?: string) => {
        logger.info(`Received ${signal || 'signal'}. Shutting down gracefully...`);
        try {
            // TODO: Verify actual methods from @modelcontextprotocol/sdk documentation
            // if (transport && typeof (transport as any).close === 'function') {
            //     logger.info("Closing transport...");
            //     await (transport as any).close();
            // }
            // if (server && typeof (server as any).disconnect === 'function') {
            //    logger.info("Disconnecting server...");
            //    await (server as any).disconnect();
            // }

            // Close the database connection
            const dbManager = DatabaseManager.getInstance(); // Ensure instance is fetched before closing
            if (dbManager) {
                dbManager.closeDb(); // This method already logs
            } else {
                logger.warn("DatabaseManager instance not found, cannot close DB.");
            }

            logger.info("MCP Server shut down successfully.");
            process.exit(0);
        } catch (error) {
            logger.error("Error during graceful shutdown:", error);
            process.exit(1);
        }
    };

    try {
        server = createServer();
        logger.info("Starting MCP server");

        transport = new StdioServerTransport();
        // transport = new WebSocketServerTransport({ port: 8080 });

        logger.info("Connecting transport", { transport: transport.constructor.name });
        await server.connect(transport);

        logger.info("MCP Server connected and listening");

        // Register signal handlers after successful startup
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

    } catch (error) {
        logger.error("Failed to start server", error);
        // Attempt to close DB even on startup error, if DatabaseManager might have been initialized
        try {
            const dbManager = DatabaseManager.getInstance();
            if (dbManager) {
                dbManager.closeDb();
            }
        } catch (dbError) {
            logger.error("Error closing database during startup failure:", dbError);
        }
        process.exit(1);
    }
};

main();
