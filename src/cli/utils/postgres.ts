import pkg from 'pg';
const { Client } = pkg;
import chalk from 'chalk';
import ora from 'ora';
import { nanoid } from 'nanoid';

interface PostgresCredentials {
    host: string;
    port: number;
    user: string;
    password: string;
    database?: string;
}

function generateDatabaseName(projectName?: string): string {
    if (!projectName) {
        return `yp_${nanoid(8)}`;
    }
    
    // Convert project name to lowercase, replace spaces and special chars with underscores
    const sanitizedName = projectName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    
    // Ensure the name is not too long (PostgreSQL has a 63 character limit)
    const maxLength = 50; // Leave room for potential prefixes/suffixes
    const truncatedName = sanitizedName.slice(0, maxLength);
    
    return `yp_${truncatedName}`;
}

export async function createPostgresDatabase(credentials: PostgresCredentials, projectName?: string): Promise<string> {
    const spinner = ora('Creating PostgreSQL database...').start();
    
    // Generate database name if not provided
    const databaseName = credentials.database || generateDatabaseName(projectName);
    
    // Connect to the provided admin database
    const client = new Client({
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password,
        database: credentials.database // Use the provided admin database
    });

    try {
        await client.connect();
        
        // Check if database exists
        const result = await client.query(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            [databaseName]
        );

        if (result.rowCount === 0) {
            // Create database if it doesn't exist
            await client.query(`CREATE DATABASE "${databaseName}"`);
            spinner.succeed(`Database ${chalk.blue(databaseName)} created successfully`);
        } else {
            spinner.info(`Database ${chalk.blue(databaseName)} already exists`);
        }
        
        return databaseName;
    } catch (error: any) {
        spinner.fail(`Failed to create database: ${error.message}`);
        throw error;
    } finally {
        await client.end();
    }
}

export async function checkPostgresConnection(credentials: PostgresCredentials): Promise<boolean> {
    const client = new Client({
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password,
        database: credentials.database // Use the provided admin database
    });

    try {
        await client.connect();
        return true;
    } catch (error) {
        return false;
    } finally {
        await client.end();
    }
} 