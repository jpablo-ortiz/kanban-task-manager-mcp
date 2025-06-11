import { z } from 'zod';

// Allowed enum values for status and priority, aligning with TaskData
const taskStatusEnum = z.enum(['todo', 'in-progress', 'review', 'done']);
const taskPriorityEnum = z.enum(['high', 'medium', 'low']);

// Base schema for a task, allowing for recursive definition of subtasks
// We use z.lazy to handle the recursive type for subtasks
const baseTaskSchema = z.object({
    task_id: z.string().uuid("Invalid Task ID format. Should be UUID.").describe("Original task ID (will be regenerated on import)."),
    project_id: z.string().uuid("Invalid Project ID format on task. Should be UUID.").describe("Original project ID (will be replaced on import)."),
    parent_task_id: z.string().uuid("Invalid Parent Task ID format. Should be UUID.").nullable().optional().describe("Original parent task ID (will be remapped on import)."),
    description: z.string().min(1, "Task description cannot be empty.").max(1024, "Task description cannot exceed 1024 characters."),
    status: taskStatusEnum,
    priority: taskPriorityEnum,
    created_at: z.string().datetime({ message: "Invalid ISO8601 datetime format for created_at." }).describe("Task creation timestamp (ISO8601)."),
    updated_at: z.string().datetime({ message: "Invalid ISO8601 datetime format for updated_at." }).describe("Task last update timestamp (ISO8601)."),
    dependencies: z.array(z.string().uuid("Dependency task ID must be a valid UUID.")).optional().default([]).describe("List of task IDs this task depends on."),
});

// Define the recursive part for subtasks
type TaskWithSubtasks = z.infer<typeof baseTaskSchema> & {
    subtasks?: TaskWithSubtasks[];
};

const subtaskSchema: z.ZodType<TaskWithSubtasks> = baseTaskSchema.extend({
    subtasks: z.lazy(() => subtaskSchema.array().optional().default([])).describe("Nested subtasks."),
});


// Schema for project metadata within the import file
const projectMetadataSchema = z.object({
    project_id: z.string().uuid("Invalid Project ID format. Should be UUID.").describe("Original project ID (will be regenerated on import)."),
    name: z.string().min(1, "Project name cannot be empty.").max(255, "Project name cannot exceed 255 characters."),
    created_at: z.string().datetime({ message: "Invalid ISO8601 datetime format for created_at." }).describe("Project creation timestamp (ISO8601)."),
    // updated_at for project metadata is not explicitly in ProjectData, but could be added if needed.
    // For now, we align with the existing ProjectData structure which only has created_at.
});

// Main schema for the project import file structure
export const projectImportSchema = z.object({
    project_metadata: projectMetadataSchema.describe("Metadata for the project being imported."),
    tasks: z.array(subtaskSchema).describe("Root tasks of the project. Subtasks are nested within parent tasks."),
});

// Type alias for the validated import data
export type ValidatedProjectImportData = z.infer<typeof projectImportSchema>;
