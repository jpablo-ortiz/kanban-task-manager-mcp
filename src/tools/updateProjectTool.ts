import { McpServer, McpError, ErrorCode } from "@modelcontextprotocol/sdk/server/mcp";
import { ProjectService } from "../services/index.js"; // Assuming ProjectService is exported from services/index.ts
import { logger } from "../utils/index.js"; // Assuming logger is exported from utils/index.ts
import { UpdateProjectParamsSchema, UpdateProjectParams } from "./updateProjectParams.js";
import { NotFoundError, ValidationError, ConflictError } from "../utils/errors.js"; // Import service level errors

export const updateProjectTool = (server: McpServer, projectService: ProjectService) => {
    server.tool( // Changed from server.registerTool to server.tool based on other tool examples
        "updateProject",
        "Updates the name of an existing project. Requires project_id and the new project_name.",
        UpdateProjectParamsSchema.shape, // Pass Zod shape for parameters
        async (params: UpdateProjectParams, context: any) => { // Added context: any as per McpServer.tool signature
            logger.info({ tool: "updateProject", params }, "updateProject tool invoked");
            try {
                // The service method updateProject returns the full updated project object.
                // The MCP response should be the updated project data.
                const updatedProject = await projectService.updateProject(params.project_id, params.project_name);

                // As per other tools like addTaskTool, returning complex objects as stringified JSON in a text content block.
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify(updatedProject)
                    }]
                };
            } catch (error) {
                logger.error({ tool: "updateProject", error }, "Error in updateProject tool");
                if (error instanceof NotFoundError) {
                    throw new McpError(ErrorCode.NotFound, error.message);
                } else if (error instanceof ValidationError) {
                    throw new McpError(ErrorCode.InvalidParams, error.message);
                } else if (error instanceof ConflictError) { // Although updateProject service doesn't throw ConflictError currently
                    throw new McpError(ErrorCode.Conflict, error.message);
                }
                // For other errors, throw a generic server error
                throw new McpError(ErrorCode.InternalError, "An unexpected error occurred while updating the project.");
            }
        }
    );
    logger.info(`[updateProjectTool] Tool "updateProject" registered successfully.`);
};
