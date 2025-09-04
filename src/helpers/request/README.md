# Request Helpers (`src/helpers/request`)

This directory provides helper utilities for making HTTP(S) requests, with a specific focus on outgoing request IP address validation and denial.

## Overview

The primary utility provided is a configured Axios instance that prevents requests from being made to IP addresses specified in a deny list. This is crucial for security and to prevent the application from interacting with unintended or malicious network endpoints, especially in server-side environments.

## Key Components

*   **`index.ts`**: 
    *   Exports a function `getAxios()` which returns a pre-configured Axios instance.
    *   This Axios instance is set up with custom HTTP and HTTPS agents that incorporate IP validation.
    *   It caches the Axios instance to avoid re-initialization on subsequent calls.

*   **`agent-with-ip-validation.ts`**:
    *   Exports `agentWithIpValidation(agent: Agent)`, a function that takes a standard Node.js `http.Agent` or `https.Agent`.
    *   It wraps the agent's `createConnection` method.
    *   Before a connection is established, it checks if the target host (if already an IP) or the resolved IP address (via a `lookup` event on the socket) is a denied IP using the `isDeniedIp` helper.
    *   If the IP is found to be denied, the connection is destroyed, preventing the request.

*   **`is-denied-ip.ts`**:
    *   Exports `isDeniedIp(ip: string): boolean`, a function that determines if a given IP address should be denied.
    *   It checks the IP against a deny list configured via the `IMPORT_IP_DENY_LIST` environment variable. This variable should contain an array of IP addresses or CIDR network ranges.
    *   It utilizes the `ipInNetworks` utility (from `../utils/ip-in-networks.js`) for checking IPs against network ranges.
    *   If `0.0.0.0` is present in `IMPORT_IP_DENY_LIST`, it also checks if the IP matches any of the local machine's network interface addresses, effectively blocking requests to self.
    *   Logs a warning and defaults to denying the IP if there's an error processing the deny list (e.g., invalid configuration).

## How It Works

1.  The application calls `getAxios()` to obtain an Axios instance for making outgoing HTTP/S requests.
2.  `getAxios()` initializes Axios with custom agents created by `agentWithIpValidation`.
3.  When a request is made using this Axios instance:
    a.  The `agentWithIpValidation` intercepts the connection attempt.
    b.  It calls `isDeniedIp` with the target IP address.
    c.  `isDeniedIp` checks the IP against the `IMPORT_IP_DENY_LIST` and local network interfaces (if `0.0.0.0` is in the list).
    d.  If `isDeniedIp` returns `true`, the connection is terminated, and the request fails.

## Configuration

*   **`IMPORT_IP_DENY_LIST`**: This environment variable is crucial for the functionality of this module. It should be set as a JSON string array of IP addresses or CIDR notations that should be blocked. For example: `'["127.0.0.1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]'`.

## Usage

To make an HTTP/S request using the IP-validated Axios instance:

```typescript
import { getAxios } from '@/helpers/request'; // Adjust path as per your project structure
sync function fetchData(url: string) {
  try {
    const axios = await getAxios();
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error('Request failed:', error.message);
    // Handle error, which might be due to a denied IP
  }
}
```

This setup enhances the security of outgoing requests by ensuring they do not target restricted IP spaces. 