export const SKILLS: string[];
export function extractSkills(text: string): string[];
export function matchesJobQuery(job: { title: string; company: string; skills: string[]; description?: string; softwareRole?: boolean }, query: string): boolean;
