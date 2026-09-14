/**
 * ESLint 8 classic config (.cjs because package.json sets "type": "module").
 *
 * Scoped deliberately narrow. TypeScript already rejects the whole class of
 * errors a stylistic ruleset would chase, so this only adds the checks the
 * compiler cannot make: React's rules of hooks, and stale effect dependencies.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["dist/", "node_modules/", "*.config.js"],
  rules: {
    "react-hooks/rules-of-hooks": "error",
    // An effect reading state it does not list is how a portal silently keeps
    // showing a stale order, so this is an error rather than the default warn.
    "react-hooks/exhaustive-deps": "error",

    // Underscore-prefixed arguments are an intentional "unused on purpose".
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    // Explicit any is a decision, not an accident; the compiler flags implicit
    // ones already.
    "@typescript-eslint/no-explicit-any": "warn",
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
  overrides: [
    {
      // The login pages are vanilla TypeScript with no React in them at all.
      files: ["login/*.ts"],
      rules: { "react-hooks/rules-of-hooks": "off", "react-hooks/exhaustive-deps": "off" },
    },
    {
      files: ["*.config.ts", "vite.config.ts", "tailwind.config.ts"],
      env: { node: true },
    },
  ],
};
