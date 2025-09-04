export type PostgresError = {
	message: string;
	length: number;
	code: string;
	detail: string;
	schema: string;
	table: string;
	column?: string;
	dataType?: string;
	constraint?: string;
};



export type SQLError =  PostgresError & Error;
