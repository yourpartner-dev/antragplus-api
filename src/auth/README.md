# Authentication System (`src/auth/`)

This document outlines the architecture and functionality of the authentication system. The primary entry point and configuration hub for authentication strategies is `src/auth.ts`.

## Overview

The authentication system is designed to be flexible and extensible, supporting multiple authentication providers. It handles user login, session management (via JWT access and refresh tokens), token refresh, logout, and password management features.

Key design principles include:
*   **Provider-Based Strategy**: Different authentication methods are encapsulated within individual "Auth Drivers."
*   **Centralized Registration**: `src/auth.ts` manages the registration and retrieval of these providers based on environment variable configurations.
*   **Service Layer**: `src/services/authentication.ts` contains the core business logic for authentication flows, interacting with the selected Auth Driver.
*   **Controller Layer**: `src/controllers/auth.ts` exposes authentication functionalities via RESTful API endpoints, dynamically creating routes for each configured provider.
*   **Configuration via Environment**: Providers and their specific settings are primarily configured using environment variables.

## Core Components

1.  **`src/auth.ts` (Provider Management)**
    *   **Purpose**: Acts as the central registry for all configured authentication providers. It initializes and makes available different authentication drivers based on environment settings.
    *   **Key Functions**:
        *   `registerAuthProviders()`: Reads environment variables (starting with `AUTH_PROVIDERS`, `AUTH_DISABLE_DEFAULT`, and provider-specific prefixes like `AUTH_<PROVIDER_NAME_UPPERCASE>_`) to instantiate and register the appropriate auth drivers. It uses `getConfigFromEnv()` to extract detailed configurations for each provider. The default `local` provider is registered unless `AUTH_DISABLE_DEFAULT` is true.
        *   `getAuthProvider(providerName: string)`: Retrieves an instantiated and configured authentication driver by its unique name (e.g., "local", "google_oauth").
        *   `getProviderInstance(driverType: string, options: AuthDriverOptions, config: Record<string, any>)`: A factory function that creates an instance of a specific `AuthDriver` class (e.g., `LocalAuthDriver`, `OAuth2AuthDriver`) based on the `driverType` string.
    *   **Mechanism**: It maintains an internal `Map` storing provider names (strings) mapped to their instantiated `AuthDriver` objects.

2.  **`src/auth/drivers/` (Authentication Drivers - `AuthDriver` Base Class)**
    *   **Purpose**: Contains concrete implementations (drivers) for different authentication strategies. Each driver extends the base `AuthDriver` class and implements methods specific to its authentication mechanism.
    *   **Base `AuthDriver` Class**: Defines a common interface including:
        *   `getUserID(payload: Record<string, any>)`: Abstract method to resolve a user ID based on the provider-specific payload (e.g., credentials, OAuth code).
        *   `login(user: User, payload: Record<string, any>)`: Method to perform login-specific actions after user identification (e.g., password verification for local, token exchange for OAuth).
        *   `verify(user: User, password?: string)`: Method for local password verification.
        *   `refresh(user: User)`: Method to handle provider-specific token refresh logic if applicable (e.g., refreshing an OAuth token with the provider).
        *   `logout(user: User)`: Method for provider-specific logout actions.
    *   **Each driver typically also exports a `create<DriverName>AuthRouter(providerName: string)` function**, which sets up Express.js routes specific to that provider\'s flow (e.g., handling OAuth redirects, SAML ACS).

3.  **`src/services/authentication.ts` (`AuthenticationService`)**
    *   **Purpose**: Encapsulates the core, provider-agnostic business logic for all authentication-related operations. It uses the driver provided by `src/auth.ts`.
    *   **Key Responsibilities**:
        *   **Login**: Orchestrates the login process. It calls the appropriate `AuthDriver`\'s `getUserID` and `login` methods, performs user status checks, handles Two-Factor Authentication (TFA/OTP) (if configured for the user via `TFAService`), manages login attempt rate limiting, and generates JWT access tokens and refresh tokens.
        *   **Token Refresh**: Validates incoming refresh tokens, generates new access tokens (and potentially new rotated refresh tokens), and manages session data in the `yp_sessions` table.
        *   **Logout**: Invalidates sessions by removing the refresh token from `yp_sessions` and calling the `AuthDriver`\'s `logout` method if necessary.
        *   **Password Management**: While password reset requests and completion are handled by `UsersService`, the `AuthenticationService` might be involved in verification steps.
        *   **Security**: Implements login stalling (via `stall()` utility) to mitigate timing attacks.
        *   **Event Emission**: Emits events (e.g., `auth.login`, `auth.jwt`) via `../emitter.js` at various stages, allowing for custom extensions and integrations.

4.  **`src/controllers/auth.ts` (API Endpoints)**
    *   **Purpose**: Exposes authentication functionalities as REST API endpoints using Express.js.
    *   **Key Features**:
        *   **Dynamic Provider Routing**: Iterates through providers registered in `src/auth.ts` and dynamically creates and mounts specific routers for each one under `/login/:providerName` (e.g., `/login/local`, `/login/google_oauth`). These provider-specific routers (e.g., `createLocalAuthRouter`, `createOAuth2AuthRouter` from the driver files) handle the initial steps and callbacks of their respective authentication flows.
        *   **Standard Endpoints**:
            *   `POST /refresh`: Handles token refresh requests, delegating to `AuthenticationService`. Expects the current session token (containing embedded refresh token) via the `SESSION_COOKIE_NAME` cookie if in `session` mode, or a `refresh_token` in the JSON body if in `json` mode.
            *   `POST /logout`: Handles user logout, delegating to `AuthenticationService`. Uses the `SESSION_COOKIE_NAME` if in `session` mode.
            *   `POST /password/request`: Initiates a password reset (delegates to `UsersService`).
            *   `POST /password/reset`: Completes a password reset (delegates to `UsersService`).
            *   `GET /`: Lists available authentication providers (names and configuration like icons/labels), useful for frontends to dynamically display login options.
        *   **Mode Handling**: The routers created by drivers (e.g., `createLocalAuthRouter`) and the main `/auth/refresh`, `/auth/logout` endpoints support two primary modes for how tokens are managed with the client: `json` and `session`.
            *   `json`: Tokens are exchanged in the JSON request/response body.
            *   `session`: The primary token (an access token JWT which embeds the refresh token in its `session` claim) is managed via an HttpOnly cookie (configurable by `SESSION_COOKIE_NAME`, defaults to `yp_session_token`).
        *   **Cookie Management**: For `session` mode, sets and clears the session cookie using options from `src/constants.js` (`SESSION_COOKIE_OPTIONS`), ensuring `HttpOnly`, `SameSite`, `Secure` (in production) attributes.

## Authentication Drivers Deep Dive

The following sections detail each available authentication driver found in `src/auth/drivers/`.

### 1. Local Authentication (`local.ts` - `LocalAuthDriver`)

*   **Mechanism**: Standard email and password authentication against the local application database (`yp_users` table).
*   **`LocalAuthDriver` Methods**:
    *   `getUserID(payload)`: Expects `email` in payload. Queries `yp_users` for a user with the matching email (case-insensitive).
    *   `verify(user, password)`: Verifies the provided `password` against the user\'s stored hashed password using `argon2.verify()`.
    *   `login(user, payload)`: Calls `verify()` with the password from the payload.
*   **Router (`createLocalAuthRouter`)**:
    *   Exposes a `POST /` endpoint (relative to `/login/:providerName`).
    *   Validates `email`, `password`, `mode` (optional, Joi schema: `'json'`, `'session'`, defaults to `json`), and `otp` (optional).
    *   Calls `AuthenticationService.login()`.
    *   Based on the `mode`:
        *   `json`: Returns `access_token`, `refresh_token`, and `expires` in the JSON response.
        *   `session`: Sets the `access_token` (JWT containing the refresh_token in its `session` claim) as an HttpOnly cookie (name from `SESSION_COOKIE_NAME`). Returns `expires` in JSON.
    *   Implements login stalling.
*   **Configuration**: Default provider. `AUTH_DISABLE_DEFAULT` can disable it.

### 2. OAuth 2.0 (`oauth2.ts` - `OAuth2AuthDriver`)

*   **Mechanism**: Implements OAuth 2.0 Authorization Code Flow with PKCE. Generic driver for various OAuth 2.0 providers.
*   **`OAuth2AuthDriver` Key Aspects**:
    *   **Initialization**:
        *   Uses the `openid-client` library.
        *   Configured with `authorizeUrl`, `accessUrl`, `profileUrl`, `clientId`, `clientSecret`, and a unique `provider` name.
        *   Constructs a `redirectUrl` based on `PUBLIC_URL` (e.g., `PUBLIC_URL/auth/login/<provider_name>/callback`).
        *   Allows overriding client options via `AUTH_<PROVIDER_NAME_UPPERCASE>_CLIENT_*` env vars.
    *   `generateAuthUrl(codeVerifier, prompt)`: Creates the authorization URL to redirect the user to the OAuth provider, including PKCE parameters (`code_challenge`, `code_challenge_method`), scope, and state.
    *   `getUserID(payload)`:
        *   Handles the callback from the OAuth provider. Expects `code`, `codeVerifier`, and `state` in the payload.
        *   Uses `client.oauthCallback()` to exchange the authorization `code` for tokens.
        *   Fetches user information from the provider\'s profile URL (`client.userinfo()`).
        *   Extracts user email and a unique identifier (configurable via `emailKey`, `identifierKey` env vars, defaults to `email` and `email`/`sub` respectively).
        *   **User Provisioning/Linking**:
            *   Checks if a user exists with the `external_identifier`.
            *   If exists, updates their `auth_data` (e.g., new refresh token from provider if available). Emits `auth.update` hook.
            *   If not exists and `allowPublicRegistration` (env var) is true, creates a new user in `yp_users` with details from the provider and `defaultRoleId`. Emits `auth.create` hook.
            *   Returns the internal user ID.
    *   `login(user)`: Calls `this.refresh(user)` to potentially refresh the OAuth token with the provider.
    *   `refresh(user)`: If `auth_data` for the user contains a `refreshToken` from the OAuth provider, it attempts to use `client.refresh()` to get a new set of tokens from the provider and updates the user\'s `auth_data` if a new refresh token is issued by the provider.
*   **Router (`createOAuth2AuthRouter`)**:
    *   `GET /`: Initiates OAuth flow, sets temporary state cookie, redirects to provider.
    *   `POST /callback` and `GET /callback`: Handles callback from provider.
        *   Calls `AuthenticationService.login()`.
        *   **Token Delivery**: If a `redirect` URL was part of the initial flow:
            *   If `AUTH_<PROVIDER_NAME_UPPERCASE>_MODE` is `session` (default for redirects), sets the main session cookie (`SESSION_COOKIE_NAME` containing the access token with embedded refresh token) and redirects.
            *   If `AUTH_<PROVIDER_NAME_UPPERCASE>_MODE` is `json` and a redirect is present, the token delivery mechanism for this redirect scenario would need careful client-side handling (e.g., tokens in query parameters or fragment, though this is less common/secure for tokens).
        *   If no client `redirect` was specified and mode is `json`, returns API `access_token`, `refresh_token`, and `expires` in the JSON response.
*   **Configuration (Environment Variables for a provider named `MYOAUTH`)**:
    *   `AUTH_MYOAUTH_DRIVER=oauth2`
    *   `AUTH_MYOAUTH_CLIENT_ID`
    *   `AUTH_MYOAUTH_CLIENT_SECRET`
    *   `AUTH_MYOAUTH_AUTHORIZE_URL`
    *   `AUTH_MYOAUTH_ACCESS_URL`
    *   `AUTH_MYOAUTH_PROFILE_URL`
    *   `AUTH_MYOAUTH_SCOPE` (optional, e.g., `email profile`)
    *   `AUTH_MYOAUTH_EMAIL_KEY` (optional, path to email in userinfo response)
    *   `AUTH_MYOAUTH_IDENTIFIER_KEY` (optional, path to unique ID in userinfo response)
    *   `AUTH_MYOAUTH_FIRST_NAME_KEY`, `AUTH_MYOAUTH_LAST_NAME_KEY`
    *   `AUTH_MYOAUTH_ALLOW_PUBLIC_REGISTRATION` (boolean)
    *   `AUTH_MYOAUTH_DEFAULT_ROLE_ID` (UUID of a role in `yp_roles`)
    *   `AUTH_MYOAUTH_PLAIN_CODE_CHALLENGE` (boolean, if provider doesn\'t support S256)
    *   `AUTH_MYOAUTH_PARAMS_*` (for additional params to authorization URL)
    *   `AUTH_MYOAUTH_CLIENT_*` (for additional openid-client options)
    *   `AUTH_MYOAUTH_MODE` (optional: `json`, `session`. Defaults to `session` if a client redirect URL is used in the flow, otherwise behavior might lean towards `json` if no redirect.).

### 3. OpenID Connect (`openid.ts` - `OpenIDAuthDriver`)

*   **Mechanism**: Implements OpenID Connect (OIDC) on top of OAuth 2.0.
*   **`OpenIDAuthDriver` Key Aspects**:
    *   **Initialization**:
        *   Requires `issuerUrl` (for OIDC discovery), `clientId`, and `clientSecret`.
        *   Uses `Issuer.discover()` to fetch OIDC provider metadata.
        *   Verifies that the provider supports the `code` response type.
    *   `generateAuthUrl(codeVerifier, prompt)`: Similar to OAuth2, but typically includes `openid` in the scope (e.g., `openid profile email`) and a `nonce`.
    *   `getUserID(payload)`:
        *   Similar to OAuth2 callback handling. Uses `client.callback()` with `code`, `state`, `iss` (issuer), `code_verifier`, and `nonce`.
        *   User information is primarily sourced from `tokenSet.claims()` (ID Token claims) and can be augmented by `client.userinfo()` if a `userinfo_endpoint` is available.
        *   Default identifier key is `sub` (subject).
        *   Supports `requireVerifiedEmail` config: if true, user creation is blocked if `email_verified` claim is not true.
        *   User provisioning/linking logic is very similar to `OAuth2AuthDriver`.
    *   `login(user)` and `refresh(user)`: Similar to `OAuth2AuthDriver`, handling OIDC token refresh with the provider if a refresh token was issued.
*   **Router (`createOpenIDAuthRouter`)**: Flow is very similar to `OAuth2AuthRouter`.
    *   **Token Delivery**: Similar to OAuth2 driver: if a client `redirect` URL is used, `session` mode (setting `SESSION_COOKIE_NAME`) is typical. If no client redirect and mode is `json`, tokens are in JSON response.
*   **Configuration (Environment Variables for a provider named `MYOIDC`)**:
    *   `AUTH_MYOIDC_DRIVER=openid`
    *   `AUTH_MYOIDC_ISSUER_URL` (e.g., `https://accounts.google.com`)
    *   `AUTH_MYOIDC_CLIENT_ID`
    *   `AUTH_MYOIDC_CLIENT_SECRET`
    *   `AUTH_MYOIDC_SCOPE` (optional, e.g., `openid profile email`)
    *   `AUTH_MYOIDC_IDENTIFIER_KEY` (optional, default `sub`)
    *   `AUTH_MYOIDC_ALLOW_PUBLIC_REGISTRATION` (boolean)
    *   `AUTH_MYOIDC_DEFAULT_ROLE_ID`
    *   `AUTH_MYOIDC_REQUIRE_VERIFIED_EMAIL` (boolean, optional)
    *   `AUTH_MYOIDC_PLAIN_CODE_CHALLENGE` (boolean)
    *   `AUTH_MYOIDC_PARAMS_*`
    *   `AUTH_MYOIDC_CLIENT_*`
    *   `AUTH_MYOIDC_MODE` (optional: `json`, `session`. Behavior similar to OAuth2 regarding redirects).

### 4. LDAP (`ldap.ts` - `LDAPAuthDriver`)

*   **Mechanism**: Authenticates against an LDAP directory.
*   **`LDAPAuthDriver` Key Aspects**:
    *   **Initialization**:
        *   Uses the `ldapjs` library.
        *   Requires `clientUrl` (or `client.socketPath`), `bindDn`, `bindPassword` (for an admin/service account to search LDAP), and `userDn` (base DN for user searches).
        *   Creates a persistent `bindClient` for searching.
    *   `validateBindClient()`: Ensures the `bindClient` can connect and search (initially by searching its own `bindDn`). Attempts to re-bind if a search fails.
    *   `fetchUserInfo(baseDn, filter, scope)`: Searches LDAP for a user entry based on a filter. Attributes like `firstNameAttribute`, `lastNameAttribute`, `mailAttribute` are configurable (default to `givenName`, `sn`, `mail`). Extracts `uid` and `userAccountControl`.
    *   `fetchUserGroups(baseDn, filter, scope)`: Searches LDAP for groups a user belongs to. `groupAttribute` (e.g., `member` or `memberUid`) and `groupDn` are configurable.
    *   `getUserID(payload)`:
        *   Expects `identifier` (e.g., username) in the payload.
        *   Validates the `bindClient`.
        *   Searches for the user in LDAP using `userDn`, `userAttribute` (default `cn`), and the provided `identifier`.
        *   If user found in LDAP:
            *   Optionally, if `groupDn` is configured, searches for the user\'s groups and tries to map them to internal `yp_roles` by group CN matching role name.
            *   Determines the user\'s internal role (LDAP group mapped role, or `defaultRoleId`).
            *   Checks if a user with this `external_identifier` (LDAP DN) exists in `yp_users`.
            *   If exists, updates their role if changed based on LDAP group mapping. Emits `auth.update`.
            *   If not exists (and public registration is implicitly allowed by LDAP setup), creates a new user with details from LDAP (first name, last name, email, external_identifier=DN) and the determined role. Emits `auth.create`.
    *   `verify(user, password)`: Attempts to bind to the LDAP server directly as the user using their `external_identifier` (which is their DN) and the provided `password`. This is the actual password verification step.
    *   `login(user, payload)`: Calls `verify()` with the user (containing their DN) and password from payload.
    *   `refresh(user)`: Validates the `bindClient`. Fetches the user\'s info from LDAP again and checks `userAccountControl` flags (e.g., `ACCOUNTDISABLE`, `LOCKOUT`) to ensure the account is still valid.
*   **Router (`createLDAPAuthRouter`)**:
    *   `POST /`: Handles LDAP login.
    *   Based on the `mode` (Joi schema: `'json'`, `'session'`, defaults to `json`):
        *   `json`: Returns `access_token`, `refresh_token`, and `expires` in JSON.
        *   `session`: Sets the `access_token` (JWT with embedded refresh token) as an HttpOnly cookie (`SESSION_COOKIE_NAME`). Returns `expires` in JSON.
*   **Configuration (Environment Variables for a provider named `MYLDAP`)**:
    *   `AUTH_MYLDAP_DRIVER=ldap`
    *   `AUTH_MYLDAP_CLIENT_URL` (e.g., `ldap://ldap.example.com`)
    *   `AUTH_MYLDAP_BIND_DN` (DN of service account)
    *   `AUTH_MYLDAP_BIND_PASSWORD`
    *   `AUTH_MYLDAP_USER_DN` (Base DN to search for users, e.g., `ou=users,dc=example,dc=com`)
    *   `AUTH_MYLDAP_USER_ATTRIBUTE` (optional, attribute to match identifier against, default `cn`)
    *   `AUTH_MYLDAP_USER_SCOPE` (optional, `base`|`one`|`sub`, default `one`)
    *   `AUTH_MYLDAP_FIRST_NAME_ATTRIBUTE`, `AUTH_MYLDAP_LAST_NAME_ATTRIBUTE`, `AUTH_MYLDAP_MAIL_ATTRIBUTE` (optional)
    *   `AUTH_MYLDAP_DEFAULT_ROLE_ID` (for users if no group mapping or if group doesn\'t map to a role)
    *   `AUTH_MYLDAP_GROUP_DN` (optional, Base DN to search for groups)
    *   `AUTH_MYLDAP_GROUP_ATTRIBUTE` (optional, attribute on group object that lists members, e.g., `member` or `memberUid`)
    *   `AUTH_MYLDAP_GROUP_SCOPE` (optional)
    *   `AUTH_MYLDAP_CLIENT_*` (any additional options for `ldapjs.createClient()`)
    *   `AUTH_MYLDAP_MODE` (optional: `json`, `session`).

### 5. SAML (`saml.ts` - `SAMLAuthDriver`)

*   **Mechanism**: SAML 2.0 Web Browser SSO Profile (SP initiated).
*   **`SAMLAuthDriver` Key Aspects**:
    *   **Initialization**:
        *   Uses the `samlify` library. Requires `@authenio/samlify-node-xmllint` for schema validation.
        *   Configuration for both the Service Provider (this application) and the Identity Provider (IdP) is loaded from environment variables using `getConfigFromEnv`. Prefixes are `AUTH_<PROVIDER_NAME_UPPERCASE>_SP_*` and `AUTH_<PROVIDER_NAME_UPPERCASE>_IDP_*`. These typically define entity IDs, ACS URLs, signing certificates, etc.
    *   `getUserID(payload)`: The `payload` here is the attributes extracted from the SAML assertion by `samlify` after successful IdP authentication.
        *   Extracts user email, a unique identifier, first name, and last name from SAML attributes. The attribute names are configurable via `emailKey`, `identifierKey`, `givenNameKey`, `familyNameKey` (with common SAML URI defaults).
        *   **User Provisioning/Linking**: Similar to OAuth/OIDC:
            *   Checks if a user exists with the `external_identifier` (SAML NameID or configured identifier).
            *   If exists, returns user ID.
            *   If not exists and `allowPublicRegistration` is true, creates a new user with attributes from SAML and `defaultRoleId`. Emits `auth.create`.
    *   `login(user)`: Does nothing as authentication is fully delegated to the IdP. The fact that `getUserID` was called with a valid SAML assertion means the user is authenticated by the IdP.
*   **Router (`createSAMLAuthRouter`)**:
    *   `GET /metadata`: Serves SP metadata.
    *   `GET /`: Redirects to IdP for authentication.
    *   `POST /logout`: SAML SLO and local session logout.
    *   `POST /acs`: Consumes SAML assertion from IdP.
        *   Calls `AuthenticationService.login()` to create an internal API session.
        *   **Token Delivery**: If `RelayState` (client redirect URL) is present:
            *   If `AUTH_<PROVIDER_NAME_UPPERCASE>_MODE` is `session` (default for redirects), sets the `SESSION_COOKIE_NAME` and redirects.
            *   If mode is `json` with `RelayState`, token delivery is more complex.
        *   If no `RelayState` and mode is `json`, returns API tokens in JSON.
*   **Configuration (Environment Variables for a provider named `MYSAML`)**:
    *   `AUTH_MYSAML_DRIVER=saml`
    *   `AUTH_MYSAML_ALLOW_PUBLIC_REGISTRATION` (boolean)
    *   `AUTH_MYSAML_DEFAULT_ROLE_ID`
    *   `AUTH_MYSAML_EMAIL_KEY`, `AUTH_MYSAML_IDENTIFIER_KEY`, `AUTH_MYSAML_GIVEN_NAME_KEY`, `AUTH_MYSAML_FAMILY_NAME_KEY` (optional, SAML attribute names)
    *   `AUTH_MYSAML_MODE` (optional: `json`, `session`. Default for redirects is `session`).
    *   **Service Provider (SP) Config (`AUTH_MYSAML_SP_*`)**:
        *   `AUTH_MYSAML_SP_ENTITY_ID` (Your application\'s SAML entity ID)
        *   `AUTH_MYSAML_SP_ASSERTION_CONSUMER_SERVICE` (Array/CSV, e.g., `PUBLIC_URL/auth/login/mysaml/acs`)
        *   `AUTH_MYSAML_SP_SINGLE_LOGOUT_SERVICE` (Array/CSV, optional)
        *   `AUTH_MYSAML_SP_PRIVATE_KEY` (Path to SP private key or the key itself)
        *   `AUTH_MYSAML_SP_ENCRYPT_KEY` (Path to SP encryption private key or the key itself, optional)
        *   `AUTH_MYSAML_SP_SIGNING_CERTIFICATE` (Path to SP signing certificate or the cert itself, optional but IdP usually requires SP metadata to have it)
        *   `AUTH_MYSAML_SP_ENCRYPTION_CERTIFICATE` (Path to SP encryption certificate or the cert itself, optional)
        *   Other `samlify` SP options... (`AUTH_MYSAML_SP_WANT_ASSERTIONS_SIGNED`, etc.)
    *   **Identity Provider (IdP) Config (`AUTH_MYSAML_IDP_*`)**:
        *   `AUTH_MYSAML_IDP_ENTITY_ID` (IdP\'s SAML entity ID)
        *   `AUTH_MYSAML_IDP_SINGLE_SIGN_ON_SERVICE` (Array/CSV, IdP\'s SSO URL)
        *   `AUTH_MYSAML_IDP_SINGLE_LOGOUT_SERVICE` (Array/CSV, IdP\'s SLO URL, optional)
        *   `AUTH_MYSAML_IDP_SIGNING_CERTIFICATE` (Path to IdP\'s signing certificate or the cert itself)
        *   `AUTH_MYSAML_IDP_ENCRYPTION_CERTIFICATE` (Path to IdP\'s encryption certificate or the cert itself, optional if SP encrypts)
        *   Other `samlify` IdP options...

## Authentication Flow Example (OAuth 2.0 - "google")

1.  **Client Request**: User clicks "Login with Google" on the frontend. Frontend navigates/redirects to `GET /auth/login/google?redirect=<client_callback_url>`.
2.  **Controller (`src/controllers/auth.ts` -> `createOAuth2AuthRouter` for "google")**:
    *   The `GET /` handler for the "google" provider is invoked.
    *   It generates a `codeVerifier`, stores it and the `redirect` URL in a temporary signed JWT cookie (`oauth2.google`).
    *   It calls `googleAuthDriver.generateAuthUrl()` to get Google\'s authorization URL.
    *   It redirects the user\'s browser to Google.
3.  **User Authentication at Google**: User authenticates with Google and authorizes the application.
4.  **Redirect to Callback**: Google redirects the user back to the `redirectUrl` configured in the `OAuth2AuthDriver` (e.g., `PUBLIC_URL/auth/login/google/callback?code=...&state=...`).
5.  **Controller (OAuth2 callback handler)**:
    *   The `GET /callback` handler for "google" is invoked.
    *   It retrieves and verifies the `oauth2.google` JWT cookie to get the original `codeVerifier` and client `redirect` URL.
    *   It calls `AuthenticationService.login('google', { code, codeVerifier, state })`.
6.  **Service (`AuthenticationService.login`)**:
    *   Retrieves the `googleAuthDriver` (instance of `OAuth2AuthDriver`).
    *   Calls `googleAuthDriver.getUserID({ code, codeVerifier, state })`:
        *   Driver exchanges `code` for tokens with Google using PKCE.
        *   Driver fetches user profile from Google.
        *   Driver provisions/links user in local DB, gets internal user ID.
    *   `AuthenticationService` performs checks (user status, TFA - though less common for pure OAuth).
    *   Generates internal API JWT access and refresh tokens.
7.  **Controller (OAuth2 callback handler continued)**:
    *   Receives tokens from `AuthenticationService`.
    *   If `client_callback_url` was present, sets API tokens as HttpOnly cookies (based on `AUTH_GOOGLE_MODE`) and redirects the user to `client_callback_url`.
    *   If no `client_callback_url`, returns API tokens in JSON response.
8.  **Client**: Receives tokens (via redirect with cookies, or JSON) and completes login.

## Configuration Summary

*   **Global**:
    *   `AUTH_PROVIDERS`: Comma-separated list of provider names to enable (e.g., `local,google_oauth,my_saml_idp`).
    *   `AUTH_DISABLE_DEFAULT=true`: To disable the built-in `local` provider.
    *   `SECRET`: For signing internal JWTs and temporary state cookies.
    *   Token TTLs (`ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `SESSION_COOKIE_TTL`).
    *   Cookie names (`SESSION_COOKIE_NAME` is primary for cookie-based auth. `REFRESH_COOKIE_OPTIONS` is for `SESSION_COOKIE_NAME` if `REFRESH_TOKEN_TTL` is different or for client-side storage of refresh token from JSON mode, not for a server-set refresh cookie if using `session` mode with embedded refresh token.)
    *   `LOGIN_STALL_TIME`.
*   **Provider-Specific**: Each enabled provider requires its own set of environment variables, prefixed with `AUTH_<PROVIDER_NAME_UPPERCASE>_`. The `DRIVER` variable within this prefix (e.g., `AUTH_GOOGLE_OAUTH_DRIVER=oauth2`) tells `src/auth.ts` which driver class to instantiate. Other variables configure that specific driver instance (e.g., client IDs, secrets, URLs, attribute mappings).

## Extensibility

The system uses an event emitter (`../emitter.js`) to allow for custom logic to be hooked into the authentication process:
*   `auth.login`: Emitted during the `AuthenticationService.login` process, allowing modification of the payload or custom actions based on login status.
*   `auth.jwt`: Emitted by `AuthenticationService` before JWT generation, allowing customization of token claims.
*   `auth.create` / `auth.update`: Emitted by drivers like OAuth2, OpenID, LDAP during user provisioning to allow modification of user data before it\'s saved to the database.

## Security Considerations

*   **Password Hashing**: Passwords for local accounts are securely hashed using Argon2 (via `UsersService`).
*   **JWT Security**: Internal API access tokens are signed JWTs. Refresh tokens are opaque and stored securely (in `yp_sessions` or as HttpOnly cookies).
*   **PKCE**: OAuth 2.0 and OpenID Connect drivers use PKCE for enhanced security in the authorization code flow.
*   **State/Nonce**: OAuth 2.0/OpenID use state parameters; OpenID also uses nonces to prevent replay attacks.
*   **TFA/OTP**: Two-Factor Authentication is supported for local accounts via `TFAService` if `tfa_secret` is configured for a user.
*   **Rate Limiting**: Login attempts are rate-limited by `AuthenticationService`.
*   **Stalling**: A fixed delay is introduced during local login to mitigate timing attacks.
*   **HttpOnly Cookies**: `session` mode uses HttpOnly cookies (`SESSION_COOKIE_NAME`) for the access token (which embeds the refresh token), enhancing security.
*   **SAML Security**: Relies on XML digital signatures and potentially encryption as per SAML standards, handled by `samlify`. Ensure IdP and SP metadata (certificates) are correctly configured.

This document provides a detailed overview of the authentication system and its various drivers. For precise implementation details, always refer to the respective source code files. 