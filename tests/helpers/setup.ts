import { afterAll } from 'vitest';
import { cleanupProjects } from './project';

// Runs for every test file: throwaway project copies never outlive the file that made them.
afterAll(cleanupProjects);
