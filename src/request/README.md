# Request Utilities Documentation

This document provides an overview of the utilities located in `src/request/`. This module currently focuses on IP-based request validation, specifically for checking against an IP deny list.

## Core Functionality

*   **IP Deny List Check:** Provides a mechanism to determine if an incoming request's IP address is present in a configured deny list, potentially blocking requests from specific IPs or network ranges.
*   **SSRF Protection (Partial):** Includes a specific check to prevent requests to the server's own network interfaces if `0.0.0.0` is part of the deny list.

## Key Components

### `is-denied-ip.ts`

This file exports a single function:

*   **`isDeniedIp(ip: string): boolean`**
    *   **Purpose:** Checks if the provided `ip` address should be denied based on the environment configuration.
    *   **Logic:**
        1.  Retrieves the IP deny list from the `IMPORT_IP_DENY_LIST` environment variable. This variable should contain an array of IP addresses, CIDR notations, or network ranges.
        2.  If the deny list is empty, the function returns `false` (IP is not denied).
        3.  It uses the `ipInNetworks()` utility (from `src/helpers/utils/ip-in-networks.js`) to check if the given `ip` matches any entry in the `IMPORT_IP_DENY_LIST`.
            *   If a match is found, it returns `true` (IP is denied).
            *   If `ipInNetworks()` encounters an error (e.g., due to an invalid format in `IMPORT_IP_DENY_LIST`), a warning is logged, and the function defaults to returning `true` (IP is denied as a security precaution).
        4.  **Special SSRF Check:** If `0.0.0.0` is present in the `IMPORT_IP_DENY_LIST`, the function additionally iterates through all network interfaces of the server (using `os.networkInterfaces()`). If the provided `ip` matches any of the server's own interface addresses, it returns `true` (IP is denied). This helps prevent Server-Side Request Forgery (SSRF) by blocking requests that target the application server itself when `0.0.0.0` is specified in the deny list.
        5.  If none of the above conditions lead to a denial, the function returns `false`.

## Usage Context

The `isDeniedIp` function is likely used early in the request lifecycle, possibly in middleware or at the entry point of specific functionalities (like import features, as suggested by the environment variable name `IMPORT_IP_DENY_LIST`), to block requests from disallowed IP addresses.

## Configuration

*   **`IMPORT_IP_DENY_LIST` (Environment Variable):**
    *   **Type:** An array of strings.
    *   **Content:** Each string can be an individual IP address (e.g., "192.168.1.10"), a CIDR block (e.g., "10.0.0.0/8"), or potentially other network range formats supported by the `ipInNetworks` utility.
    *   **Special Value:** Including `"0.0.0.0"` in this list activates an additional check against the server's own network interfaces to mitigate SSRF risks. 