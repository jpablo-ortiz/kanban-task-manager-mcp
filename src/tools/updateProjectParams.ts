import { z } from 'zod';

export const UpdateProjectParamsSchema = z.object({
    project_id: z.string().uuid({ message: "Invalid project ID format (must be UUID)." }),
    project_name: z.string().min(1, "Project name cannot be empty.").max(255, "Project name cannot exceed 255 characters."),
});

export type UpdateProjectParams = z.infer<typeof UpdateProjectParamsSchema>;
