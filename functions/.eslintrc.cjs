module.exports = {
  root: true,
  env: { es2022: true, node: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: { project: ["tsconfig.json"], sourceType: "module" },
  ignorePatterns: ["lib/**/*", "node_modules/**/*"],
  plugins: ["@typescript-eslint", "import"],
  rules: {
    quotes: ["error", "double"],
    "import/no-unresolved": 0,
    "max-len": ["warn", { code: 120 }],
  },
};
