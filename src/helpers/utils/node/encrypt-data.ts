import { createHmac } from "crypto";
import { useEnv } from "../../env/index.js";
const env = useEnv()

export function createSignedTokenData(data: { access_token: string; refresh_token: string; expires: number }): string {
    const secret = env['SSO_TOKEN_SECRET'];
    
    if(!secret) {
        throw new Error('SSO_TOKEN_SECRET is not set');
    }
    
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    
    const signature = createHmac('sha256', secret as string)
        .update(payload)
        .digest('base64url');
    
    return `${payload}.${signature}`;
}