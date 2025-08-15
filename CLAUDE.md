# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) Task Manager Server - a local backend service that provides task and project management tools for MCP clients. It uses SQLite for data persistence and follows a layered architecture pattern.

## Development Commands

### Essential Commands
- **Development**: `npm run dev` - Runs with ts-node and nodemon for auto-reloading
- **Build**: `npm run build` - Compiles TypeScript and copies SQL schema files
- **Production**: `npm start` - Runs the compiled JavaScript build
- **Lint**: `npm run lint` - ESLint with TypeScript support
- **Format**: `npm run format` - Prettier formatting

### Environment Variables
- `DATABASE_PATH`: SQLite database location (default: `./data/taskmanager.db`)
- `LOG_LEVEL`: Logging level (default: `info`)

## Architecture

### Core Components
- **Server Entry**: `src/server.ts` → `src/createServer.ts` - MCP server initialization using stdio transport
- **Database**: `src/db/DatabaseManager.ts` - Singleton SQLite manager with WAL mode and foreign keys enabled
- **Repositories**: Data access layer (`ProjectRepository`, `TaskRepository`)
- **Services**: Business logic layer (`ProjectService`, `TaskService`)
- **Tools**: MCP tool definitions with Zod schemas for validation

### Key Patterns
- **Singleton Pattern**: DatabaseManager and ConfigurationManager
- **Service Layer**: Business logic separated from data access
- **Tool Registration**: Centralized in `src/tools/index.ts` with dependency injection
- **Error Handling**: Custom error types in `src/utils/errors.ts`
- **Logging**: Structured JSON logging with Pino

### Database Schema
- SQLite with foreign key constraints enabled
- Schema defined in `src/db/schema.sql`
- Projects contain tasks with status, priority, and dependency relationships
- Cascade deletes for data integrity

## MCP Tools Available
The server exposes 12 MCP tools for task management:
- Project management: `createProject`, `deleteProject`, `exportProject`, `importProject`
- Task management: `addTask`, `updateTask`, `deleteTask`, `listTasks`, `showTask`
- Task operations: `setTaskStatus`, `expandTask`, `getNextTask`

## Development Notes

### Code Style
- ESLint with TypeScript rules and Prettier integration
- No console restrictions (server application)
- ES2022 modules with NodeNext resolution
- Strict TypeScript configuration

### File Organization
- Each MCP tool has separate param and implementation files
- Barrel exports (`index.ts`) for clean imports
- Configuration centralized in `ConfigurationManager`
- SQL schema separate from TypeScript code

### Testing
No test framework currently configured - tests would need to be added if required.