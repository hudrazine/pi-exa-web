import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: { "*": "vp check --fix" },

  fmt: {
    ignorePatterns: [".agents/**"],
  },

  lint: {
    options: { typeAware: true, typeCheck: true },
    plugins: ["eslint", "typescript", "unicorn", "oxc"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    categories: {
      correctness: "error",
      suspicious: "warn",
    },
    rules: {
      "typescript/no-misused-promises": "error",
      "typescript/switch-exhaustiveness-check": "error",
      "typescript/no-deprecated": "error",
      "typescript/no-explicit-any": "warn",
      "typescript/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      "unicorn/prefer-node-protocol": "error",

      "vite-plus/prefer-vite-plus-imports": "error",
    },

    overrides: [
      {
        files: ["**/*.test.ts", "**/*.spec.ts"],
        plugins: ["eslint", "typescript", "unicorn", "oxc", "vitest"],
        rules: {
          "vitest/expect-expect": "warn",
          "vitest/no-unneeded-async-expect-function": "error",
          "vitest/no-mocks-import": "error",
          "vitest/no-conditional-tests": "off",

          "typescript/no-explicit-any": "off",
        },
      },
    ],
  },
});
