import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 300_000, // 5 minutes for full-song AI pipeline (Demucs + Whisper + Chords)
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome", // Use installed system Google Chrome
    trace: "on",
    screenshot: "on",
    video: "off",
  },
  projects: [
    {
      name: "chrome",
      use: {
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
