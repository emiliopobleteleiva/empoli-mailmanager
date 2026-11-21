// Reemplazo de `cloudflare:workers` para tests en Node.
// El Worker real recibe `env` con los bindings D1/R2 y secrets; en tests los
// asignamos desde cada caso.
export const env: Record<string, unknown> = {};
