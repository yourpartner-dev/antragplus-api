export type Role = {
	id: string;
	name: string;
	description: string;
	icon: string;
	enforce_tfa: null | boolean;
	external_id: null | string;
	ip_access: string[];
	app_access: boolean;
	admin_access: boolean;
	users: string[];
};

export type Avatar = {
	id: string;
};

export type User = {
	id: string;
	status: 'draft' | 'invited' | 'unverified' | 'active' | 'suspended' | 'archived';
	first_name: string | null;
	last_name: string | null;
	email: string | null;
	password: string | null;
	token: string | null;
	last_access: string | null;
	last_page: string | null;
	external_identifier: string | null;
	tfa_secret: string | null;
	auth_data: Record<string, any> | null;
	provider: string;
	role: string | null;
	language: string | null;
	title: string | null;
	description: string | null;	
	app_access?: number | boolean | undefined;
	admin_access?: number | boolean | undefined;
	metadata: any;
	public_registration: boolean;
	organization_id: string | null;
};


export type RegisterUserInput = {
	email: NonNullable<User['email']>;
	password: NonNullable<User['password']>;
	user_id: User['id'];
	verification_url?: string | null;
	first_name?: User['first_name'];
	last_name?: User['last_name'];
	organization_id?: User['organization_id'];
};
