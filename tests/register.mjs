// Lets `node --test` load the app's TypeScript modules, which use
// extensionless relative imports ("./validation"), by trying a ".ts" suffix.
// Node runs .ts files itself via built-in type stripping (Node 22.18+ / 23.6+).
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {
            return next(specifier + ".ts", context);
          }
          throw error;
        }
      }
    `),
  import.meta.url,
);
