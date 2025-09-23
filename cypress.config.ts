import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:8083",
    supportFile: "cypress/support/e2e.ts",
    video: false,
    testIsolation: false, // Disable test isolation for better compatibility
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 30000,
    requestTimeout: 10000,
    responseTimeout: 30000,
  },
});
