import { Database as Db, SqliteError } from 'better-sqlite3';
import { logger } from '../utils/logger.js'; // Assuming logger exists
import { RepositoryNotFoundError, RepositoryConflictError, RepositoryForeignKeyConstraintError } from '../utils/errors.js';

export interface ProjectData {
    project_id: string;
    name: string;
    created_at: string; // ISO8601 format
}

export class ProjectRepository {
    private db: Db;

    // Pass the database connection instance
    constructor(db: Db) {
        this.db = db;
    }

    /**
     * Creates a new project record in the database.
     * @param project - The project data to insert.
     * @throws {Error} If the database operation fails.
     */
    public create(project: ProjectData): void {
        const sql = `
            INSERT INTO projects (project_id, name, created_at)
            VALUES (@project_id, @name, @created_at)
        `;
        try {
            const stmt = this.db.prepare(sql);
            stmt.run(project); // info.changes not strictly needed here unless for conflict
            logger.info(`[ProjectRepository] Created project ${project.project_id}`);
        } catch (error) {
            logger.error(`[ProjectRepository] Failed to create project ${project.project_id}:`, error);
            if (error instanceof SqliteError) {
                // Example: If project_id had a UNIQUE constraint, this would be SQLITE_CONSTRAINT_UNIQUE
                // For now, we don't have unique constraints on name, but if we did:
                // if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                //    throw new RepositoryConflictError(`Project with name '${project.name}' already exists.`);
                // }
                 if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
                    throw new RepositoryConflictError(`Project with ID '${project.project_id}' already exists.`);
                }
            }
            throw error; // Re-throw original or a generic repository error
        }
    }

    /**
     * Finds a project by its ID.
     * @param projectId - The ID of the project to find.
     * @returns The project data if found, otherwise undefined.
     */
    public findById(projectId: string): ProjectData {
        const sql = `SELECT project_id, name, created_at FROM projects WHERE project_id = ?`;
        try {
            const stmt = this.db.prepare(sql);
            const project = stmt.get(projectId) as ProjectData | undefined;
            if (!project) {
                throw new RepositoryNotFoundError(`Project with id ${projectId} not found.`);
            }
            return project;
        } catch (error) {
            logger.error(`[ProjectRepository] Failed to find project ${projectId}:`, error);
            if (error instanceof RepositoryNotFoundError) throw error;
            throw error; // Re-throw other errors
        }
    }

    /**
     * Deletes a project by its ID.
     * Relies on ON DELETE CASCADE in the schema to remove associated tasks/dependencies.
     * @param projectId - The ID of the project to delete.
     * @returns The number of projects deleted (0 or 1).
     * @throws {Error} If the database operation fails.
     */
    public deleteProject(projectId: string): void {
        const sql = `DELETE FROM projects WHERE project_id = ?`;
        try {
            const stmt = this.db.prepare(sql);
            const info = stmt.run(projectId);
            if (info.changes === 0) {
                throw new RepositoryNotFoundError(`Project with id ${projectId} not found, cannot delete.`);
            }
            logger.info(`[ProjectRepository] Deleted project ${projectId}. Rows affected: ${info.changes}`);
            // Cascade delete handles tasks/dependencies in the background via schema definition.
        } catch (error) {
            logger.error(`[ProjectRepository] Failed to delete project ${projectId}:`, error);
            if (error instanceof RepositoryNotFoundError) throw error;
            throw error; // Re-throw other errors
        }
    }

    // Add other methods as needed (e.g., update, list)

    public update(projectId: string, projectName: string): { updated: number } {
        logger.debug({ projectId, projectName }, "Attempting to update project name in DB");
        // Corrected SQL to only update the name, as `updated_at` is not in the current schema.
        const stmt = this.db.prepare(
            "UPDATE projects SET name = ? WHERE project_id = ?"
        );
        const info = stmt.run(projectName, projectId);
        if (info.changes === 0) {
            // This means either the project_id was not found, or the name provided is identical to the existing name.
            // The service layer's initial getProjectById check primarily handles "not found".
            // So, if this is reached after a successful findById, it implies the name is the same.
            // However, to be safe and cover the case where findById might not be called first in all scenarios,
            // we throw an error that covers both possibilities.
            throw new RepositoryNotFoundError(`Project with id ${projectId} not found, or project name is already set to the provided value.`);
        }
        logger.info({ projectId, newName: projectName, changes: info.changes }, "Project name updated successfully in DB");
        return { updated: info.changes };
    }
}
