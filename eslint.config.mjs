import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "public/circuits/**",
    "src/**/__tests__/**",
    "src/**/*.test.*",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React Compiler's lint currently flags common mount/hydration effects
      // used by Next client components. Keep the actionable hook rules on.
      "react-hooks/set-state-in-effect": "off",

      // Every <img> left in this codebase is a 14-80px token or brand icon
      // served from /public. next/image exists to optimise LCP-relevant and
      // remote images; at this size it optimises nothing and costs an explicit
      // width/height at each call site. Revisit if a real content image lands.
      "@next/next/no-img-element": "off",

      // A leading underscore marks a deliberately unused binding: a parameter
      // that only exists to reach a later one, or a field destructured to be
      // discarded. Without this the convention is unenforceable and the rule
      // fires on code that is already saying "I know".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
