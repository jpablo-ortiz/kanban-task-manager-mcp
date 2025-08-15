import { v4 as uuidv4 } from "uuid";
import { TaskRepository, TaskData } from "../repositories/TaskRepository.js";
import { ProjectRepository } from "../repositories/ProjectRepository.js";
import { logger } from "../utils/logger.js";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  RepositoryNotFoundError,
  RepositoryConflictError,
  RepositoryForeignKeyConstraintError,
} from "../utils/errors.js";

// Define the input structure for adding a task, based on feature spec
export interface AddTaskInput {
  project_id: string;
  description: string;
  dependencies?: string[];
  priority?: "high" | "medium" | "low";
  status?: "todo" | "in-progress" | "review" | "done";
}

// Options for listing tasks
export interface ListTasksOptions {
  project_id: string;
  status?: TaskData["status"];
  include_subtasks?: boolean;
}

// Type for task data potentially including nested subtasks
export interface StructuredTaskData extends TaskData {
  subtasks?: StructuredTaskData[];
}

// Type for full task details including dependencies and subtasks
export interface FullTaskData extends TaskData {
  dependencies: string[];
  subtasks: TaskData[]; // For V1 showTask, just return direct subtasks without their own nesting/deps
}

// Input for expanding a task
export interface ExpandTaskInput {
  project_id: string;
  task_id: string; // Parent task ID
  subtask_descriptions: string[];
  force?: boolean;
}

import { Database as Db } from "better-sqlite3"; // Import Db type
// ConflictError is already imported via the wildcard from ../utils/errors.js

export class TaskService {
  private taskRepository: TaskRepository;
  private projectRepository: ProjectRepository;
  private db: Db; // Add db instance

  constructor(
    db: Db, // Inject Db instance
    taskRepository: TaskRepository,
    projectRepository: ProjectRepository
  ) {
    this.db = db; // Store db instance
    this.taskRepository = taskRepository;
    this.projectRepository = projectRepository;
  }

  /**
   * Adds a new task to a specified project.
   */
  public async addTask(input: AddTaskInput): Promise<TaskData> {
    logger.info(
      `[TaskService] Attempting to add task to project: ${input.project_id}`
    );
    const projectExists = this.projectRepository.findById(input.project_id);
    if (!projectExists) {
      logger.warn(`[TaskService] Project not found: ${input.project_id}`);
      throw new NotFoundError(`Project with ID ${input.project_id} not found.`);
    }

    const taskId = uuidv4();
    const now = new Date().toISOString();

    // Validate dependencies before creating the task data object
    if (input.dependencies && input.dependencies.length > 0) {
      // Check for self-dependency
      if (input.dependencies.includes(taskId)) {
        logger.warn(
          `[TaskService] Attempt to create task ${taskId} with self-dependency.`
        );
        throw new ValidationError("Task cannot depend on itself.");
      }

      // Validate existence of dependency tasks
      const depCheck = this.taskRepository.checkTasksExist(
        input.project_id,
        input.dependencies
      );
      if (!depCheck.allExist) {
        logger.warn(
          `[TaskService] Invalid dependencies provided for new task:`,
          depCheck.missingIds
        );
        throw new ValidationError(
          `Invalid dependencies: The following task IDs do not exist or do not belong to the project: ${depCheck.missingIds?.join(", ")}`
        );
      }
      logger.info(
        `[TaskService] Dependency validation passed for new task in project ${input.project_id}.`
      );
    }

    const newTaskData: TaskData = {
      task_id: taskId,
      project_id: input.project_id,
      parent_task_id: null,
      description: input.description,
      status: input.status ?? "todo",
      priority: input.priority ?? "medium",
      created_at: now,
      updated_at: now,
    };

    // Dependency validation has been performed above.
    // The TODO comment below can be removed or updated.
    // TODO: Validate that dependency tasks exist and belong to the same project. (This is now handled above)

    try {
      this.taskRepository.create(newTaskData, input.dependencies);
      logger.info(
        `[TaskService] Successfully added task ${taskId} to project ${input.project_id}`
      );
      return newTaskData;
    } catch (error) {
      logger.error(
        `[TaskService] Error adding task to project ${input.project_id}:`,
        error
      );
      if (error instanceof RepositoryConflictError) {
        throw new ConflictError(error.message);
      } else if (error instanceof RepositoryForeignKeyConstraintError) {
        // This could happen if project_id became invalid between check and creation, though unlikely here.
        // Or if parent_task_id was ever set directly by addTask with an invalid one.
        throw new ValidationError(`Invalid reference: ${error.message}`);
      } else if (
        error instanceof ValidationError ||
        error instanceof NotFoundError
      ) {
        // Re-throw service-level validation/notfound errors directly
        throw error;
      }
      // For other generic errors
      throw new Error(
        `Failed to add task: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Lists tasks for a project.
   */
  public async listTasks(
    options: ListTasksOptions
  ): Promise<TaskData[] | StructuredTaskData[]> {
    logger.info(
      `[TaskService] Attempting to list tasks for project: ${options.project_id}`,
      options
    );
    const projectExists = this.projectRepository.findById(options.project_id);
    if (!projectExists) {
      logger.warn(`[TaskService] Project not found: ${options.project_id}`);
      throw new NotFoundError(
        `Project with ID ${options.project_id} not found.`
      );
    }

    try {
      const allTasks = this.taskRepository.findByProjectId(
        options.project_id,
        options.status
      );

      if (!options.include_subtasks) {
        const topLevelTasks = allTasks.filter((task) => !task.parent_task_id);
        logger.info(
          `[TaskService] Found ${topLevelTasks.length} top-level tasks for project ${options.project_id}`
        );
        return topLevelTasks;
      } else {
        const taskMap: Map<string, StructuredTaskData> = new Map();
        const rootTasks: StructuredTaskData[] = [];
        for (const task of allTasks) {
          taskMap.set(task.task_id, { ...task, subtasks: [] });
        }
        for (const task of allTasks) {
          if (task.parent_task_id && taskMap.has(task.parent_task_id)) {
            const parent = taskMap.get(task.parent_task_id)!;
            parent.subtasks!.push(taskMap.get(task.task_id)!);
          } else if (!task.parent_task_id) {
            rootTasks.push(taskMap.get(task.task_id)!);
          }
        }
        logger.info(
          `[TaskService] Found ${rootTasks.length} structured root tasks for project ${options.project_id}`
        );
        return rootTasks;
      }
    } catch (error) {
      logger.error(
        `[TaskService] Error listing tasks for project ${options.project_id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Retrieves the full details of a single task.
   */
  public async getTaskById(
    projectId: string,
    taskId: string
  ): Promise<FullTaskData> {
    logger.info(
      `[TaskService] Attempting to get task ${taskId} for project ${projectId}`
    );
    try {
      // Repository findById now throws RepositoryNotFoundError if not found.
      const task = this.taskRepository.findById(projectId, taskId);

      const dependencies = this.taskRepository.findDependencies(taskId);
      const subtasks = this.taskRepository.findSubtasks(taskId); // Assuming this also handles errors or returns empty []
      const fullTaskData: FullTaskData = {
        ...task, // task is guaranteed to be defined here due to repo throwing on not found
        dependencies: dependencies,
        subtasks: subtasks,
      };
      logger.info(`[TaskService] Successfully retrieved task ${taskId}`);
      return fullTaskData;
    } catch (error) {
      logger.error(
        `[TaskService] Error retrieving details for task ${taskId}:`,
        error
      );
      if (error instanceof RepositoryNotFoundError) {
        throw new NotFoundError(error.message);
      }
      // For other generic errors
      throw new Error(
        `Failed to retrieve task details: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Sets the status for one or more tasks within a project.
   */
  public async setTaskStatus(
    projectId: string,
    taskIds: string[],
    status: TaskData["status"]
  ): Promise<number> {
    logger.info(
      `[TaskService] Attempting to set status to '${status}' for ${taskIds.length} tasks in project ${projectId}`
    );
    const projectExists = this.projectRepository.findById(projectId);
    if (!projectExists) {
      logger.warn(`[TaskService] Project not found: ${projectId}`);
      throw new NotFoundError(`Project with ID ${projectId} not found.`);
    }

    const existenceCheck = this.taskRepository.checkTasksExist(
      projectId,
      taskIds
    );
    if (!existenceCheck.allExist) {
      logger.warn(
        `[TaskService] One or more tasks not found in project ${projectId}:`,
        existenceCheck.missingIds
      );
      throw new NotFoundError(
        `One or more tasks not found in project ${projectId}: ${existenceCheck.missingIds.join(", ")}`
      );
    }

    try {
      const now = new Date().toISOString();
      // Assuming taskRepository.updateStatus doesn't throw RepositoryNotFoundError for individual tasks
      // as checkTasksExist is called before. If it could, it should be caught.
      const updatedCount = this.taskRepository.updateStatus(
        projectId,
        taskIds,
        status,
        now
      );

      if (updatedCount !== taskIds.length) {
        // This implies some tasks were not updated, which is unexpected if checkTasksExist passed.
        // Could be a race condition or an issue in updateStatus logic if it filters further.
        logger.warn(
          `[TaskService] Expected to update ${taskIds.length} tasks, but only ${updatedCount} were affected.`
        );
        // Potentially throw a specific error here if this is considered critical.
      }
      logger.info(
        `[TaskService] Successfully updated status for ${updatedCount} tasks in project ${projectId}`
      );
      return updatedCount;
    } catch (error) {
      logger.error(
        `[TaskService] Error setting status for tasks in project ${projectId}:`,
        error
      );
      // Map potential repository errors if any are defined for updateStatus
      throw new Error(
        `Failed to set task status: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Expands a parent task by adding new subtasks.
   * Optionally deletes existing subtasks first if 'force' is true.
   * Uses a transaction to ensure atomicity.
   * @param input - Details including parent task ID, project ID, subtask descriptions, and force flag.
   * @returns The updated parent task details (including new subtasks).
   * @throws {NotFoundError} If the project or parent task is not found.
   * @throws {ConflictError} If subtasks exist and force is false.
   * @throws {Error} If the database operation fails.
   */
  public async expandTask(input: ExpandTaskInput): Promise<FullTaskData> {
    const {
      project_id,
      task_id: parentTaskId,
      subtask_descriptions,
      force = false,
    } = input;
    logger.info(
      `[TaskService] Attempting to expand task ${parentTaskId} in project ${project_id} with ${subtask_descriptions.length} subtasks (force=${force})`
    );

    // Use a transaction for the entire operation
    const expandTransaction = this.db.transaction(() => {
      // 1. Validate Parent Task Existence (within the transaction)
      // Repository findById now throws RepositoryNotFoundError
      const parentTask = this.taskRepository.findById(project_id, parentTaskId);

      // 2. Check for existing subtasks
      const existingSubtasks = this.taskRepository.findSubtasks(parentTaskId);

      // 3. Handle existing subtasks based on 'force' flag
      if (existingSubtasks.length > 0) {
        if (!force) {
          logger.warn(
            `[TaskService] Conflict: Task ${parentTaskId} already has subtasks and force=false.`
          );
          throw new ConflictError(
            `Task ${parentTaskId} already has subtasks. Use force=true to replace them.`
          );
        } else {
          logger.info(
            `[TaskService] Force=true: Deleting ${existingSubtasks.length} existing subtasks for parent ${parentTaskId}.`
          );
          this.taskRepository.deleteSubtasks(parentTaskId);
          // Note: Dependencies of deleted subtasks are implicitly handled by ON DELETE CASCADE in schema
        }
      }

      // 4. Create new subtasks
      const now = new Date().toISOString();
      const createdSubtasks: TaskData[] = [];
      for (const description of subtask_descriptions) {
        const subtaskId = uuidv4();
        const newSubtaskData: TaskData = {
          task_id: subtaskId,
          project_id: project_id,
          parent_task_id: parentTaskId,
          description: description, // Assuming length validation done by Zod
          status: "todo", // Default status
          priority: "medium", // Default priority
          created_at: now,
          updated_at: now,
        };
        // Use the repository's create method (which handles its own transaction part for task+deps, but is fine here)
        // We pass an empty array for dependencies as expandTask doesn't set them for new subtasks
        this.taskRepository.create(newSubtaskData, []);
        createdSubtasks.push(newSubtaskData);
      }

      // 5. Fetch updated parent task details (including new subtasks and existing dependencies)
      // We re-fetch to get the consistent state after the transaction commits.
      // Note: This requires the transaction function to return the necessary data.
      // Alternatively, construct the FullTaskData manually here. Let's construct manually.
      const dependencies = this.taskRepository.findDependencies(parentTaskId); // Fetch parent's dependencies
      const finalParentData: FullTaskData = {
        ...parentTask, // Use data fetched at the start of transaction
        updated_at: now, // Update timestamp conceptually (though not saved unless status changes)
        dependencies: dependencies,
        subtasks: createdSubtasks, // Return the newly created subtasks
      };
      return finalParentData;
    });

    try {
      // Execute the transaction
      const result = expandTransaction();
      logger.info(
        `[TaskService] Successfully expanded task ${parentTaskId} with ${subtask_descriptions.length} new subtasks.`
      );
      return result;
    } catch (error) {
      logger.error(
        `[TaskService] Error expanding task ${parentTaskId}:`,
        error
      );
      if (error instanceof RepositoryNotFoundError) {
        // From parentTask lookup or sub-operations
        throw new NotFoundError(error.message);
      } else if (error instanceof RepositoryConflictError) {
        // From sub-task creation
        throw new ConflictError(error.message);
      } else if (error instanceof RepositoryForeignKeyConstraintError) {
        // From sub-task creation
        throw new ValidationError(
          `Invalid reference during sub-task creation: ${error.message}`
        );
      } else if (
        error instanceof NotFoundError ||
        error instanceof ConflictError ||
        error instanceof ValidationError
      ) {
        // Re-throw service-level errors
        throw error;
      }
      throw new Error(
        `Failed to expand task: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Finds the next available task based on readiness (status 'todo', dependencies 'done')
   * and prioritization (priority, creation date).
   * @param projectId - The project ID.
   * @returns The full details of the next task, or null if no task is ready.
   * @throws {NotFoundError} If the project is not found.
   * @throws {Error} If the database operation fails.
   */
  public async getNextTask(projectId: string): Promise<FullTaskData | null> {
    logger.info(
      `[TaskService] Attempting to get next task for project ${projectId}`
    );

    // 1. Validate Project Existence
    const projectExists = this.projectRepository.findById(projectId);
    if (!projectExists) {
      logger.warn(`[TaskService] Project not found: ${projectId}`);
      throw new NotFoundError(`Project with ID ${projectId} not found.`);
    }

    // 2. Find ready tasks using the repository method
    try {
      const readyTasks = this.taskRepository.findReadyTasks(projectId);

      if (readyTasks.length === 0) {
        logger.info(
          `[TaskService] No ready tasks found for project ${projectId}`
        );
        return null;
      }

      const nextTaskData = readyTasks[0];
      logger.info(
        `[TaskService] Next task candidate identified: ${nextTaskData.task_id}`
      );

      // Fetch full details, which will also confirm its existence via getTaskById's internal checks
      return await this.getTaskById(projectId, nextTaskData.task_id);
    } catch (error) {
      logger.error(
        `[TaskService] Error getting next task for project ${projectId}:`,
        error
      );
      // getTaskById already maps RepositoryNotFoundError to NotFoundError
      if (error instanceof NotFoundError) {
        throw error; // If getTaskById threw NotFoundError (e.g. task disappeared)
      }
      // For other generic errors
      throw new Error(
        `Failed to get next task: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Updates specific fields of an existing task.
   * @param input - Contains project ID, task ID, and optional fields to update.
   * @returns The full details of the updated task.
   * @throws {ValidationError} If no update fields are provided or if dependencies are invalid.
   * @throws {NotFoundError} If the project, task, or any specified dependency task is not found.
   * @throws {Error} If the database operation fails.
   */
  public async updateTask(input: {
    project_id: string;
    task_id: string;
    description?: string;
    priority?: TaskData["priority"];
    dependencies?: string[];
  }): Promise<FullTaskData> {
    const { project_id, task_id } = input;
    logger.info(
      `[TaskService] Attempting to update task ${task_id} in project ${project_id}`
    );

    // 1. Validate that at least one field is being updated
    if (
      input.description === undefined &&
      input.priority === undefined &&
      input.dependencies === undefined
    ) {
      throw new ValidationError(
        "At least one field (description, priority, or dependencies) must be provided for update."
      );
    }

    // 2. Validate Project Existence (using repo method)
    const projectExists = this.projectRepository.findById(project_id);
    if (!projectExists) {
      logger.warn(`[TaskService] Project not found: ${project_id}`);
      throw new NotFoundError(`Project with ID ${project_id} not found.`);
    }

    // 3. Validate Task Existence. Repo findById now throws RepositoryNotFoundError.
    // This call will throw if task not found, which will be caught and re-thrown as NotFoundError.
    const existingTask = this.taskRepository.findById(project_id, task_id);

    // 4. Validate Dependency Existence if provided
    if (input.dependencies !== undefined) {
      if (input.dependencies.length > 0) {
        const depCheck = this.taskRepository.checkTasksExist(
          project_id,
          input.dependencies
        );
        if (!depCheck.allExist) {
          logger.warn(
            `[TaskService] Invalid dependencies provided for task ${task_id}:`,
            depCheck.missingIds
          );
          throw new ValidationError(
            `One or more dependency tasks not found in project ${project_id}: ${depCheck.missingIds.join(", ")}`
          );
        }
        // Also check for self-dependency
        if (input.dependencies.includes(task_id)) {
          throw new ValidationError(`Task ${task_id} cannot depend on itself.`);
        }
      }
      // If input.dependencies is an empty array, it means "remove all dependencies"
    }

    // 5. Prepare payload for repository
    const updatePayload: {
      description?: string;
      priority?: TaskData["priority"];
      dependencies?: string[];
    } = {};
    if (input.description !== undefined)
      updatePayload.description = input.description;
    if (input.priority !== undefined) updatePayload.priority = input.priority;
    if (input.dependencies !== undefined)
      updatePayload.dependencies = input.dependencies;

    // 6. Call Repository update method
    try {
      const now = new Date().toISOString();
      // The repo method handles the transaction for task update + dependency replacement
      const updatedTaskData = this.taskRepository.updateTask(
        project_id,
        task_id,
        updatePayload,
        now
      );

      // 7. Fetch full details (including potentially updated dependencies and existing subtasks)
      // Re-use logic similar to getTaskById
      const finalDependencies = this.taskRepository.findDependencies(task_id);
      const finalSubtasks = this.taskRepository.findSubtasks(task_id);

      const fullUpdatedTask: FullTaskData = {
        ...updatedTaskData, // Use the data returned by the update method
        dependencies: finalDependencies,
        subtasks: finalSubtasks,
      };

      logger.info(
        `[TaskService] Successfully updated task ${task_id} in project ${project_id}`
      );
      return fullUpdatedTask;
    } catch (error) {
      logger.error(
        `[TaskService] Error updating task ${task_id} in project ${project_id}:`,
        error
      );
      // Re-throw specific errors if needed
      if (error instanceof RepositoryNotFoundError) {
        throw new NotFoundError(error.message); // From updateTask's internal findById if task vanished
      } else if (error instanceof RepositoryForeignKeyConstraintError) {
        // This could happen if a dependency ID is invalid during the update of dependencies
        throw new ValidationError(
          `Invalid dependency reference during update: ${error.message}`
        );
      } else if (
        error instanceof ValidationError ||
        error instanceof NotFoundError ||
        error instanceof ConflictError
      ) {
        throw error; // Re-throw service-level errors
      }
      // For other generic errors
      throw new Error(
        `Failed to update task: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Deletes one or more tasks within a project.
   * @param projectId - The project ID.
   * @param taskIds - An array of task IDs to delete.
   * @returns The number of tasks successfully deleted.
   * @throws {NotFoundError} If the project or any of the specified tasks are not found.
   * @throws {Error} If the database operation fails.
   */
  public async deleteTasks(
    projectId: string,
    taskIds: string[]
  ): Promise<number> {
    logger.info(
      `[TaskService] Attempting to delete ${taskIds.length} tasks from project ${projectId}`
    );

    // 1. Validate Project Existence
    const projectExists = this.projectRepository.findById(projectId);
    if (!projectExists) {
      logger.warn(`[TaskService] Project not found: ${projectId}`);
      throw new NotFoundError(`Project with ID ${projectId} not found.`);
    }

    // 2. Validate Task Existence *before* attempting delete
    // This ensures we report an accurate count and catch non-existent IDs early.
    const existenceCheck = this.taskRepository.checkTasksExist(
      projectId,
      taskIds
    );
    if (!existenceCheck.allExist) {
      logger.warn(
        `[TaskService] Cannot delete: One or more tasks not found in project ${projectId}:`,
        existenceCheck.missingIds
      );
      // Throw NotFoundError here, as InvalidParams might be confusing if some IDs were valid
      throw new NotFoundError(
        `One or more tasks to delete not found in project ${projectId}: ${existenceCheck.missingIds.join(", ")}`
      );
    }

    // 3. Call Repository delete method
    try {
      // Repository deleteTasks might throw RepositoryNotFoundError if no tasks were found.
      // However, we've already validated existence with checkTasksExist.
      // If it still returns 0, it's an anomaly or they disappeared.
      const deletedCount = this.taskRepository.deleteTasks(projectId, taskIds);

      if (deletedCount !== taskIds.length) {
        // This is a stronger indication of an issue now, as existence was pre-checked.
        logger.error(
          `[TaskService] Discrepancy in delete count. Expected ${taskIds.length}, got ${deletedCount}. Tasks might have been deleted concurrently.`
        );
        // Consider throwing an error if strict atomicity is paramount and this indicates a problem.
        // For now, log and return the actual count.
      }

      logger.info(
        `[TaskService] Successfully deleted ${deletedCount} tasks from project ${projectId}`
      );
      return deletedCount;
    } catch (error) {
      logger.error(
        `[TaskService] Error deleting tasks from project ${projectId}:`,
        error
      );
      // Map specific repository errors if defined for deleteTasks
      // For now, assume it throws generic errors for DB issues.
      throw new Error(
        `Failed to delete tasks: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  // --- Add other task service methods later ---
}
