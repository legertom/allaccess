import next from "eslint-config-next";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "data/**",
      "tests/fixtures/**",
      "next-env.d.ts"
    ]
  },
  ...next
];

export default config;
