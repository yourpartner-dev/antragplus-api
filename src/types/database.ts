export type Driver = 'pg';

export const DatabaseClients = ['postgres'] as const;
export type DatabaseClient = (typeof DatabaseClients)[number];
