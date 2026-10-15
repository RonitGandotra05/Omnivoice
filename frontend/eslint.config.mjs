import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { FlatCompat } = require("@eslint/eslintrc");
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
  ...compat.extends("next/core-web-vitals"),
  { ignores: [".next/**", "node_modules/**"] },
  { rules: { "react/no-unescaped-entities": "off" } },
];
