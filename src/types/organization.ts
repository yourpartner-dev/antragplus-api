import type { File } from './files.js';

export type OrganizationStatus = 'active' | 'inactive' | 'suspended';

export interface Organization {
  id: string;
  name: string | null;
  company_name: string | null;
  billing_address: string | null;
  domain_name: string | null;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  logo: string | File | null;
  registration_number: string | null;
  status: OrganizationStatus;
  created_at: string;
  metadata: Record<string, any> | null;
}