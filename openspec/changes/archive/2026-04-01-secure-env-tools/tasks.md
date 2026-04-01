## 1. Remove auth/.env from allowlist

- [x] 1.1 Remove `auth/.env` from `STATIC_ALLOWED` in `src/tools/admin/allowlist.ts`
- [x] 1.2 Remove the `validateDotenv` function and its reference in `validateContent`
- [x] 1.3 Remove `auth/.env` format hint from `getFormatHint`
- [x] 1.4 Update allowlist tests to verify `auth/.env` is rejected

## 2. Implement env tools

- [x] 2.1 Implement `admin_set_env` tool in `src/tools/admin/adminSetEnv.ts` — read/modify/write `.env` file, key format validation (`[A-Z][A-Z0-9_]*`), empty value = delete, never return values
- [x] 2.2 Implement `admin_list_env` tool in `src/tools/admin/adminListEnv.ts` — parse `.env` and return key names only
- [x] 2.3 Register both tools in `src/tools/server.ts` gated by `canEditConfig(ctx.role)`

## 3. Tool mappings

- [x] 3.1 Add tool mapping labels for `admin_set_env` (e.g., "Admin - Setting env {key}") and `admin_list_env` (e.g., "Admin - Listing env keys")

## 4. Tests

- [x] 4.1 Add tests for `admin_set_env` — set new key, update existing, delete, invalid key format, create file if missing, never returns values
- [x] 4.2 Add tests for `admin_list_env` — list keys, empty file, missing file
- [x] 4.3 Update allowlist tests to confirm `auth/.env` is no longer allowed
