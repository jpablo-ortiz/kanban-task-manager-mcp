import { v4 as uuidv4 } from 'uuid';
import { Database as Db } from 'better-sqlite3'; // Import Db type
import { ProjectRepository, ProjectData } from '../repositories/ProjectRepository.js';
import { TaskRepository, TaskData } from '../repositories/TaskRepository.js';
import { logger } from '../utils/logger.js';
import {
    NotFoundError,
    ValidationError,
    ConflictError,
    RepositoryNotFoundError,
    RepositoryConflictError,
    RepositoryForeignKeyConstraintError
} from '../utils/errors.js';
import { projectImportSchema, ValidatedProjectImportData } from '../types/projectImportSchema.js';

// Interfaces for exportProject - these were locally defined before, ensuring they exist
// These might be slightly different from ValidatedProjectImportData as they reflect DB state.
interface ExportTask extends TaskData {
    dependencies: string[];
    subtasks: ExportTask[];
}

interface ExportData {
    project_metadata: ProjectData;
    tasks: ExportTask[];
}


export class ProjectService {
    private projectRepository: ProjectRepository;
    private taskRepository: TaskRepository;
    private db: Db; // Add db instance

    constructor(
        db: Db, // Inject Db instance
        projectRepository: ProjectRepository,
        taskRepository: TaskRepository
    ) {
        this.db = db; // Store db instance
        this.projectRepository = projectRepository;
        this.taskRepository = taskRepository;
    }

    /**
     * Creates a new project.
     */
    public async createProject(projectName?: string): Promise<ProjectData> {
        const projectId = uuidv4();
        const now = new Date().toISOString();
        const finalProjectName = projectName?.trim() || `New Project ${now}`;
        const newProject: ProjectData = {
            project_id: projectId,
            name: finalProjectName,
            created_at: now,
        };
        logger.info(`[ProjectService] Attempting to create project: ${projectId} with name "${finalProjectName}"`);
        try {
            this.projectRepository.create(newProject);
            logger.info(`[ProjectService] Successfully created project: ${projectId}`);
            return newProject;
        } catch (error) {
            logger.error(`[ProjectService] Error creating project ${projectId}:`, error);
            if (error instanceof RepositoryConflictError) {
                throw new ConflictError(error.message);
            }
            // For other specific repository errors, map them if necessary
            throw error; // Re-throw other errors
        }
    }

    /**
     * Retrieves a project by its ID.
     */
    public async getProjectById(projectId: string): Promise<ProjectData> {
        logger.info(`[ProjectService] Attempting to find project: ${projectId}`);
        try {
            const project = this.projectRepository.findById(projectId);
            // findById in repo now throws RepositoryNotFoundError if not found.
            logger.info(`[ProjectService] Found project: ${projectId}`);
            return project;
        } catch (error) {
            logger.error(`[ProjectService] Error finding project ${projectId}:`, error);
            if (error instanceof RepositoryNotFoundError) {
                throw new NotFoundError(error.message);
            }
            throw error; // Re-throw other errors
        }
    }

    /**
     * Exports all data for a given project as a JSON string.
     */
    public async exportProject(projectId: string): Promise<string> {
        logger.info(`[ProjectService] Attempting to export project: ${projectId}`);
        // getProjectById will throw NotFoundError if project doesn't exist
        const projectMetadata = await this.getProjectById(projectId);

        try {
            const allTasks = this.taskRepository.findAllTasksForProject(projectId);
            const allDependencies = this.taskRepository.findAllDependenciesForProject(projectId);

            const taskMap: Map<string, ExportTask> = new Map();
            const rootTasks: ExportTask[] = [];
            const dependencyMap: Map<string, string[]> = new Map();

            for (const dep of allDependencies) {
                if (!dependencyMap.has(dep.task_id)) {
                    dependencyMap.set(dep.task_id, []);
                }
                dependencyMap.get(dep.task_id)!.push(dep.depends_on_task_id);
            }

            for (const task of allTasks) {
                taskMap.set(task.task_id, {
                    ...task,
                    dependencies: dependencyMap.get(task.task_id) || [],
                    subtasks: [],
                });
            }

            for (const task of allTasks) {
                const exportTask = taskMap.get(task.task_id)!;
                if (task.parent_task_id && taskMap.has(task.parent_task_id)) {
                    const parent = taskMap.get(task.parent_task_id)!;
                    if (!parent.subtasks) parent.subtasks = [];
                    parent.subtasks.push(exportTask);
                } else if (!task.parent_task_id) {
                    rootTasks.push(exportTask);
                }
            }

            const exportData: ExportData = {
                project_metadata: projectMetadata,
                tasks: rootTasks,
            };

            const jsonString = JSON.stringify(exportData, null, 2);
            logger.info(`[ProjectService] Successfully prepared export data for project ${projectId}`);
            return jsonString;

        } catch (error) {
            logger.error(`[ProjectService] Error exporting project ${projectId}:`, error);
            throw error;
        }
    }

    /**
     * Imports project data from a JSON string, creating a new project.
     */
    public async importProject(projectDataString: string, newProjectName?: string): Promise<{ project_id: string }> {
        logger.info(`[ProjectService] Attempting to import project...`);

        if (projectDataString.length > 10 * 1024 * 1024) { // Example 10MB limit
            logger.warn('[ProjectService] Import data exceeds size limit.');
            throw new ValidationError('Input data exceeds size limit (e.g., 10MB).');
        }

        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(projectDataString);
        } catch (error) {
            logger.error('[ProjectService] Failed to parse import JSON:', error);
            throw new ValidationError(`Invalid JSON format: ${error instanceof Error ? error.message : 'Unknown parsing error'}`);
        }

        const validationResult = projectImportSchema.safeParse(parsedJson);

        if (!validationResult.success) {
            const errorMessages = validationResult.error.errors.map(err => {
                return `${err.path.join('.')} - ${err.message}`;
            });
            logger.warn('[ProjectService] Import data validation failed:', errorMessages);
            throw new ValidationError(`Invalid project data format: ${errorMessages.join('; ')}`);
        }

        const importData: ValidatedProjectImportData = validationResult.data;
        logger.debug(`[ProjectService] Successfully parsed and validated import data.`);

        // The TODO for schema validation is now addressed.
        // TODO: Implement rigorous schema validation (Zod?) - This is now handled above.

        const importTransaction = this.db.transaction(() => {
            const newProjectId = uuidv4();
            const now = new Date().toISOString();
            // Use validated name from importData
            const finalProjectName = newProjectName?.trim() || `${importData.project_metadata.name} (Imported ${now})`; // Name from validated data
            const newProjectData: ProjectData = { // Renamed to avoid conflict with 'newProject' outer scope var
                project_id: newProjectId,
                name: finalProjectName.substring(0, 255),
                created_at: now,
            };
            this.projectRepository.create(newProjectData); // Use renamed variable
            logger.info(`[ProjectService] Created new project ${newProjectId} for import.`);

            const idMap = new Map<string, string>();

            // Recursive function to process tasks and their subtasks
            const processTask = (taskFromFile: ValidatedProjectImportData['tasks'][number], parentDbId: string | null) => {
                const newTaskId = uuidv4();
                idMap.set(taskFromFile.task_id, newTaskId); // Map old ID to new ID

                const newTaskData: TaskData = {
                    task_id: newTaskId,
                    project_id: newProjectId,
                    parent_task_id: parentDbId,
                    description: taskFromFile.description,
                    status: taskFromFile.status,
                    priority: taskFromFile.priority,
                    created_at: taskFromFile.created_at, // Preserve original task timestamps
                    updated_at: taskFromFile.updated_at,
                };
                // Create task without dependencies first, as they will be based on new IDs
                this.taskRepository.create(newTaskData, []);

                if (taskFromFile.subtasks && taskFromFile.subtasks.length > 0) {
                    taskFromFile.subtasks.forEach(subtask => processTask(subtask, newTaskId));
                }
            };

            importData.tasks.forEach(rootTask => processTask(rootTask, null));
            logger.info(`[ProjectService] Processed ${idMap.size} tasks for import (creation phase).`);

            // After all tasks are created and their new IDs are mapped, process dependencies
            const insertDependencyStmt = this.db.prepare(`
                INSERT INTO task_dependencies (task_id, depends_on_task_id)
                VALUES (?, ?) ON CONFLICT DO NOTHING
            `);
            let depCount = 0;

            const processDepsRecursively = (taskFromFile: ValidatedProjectImportData['tasks'][number]) => {
                const newCurrentTaskId = idMap.get(taskFromFile.task_id); // Get the new ID for the current task
                if (newCurrentTaskId && taskFromFile.dependencies && taskFromFile.dependencies.length > 0) {
                    for (const oldDependencyId of taskFromFile.dependencies) {
                        const newDependencyId = idMap.get(oldDependencyId); // Get the new ID for the dependency task
                        if (newDependencyId) {
                            if (newCurrentTaskId === newDependencyId) { // Check for self-dependency with new IDs
                                logger.warn(`[ProjectService] Skipping self-dependency for task ${taskFromFile.description} (Old ID: ${taskFromFile.task_id})`);
                                continue;
                            }
                            insertDependencyStmt.run(newCurrentTaskId, newDependencyId);
                            depCount++;
                        } else {
                            logger.warn(`[ProjectService] Dependency task with old ID ${oldDependencyId} not found in ID map for task ${taskFromFile.description}. Skipping dependency.`);
                        }
                    }
                }
                if (taskFromFile.subtasks && taskFromFile.subtasks.length > 0) {
                    taskFromFile.subtasks.forEach(processDepsRecursively);
                }
            };

            importData.tasks.forEach(processDepsRecursively);
            logger.info(`[ProjectService] Processed ${depCount} dependencies for import.`);

            return { project_id: newProjectId };
        });

        try {
            const result = importTransaction();
            logger.info(`[ProjectService] Successfully imported project. New project ID: ${result.project_id}`);
            return result;
        } catch (error) {
            logger.error(`[ProjectService] Error during import transaction:`, error);
            if (error instanceof RepositoryNotFoundError) {
                throw new NotFoundError(error.message); // Should ideally not happen if all tasks exist by ID mapping
            } else if (error instanceof RepositoryConflictError) {
                throw new ConflictError(error.message); // e.g. task ID conflict if somehow UUIDs are not unique
            } else if (error instanceof RepositoryForeignKeyConstraintError) {
                // This might happen if a task's project_id or parent_task_id (after remapping) is invalid
                throw new ValidationError(`Data integrity issue during import: ${error.message}`);
            } else if (error instanceof NotFoundError || error instanceof ValidationError || error instanceof ConflictError) {
                throw error; // Re-throw service-level errors
            }
            // For other generic errors from DB or unexpected issues
            throw new Error(`Failed to import project: ${error instanceof Error ? error.message : 'Unknown database error'}`);
        }
    }

    /**
     * Deletes a project and all its associated data (tasks, dependencies).
     * @param projectId - The ID of the project to delete.
     * @returns A boolean indicating success (true if deleted, false if not found initially).
     * @throws {NotFoundError} If the project is not found.
     * @throws {Error} If the database operation fails.
     */
    public async deleteProject(projectId: string): Promise<void> {
        logger.info(`[ProjectService] Attempting to delete project: ${projectId}`);
        try {
            // projectRepository.deleteProject will throw RepositoryNotFoundError if not found.
            // Also, getProjectById call was made before, which would throw service level NotFoundError.
            // So, we can directly call delete.
            this.projectRepository.deleteProject(projectId);
            logger.info(`[ProjectService] Successfully deleted project ${projectId} and associated data.`);
        } catch (error) {
            logger.error(`[ProjectService] Error deleting project ${projectId}:`, error);
            if (error instanceof RepositoryNotFoundError) {
                // This means it was found by getProjectById but then disappeared before delete,
                // or if we removed the initial getProjectById check.
                throw new NotFoundError(error.message);
            }
            throw error; // Re-throw other errors
        }
    }

    public async updateProject(
        projectId: string,
        projectName: string
    ): Promise<ProjectData> { // Corrected: ProjectData does not have updated_at
        logger.info({ projectId, newName: projectName }, "Service attempting to update project name");

        // Validate projectName length (e.g., 1-255 characters)
        if (!projectName || projectName.trim().length === 0 || projectName.length > 255) {
            throw new ValidationError("Project name must be between 1 and 255 characters.");
        }
        const trimmedProjectName = projectName.trim();

        // First, check if the project exists using the existing getProjectById method
        // This also ensures we are catching RepositoryNotFoundError and re-throwing it as NotFoundError.
        // It also gives us the current project data.
        const currentProject = await this.getProjectById(projectId); // Will throw NotFoundError if not found

        // Optional: Check if the name is actually different
        if (currentProject.name === trimmedProjectName) {
            logger.info(`Project name for ${projectId} is already '${trimmedProjectName}'. No update performed.`);
            return currentProject; // Return current project data as no change is needed
        }

        try {
            this.projectRepository.update(projectId, trimmedProjectName);
            // After successful update, fetch the updated project details to return.
            // This will reflect the new name. `created_at` remains the same.
            const updatedProject = await this.getProjectById(projectId);
            logger.info({ project: updatedProject }, "Project updated successfully by service");
            return updatedProject;
        } catch (error) {
            // The initial getProjectById should catch most "not found" cases.
            // This catch block handles errors from the update operation itself or if the project
            // disappeared between the find and update calls (a race condition).
            if (error instanceof RepositoryNotFoundError) {
                // This specific error from projectRepository.update implies the name was the same or project disappeared.
                // If it was because the name was the same, we've already handled it above.
                // So, this primarily means it disappeared post-check or another issue with update.
                logger.warn({ error, projectId }, "Update failed: Project not found or name unchanged at repository level.");
                // Re-fetch to confirm current state, which might throw NotFoundError if truly gone.
                // This ensures consistency if the "no change" was the reason for RepositoryNotFoundError.
                return this.getProjectById(projectId);
            }
            logger.error({ error, projectId, newName: trimmedProjectName }, "Error updating project in service");
            // For other unexpected errors from the repository or elsewhere.
            throw new Error(`Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
