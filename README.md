# Arpoli · Gestión de tareas — guía de desarrollo

Copia del código fuente recuperada el 21-11-2026, commit f982de95bc0f6f118c0ad88482e1d6dbfa1d8612. Incluye interfaz y servidor en un único proyecto: la interfaz está principalmente en `app/*.tsx`; las rutas del servidor están en `app/api/` y `app/mcp/route.ts`. No existen carpetas independientes frontend/backend. El archivo README-original-starter.md conserva las instrucciones originales.

## Tecnología
React 19, TypeScript, Vinext/Vite, Cloudflare Workers, D1 (base SQLite), R2 (archivos), Drizzle y autenticación de ChatGPT Sites. Para autohospedaje, el proxy de Docker puede reemplazar esa autenticación por **Microsoft Entra ID** y enviar correos con **Microsoft Graph** (Outlook/Microsoft 365). Consultar package.json y .openai/hosting.json.

## Inicio local
1. Instalar Node.js 22.13 o superior y npm. Desde esta carpeta ejecutar `npm run install:ci`.
2. Ejecutar `npm run build` para generar la configuración local de Wrangler. Para crear las tablas locales, aplicar en orden los archivos SQL de `drizzle/` según la sección Local D1 migrations de README-original-starter.md, usando el binding `DB` y `dist/server/wrangler.json`.
3. Ejecutar `npm run dev` y abrir la dirección que indique (habitualmente http://localhost:5173). La autenticación simulada local descrita en el README original usa una cuenta de prueba que puede no coincidir con la lista de usuarios autorizados de esta aplicación; adaptar datos o autenticación solo en un entorno aislado. El funcionamiento local completo no ha sido probado en esta entrega.
4. Para vista del Worker compilado, `npm run start`. Los datos locales D1/R2 son independientes de producción.

## Docker (entorno local)

La app no corre con `next start` ni con un servidor Node tradicional: es un Worker de Cloudflare que se ejecuta sobre `workerd`. El `Dockerfile` compila el Worker y lo sirve con Wrangler/Miniflare, y publica la interfaz detrás de un proxy que inyecta la identidad de ChatGPT Sites (solo para desarrollo local).

```sh
# .env opcional en la raíz del repo (ignorado por git)
# OPENAI_API_KEY=...
# DEMO_USER_EMAIL=ana.torres@example.com
# Para login real y correo, ver la sección Microsoft 365 / Outlook.

docker compose up --build
```

Abrir http://localhost:3000. Al arrancar, el contenedor:

1. aplica las migraciones de `drizzle/` en la D1 local (idempotente, Wrangler registra las aplicadas);
2. arranca el Worker con Wrangler/Miniflare en `127.0.0.1:8787`;
3. expone `:3000` con un proxy que agrega los headers `oai-authenticated-user-*`.

La base D1 y los archivos R2 locales quedan en el volumen `arpoli-data` (`/app/.wrangler/state`). Para borrar todo: `docker compose down -v`.

Advertencias:

- Si no configurás `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` y `SESSION_SECRET`, el proxy usa un usuario demo. **No expongas ese modo a internet**: cualquiera que llegue al puerto actúa como ese usuario.
- `DEMO_USER_EMAIL` debe existir en `AUTHORIZED_PEOPLE` o en la lista ficticia de `lib/people.ts`. `MCP_OWNER_EMAIL` habilita las herramientas de `/mcp`.
- `OPENAI_API_KEY` es opcional: habilita IA y transcripción. El correo saliente usa Microsoft Graph si configurás `MS_*` y `MAIL_*`.

## Microsoft 365 / Outlook

Fuera de ChatGPT Sites, el proxy de `docker/auth-proxy.mjs` puede autenticar con **Microsoft Entra ID** y los avisos salen por **Microsoft Graph** desde un buzón del tenant. Así los usuarios usan sus cuentas `@arpoli` normales, sin cuentas de ChatGPT.

### 1. App registration en Entra ID

1. Entra admin center → App registrations → New registration.
2. Supported account types: **Accounts in this organizational directory only**.
3. Redirect URI (Web): `http://localhost:3000/auth/callback` (y la URL real de producción).
4. Certificates & secrets → New client secret.
5. API permissions de Microsoft Graph:
   - Delegated: `openid`, `profile`, `email` (para el login).
   - Application: `Mail.Send` (para enviar como el buzón remitente).
   - Grant admin consent.

### 2. Variables

```sh
MS_TENANT_ID=<tenant-id>
MS_CLIENT_ID=<client-id>
MS_CLIENT_SECRET=<client-secret>
SESSION_SECRET=<openssl rand -hex 32>
MS_REDIRECT_URI=http://localhost:3000/auth/callback
ALLOWED_EMAIL_DOMAIN=example.com
MAIL_PILOT_SENDER=no-reply@example.com
MAIL_PILOT_RECIPIENT=<buzón de prueba>
MCP_OWNER_EMAIL=<correo autorizado para /mcp>
AUTHORIZED_PEOPLE=[{"email":"persona@example.com","name":"Nombre","role":"owner","manager":null}]
```

- `AUTHORIZED_PEOPLE` es la allowlist real; se pasa como binding/secret y no se versiona. Si está vacía se usan las personas ficticias de demo.
- `Mail.Send` de aplicación envía como `MAIL_PILOT_SENDER`; si necesitás limitar buzones, usá una Application Access Policy en Exchange.
- `ALLOWED_EMAIL_DOMAIN` restringe el login al dominio del cliente. Sin esa variable, cualquier cuenta Microsoft puede iniciar sesión, aunque la app igual exige estar en `AUTHORIZED_PEOPLE`.
- OpenAI sigue siendo necesario para las funciones de IA/transcripción; Outlook no las reemplaza. Si no querés usarlas, dejá `OPENAI_API_KEY` vacío y esas rutas quedan deshabilitadas.

Flujo: `/auth/signin` redirige a Microsoft, `/auth/callback` valida el token y crea una cookie de sesión firmada con `SESSION_SECRET`, y `/auth/signout` la borra. El proxy traduce el correo de Entra a los headers `oai-authenticated-user-*` que ya consume el Worker.

## Tests, SonarQube y Git

### Tests

Hay tres suites con Vitest: `tests/frontend/` (React + Testing Library), `tests/backend/` (rutas de `app/api`, MCP, Graph y un D1 falso) y `tests/proxy/` (flujo OAuth del proxy con un proveedor Microsoft falso). Actualmente son **139 tests en 19 archivos**, con ~69% de statements y ~91% de líneas; `docker/auth-lib.mjs` queda en ~98% de líneas.

```sh
pnpm install
pnpm run test           # ambas suites
pnpm run test:frontend
pnpm run test:backend
pnpm run test:coverage  # genera coverage/lcov.info
pnpm run verify         # lint + typecheck + tests + build
```

La configuración está en `vitest.config.ts`. Para que las rutas de Worker se puedan probar en Node, `cloudflare:workers` se reemplaza por `tests/stubs/cloudflare-workers.ts`.

### SonarQube local

```sh
# Solo Linux nativo (Docker Desktop ya lo configura)
sudo sysctl -w vm.max_map_count=524288

docker compose -f docker-compose.sonarqube.yml up -d
```

1. Esperar a que responda http://localhost:9000 e iniciar sesión con `admin` / `admin` (cambia la clave).
2. Crear el proyecto con la clave `arpoli-mailmanager` (debe coincidir con `sonar-project.properties`).
3. Generar un token en **My Account → Security**.
4. Correr el análisis:

```sh
export SONAR_TOKEN=<tu-token>
pnpm run sonar
```

`pnpm run sonar` ejecuta primero la cobertura y luego el scanner oficial en Docker. Los resultados quedan en http://localhost:9000. Para el MCP de SonarQube, apúntalo a `http://localhost:9000` con ese mismo token.

Apagar el servidor (conserva datos): `docker compose -f docker-compose.sonarqube.yml down`. Borrar todo: agregar `-v`.

### Git + gitleaks

```sh
git init -b main
git config core.hooksPath .githooks
pnpm install
git add .
git commit -m "chore: initial commit"
git remote add origin https://github.com/<usuario>/<repo>.git
git push -u origin main
```

- `.githooks/pre-commit` ejecuta `gitleaks git --pre-commit --staged`.
- `.githooks/pre-push` escanea el historial con gitleaks y luego corre `pnpm run verify` (si algo falla, el push se bloquea).
- Para saltarlo puntualmente: `git push --no-verify` (no recomendado).

### Si ya se subieron datos personales

Un commit nuevo **no** borra los correos de los commits anteriores: siguen en el historial y accesibles por su SHA. Para reducirlo:

1. Poner el repositorio en **privado** de inmediato en GitHub.
2. Reescribir la historia. En este repo alcanza con aplastar todo sobre el commit raíz:

```sh
git reset --soft $(git rev-list --max-parents=0 HEAD)
git commit --amend -m "chore: initial commit"
git push --force-with-lease origin main
```

   Para historiales más grandes usar `git filter-repo --replace-text reemplazos.txt`.
3. Pedir a GitHub que purgue las vistas cacheadas y objetos inalcanzables: https://support.github.com/request/remove-content
4. Rotar cualquier clave que haya estado en el commit. Los correos no son claves, pero asumí que ya estuvieron expuestos: un force-push no elimina copias en forks, cachés ni clones.

Si el repo fue público, no se puede garantizar que nadie los haya copiado. La reescritura solo evita que sigan en la rama principal.

La regla `@typescript-eslint/no-explicit-any` y dos reglas de hooks de React están desactivadas solo para `app/**` en `eslint.config.mjs`, porque el código recuperado está minificado en una línea y ya venía con esa deuda. SonarQube sigue reportando esos hallazgos.

### CI en GitHub Actions

`.github/workflows/ci.yml` corre en cada push/PR: instalación con pnpm, lint, typecheck, tests de frontend y backend con cobertura, build del Worker y gitleaks. El paso de SonarQube se ejecuta solo si configuras los secrets `SONAR_TOKEN` y `SONAR_HOST_URL` (por ejemplo SonarCloud o un servidor accesible desde el runner; un runner de GitHub no ve tu `localhost`).

## Variables y servicios
Ver `.env.example` para nombres sin claves. En Cloudflare Workers las claves se leen como bindings del entorno; una copia de `.env.example` no garantiza por sí sola que Vinext/Wrangler las cargue. Configurar secretos para desarrollo mediante el mecanismo compatible de Wrangler/Sites. `OPENAI_API_KEY` habilita las rutas IA/transcripción; `MS_*`, `MAIL_PILOT_*` y `AUTHORIZED_PEOPLE` habilitan login Microsoft, correo Graph y la allowlist real. Nunca subir secretos ni datos personales al repositorio. `DB` y `BUCKET` son bindings de D1 y R2, no cadenas de conexión en .env.

## Datos, seguridad y despliegue
El código usa personas y correos ficticios (`@example.com`); los datos reales se configuran con `AUTHORIZED_PEOPLE` o en la tabla `people` de D1. No se incluyen registros ni adjuntos de producción, claves, sesiones ni dependencias instaladas. La configuración de producción, autenticación, permisos, base de datos y almacenamiento deben revisarse antes de conectar o desplegar. No utilizar el identificador de .openai/hosting.json para reemplazar la app original accidentalmente.
