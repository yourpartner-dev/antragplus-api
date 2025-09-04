// src/helpers/system-data/loadYaml.ts
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

// Convert the module URL to a file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/**
 * Loads a YAML file and returns its parsed content
 * @param fileName - The name of the YAML file to load
 * @returns The parsed YAML data
 */
export function loadYamlFile(fileName: string): any {
  try {
    const filePath = path.resolve(__dirname, fileName);
    const fileContents = fs.readFileSync(filePath, 'utf8');
    return yaml.load(fileContents);
  } catch (error) {
    console.error(`Error reading or parsing the YAML file: ${fileName}`, error);
    return null;
  }
}