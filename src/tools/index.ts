import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigurationManager } from "../config/ConfigurationManager.js";
import { logger } from "../utils/index.js"; // Now using barrel file
import { DatabaseManager } from "../db/DatabaseManager.js";
import { ProjectRepository } from "../repositories/ProjectRepository.js";
import { TaskRepository } from "../repositories/TaskRepository.js"; // Added TaskRepository import
import { ProjectService, TaskService } from "../services/index.js"; // Using barrel file, added TaskService

// Import tool registration functions
// Projects tools
import { createProjectTool } from "./projects/create/createProjectTool.js";
import { updateProjectTool } from "./projects/update/updateProjectTool.js";
import { deleteProjectTool } from "./projects/delete/deleteProjectTool.js";
import { exportProjectTool } from "./projects/export/exportProjectTool.js";
import { importProjectTool } from "./projects/import/importProjectTool.js";

// Tasks tools
import { addTaskTool } from "./tasks/create/addTaskTool.js";
import { updateTaskTool } from "./tasks/update/updateTaskTool.js";
import { deleteTaskTool } from "./tasks/delete/deleteTaskTool.js";
import { setTaskStatusTool } from "./tasks/status/setTaskStatusTool.js";
import { expandTaskTool } from "./tasks/expand/expandTaskTool.js";
import { listTasksTool } from "./tasks/query/listTasksTool.js";
import { showTaskTool } from "./tasks/query/showTaskTool.js";
import { getNextTaskTool } from "./tasks/query/getNextTaskTool.js";

/**
 * Register all defined tools with the MCP server instance.
 * This function centralizes tool registration logic.
 * It also instantiates necessary services and repositories.
 */
export function registerTools(server: McpServer): void {
  logger.info("Registering tools...");
  const configManager = ConfigurationManager.getInstance();

  // --- Instantiate Dependencies ---
  // Note: Consider dependency injection frameworks for larger applications
  try {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.getDb(); // Get the initialized DB connection

    // Instantiate Repositories
    const projectRepository = new ProjectRepository(db);
    const taskRepository = new TaskRepository(db); // Instantiate TaskRepository

    // Instantiate Services
    const projectService = new ProjectService(
      db,
      projectRepository,
      taskRepository
    ); // Pass db and both repos
    const taskService = new TaskService(db, taskRepository, projectRepository); // Instantiate TaskService, passing db and repos

    // --- Register Tools ---
    // Register each tool, passing necessary services

    // exampleTool(server, configManager.getExampleServiceConfig()); // Example commented out

    createProjectTool(server, projectService);
    addTaskTool(server, taskService);
    listTasksTool(server, taskService);
    showTaskTool(server, taskService);
    setTaskStatusTool(server, taskService);
    expandTaskTool(server, taskService);
    getNextTaskTool(server, taskService);
    exportProjectTool(server, projectService);
    importProjectTool(server, projectService); // Register importProjectTool (uses ProjectService)
    updateTaskTool(server, taskService); // Register the new updateTask tool
    deleteTaskTool(server, taskService);
    deleteProjectTool(server, projectService);
    updateProjectTool(server, projectService); // Register the new updateProjectTool
    // ... etc.

    logger.info("All tools registered successfully.");
  } catch (error) {
    logger.error(
      "Failed to instantiate dependencies or register tools:",
      error
    );
    // Depending on the desired behavior, you might want to exit the process
    // process.exit(1);
    throw new Error(
      "Failed to initialize server components during tool registration."
    );
  }
}
