import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

test.describe("FS1 Full-Song E2E Verification", () => {
  // Mark as slow test due to Demucs/Whisper audio processing
  test("full-song analysis, song sheet rendering, editing, exchange, controls, and mobile layout", async ({ page }) => {
    test.slow();

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    // Monitor console errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(`[Console Error] ${msg.text()}`);
      }
    });

    // Monitor failed network requests
    page.on("response", (response) => {
      const url = response.url();
      const status = response.status();
      // Ignore external or non-critical 404s (e.g., favicon)
      if (status >= 400 && !url.includes("favicon.ico") && !url.includes(".map")) {
        failedRequests.push(`[HTTP ${status}] ${response.request().method()} ${url}`);
      }
    });

    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText;
      // Filter out intentional client-side cancellations via AbortController
      if (failure !== "net::ERR_ABORTED") {
        failedRequests.push(`[Request Failed] ${request.method()} ${request.url()} - ${failure}`);
      }
    });

    // 1. Open http://localhost:3000
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("networkidle");

    // Take initial screenshot
    await page.screenshot({ path: "test-results/01-landing-page.png", fullPage: true });

    // Verify page title and header
    await expect(page.locator(".hero h1")).toContainText("Hear it.");

    // Scroll to Full-Song Analysis panel
    const analysisPanel = page.locator(".full-song-analysis-panel");
    await expect(analysisPanel).toBeVisible();
    await analysisPanel.scrollIntoViewIfNeeded();

    // 2. Upload test track
    const candidatePaths = [
      process.env.FS1_TEST_TRACK_PATH,
      path.resolve("test-fixtures", "tts_twinkle.wav"),
      "C:\\swarai-tools\\fs1-verify\\tracks\\tts_twinkle.wav",
    ].filter(Boolean) as string[];
    const trackPath = candidatePaths.find((p) => fs.existsSync(p));
    expect(trackPath, "Test audio track fixture must exist").toBeTruthy();

    const fileInput = analysisPanel.locator('input[type="file"]');
    await fileInput.setInputFiles(trackPath!);

    // Verify file card appears
    await expect(analysisPanel.locator(".audio-file-card")).toBeVisible();
    await expect(analysisPanel.locator(".audio-file-details")).toContainText("tts_twinkle");

    // 3. Check authorisation checkbox
    const authCheckbox = analysisPanel.locator(".audio-consent input[type='checkbox']");
    await authCheckbox.check();
    await expect(authCheckbox).toBeChecked();

    // 4. Start analysis
    const submitButton = analysisPanel.locator(".audio-submit-button");
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Take screenshot during analysis
    await page.screenshot({ path: "test-results/02-analysis-started.png" });

    // 5. Wait for Complete (pipeline runs FFmpeg, Demucs, Whisper, Chords, Alignment)
    // The panel transitions to status "complete" and renders .audio-analysis-results
    const resultsContainer = analysisPanel.locator(".audio-analysis-results");
    await expect(resultsContainer).toBeVisible({ timeout: 240_000 });

    await page.screenshot({ path: "test-results/03-analysis-completed.png" });

    // 6. Confirm lyrics and C/F/G chords render
    // Check results summary metrics
    await expect(analysisPanel.locator(".audio-results-badge")).toContainText("Sheet ready");

    // Check Song Reader rendered lyrics and chords
    const songReader = page.locator("section#song-chords").first();
    await expect(songReader).toBeVisible();

    // Verify C, F, G chord badges or chord symbols exist
    const chordsInReader = songReader.locator(".chord-anchor, .chord-summary-badge, .chord-badge");
    const chordTexts = await chordsInReader.allInnerTexts();
    const joinedChords = chordTexts.join(" ");
    console.log("Detected chords in song reader:", chordTexts);

    expect(joinedChords).toMatch(/\bC\b/);
    expect(joinedChords).toMatch(/\bF\b/);
    expect(joinedChords).toMatch(/\bG\b/);

    // Verify lyrics render
    const lyricsContainer = songReader.locator(".song-sheet-container, .song-lyric-line, .lyric-segment");
    await expect(lyricsContainer.first()).toBeVisible();

    // 7. Load Song Chords
    const openReaderBtn = analysisPanel.locator(".audio-load-lesson-button");
    if (await openReaderBtn.isVisible()) {
      await openReaderBtn.click();
    }
    await songReader.scrollIntoViewIfNeeded();

    // 8. Edit a lyric and chord in Song Editor Panel
    const editorPanel = page.locator("#song-sheet-editor");
    await expect(editorPanel).toBeVisible();

    const textarea = editorPanel.locator('textarea[aria-label="ChordPro source text"]');
    await expect(textarea).toBeVisible();

    const originalChordPro = await textarea.inputValue();
    console.log("Original ChordPro:\n", originalChordPro);

    // Make an edit
    const editedChordPro = originalChordPro.includes("[C]")
      ? originalChordPro.replace(/\[C\]/, "[G]").replace(/Twinkle/i, "Shining")
      : originalChordPro + "\n[G] Shining star";
    await textarea.fill(editedChordPro);

    // Verify unsaved changes badge
    await expect(editorPanel.locator(".song-editor-state")).toContainText("Unsaved changes");

    // 9. Test undo, redo, and publish
    const undoButton = editorPanel.locator('button[aria-label="Undo last edit"]');
    await expect(undoButton).toBeEnabled();
    await undoButton.click();
    expect(await textarea.inputValue()).toBe(originalChordPro);

    const redoButton = editorPanel.locator('button[aria-label="Redo last edit"]');
    await expect(redoButton).toBeEnabled();
    await redoButton.click();
    expect(await textarea.inputValue()).toBe(editedChordPro);

    // Publish to song reader
    const publishButton = editorPanel.locator('button:has-text("Publish to song reader")');
    await expect(publishButton).toBeEnabled();
    await publishButton.click();

    // Verify state is clean
    await expect(editorPanel.locator(".song-editor-state")).toContainText("Sheet synced");

    // 10. Test JSON and ChordPro export/import
    // Export JSON
    const exportJsonBtn = editorPanel.locator('button:has-text("Export JSON")');
    await exportJsonBtn.click();
    await expect(editorPanel.locator(".song-editor-notice")).toContainText("Exported");

    // Export ChordPro
    const exportChordProBtn = editorPanel.locator('button:has-text("Export ChordPro")');
    await exportChordProBtn.click();
    await expect(editorPanel.locator(".song-editor-notice")).toContainText("Exported");

    // Test import ChordPro
    const chordProInput = editorPanel.locator('input[aria-label="Choose a ChordPro file to import"]');
    const tempChordProPath = path.resolve("test-results", "temp_import.cho");
    fs.mkdirSync(path.dirname(tempChordProPath), { recursive: true });
    fs.writeFileSync(tempChordProPath, "{title: Twinkle Test}\n[C]Twinkle [C]twinkle [F]little [F]star\n[G]How I [G]wonder [C]what you [C]are\n", "utf8");

    await chordProInput.setInputFiles(tempChordProPath);
    await expect(editorPanel.locator(".song-editor-notice")).toContainText("Imported");

    // Test import JSON
    const jsonInput = editorPanel.locator('input[aria-label="Choose a song sheet JSON file to import"]');
    const tempJsonPath = path.resolve("test-results", "temp_import.json");
    const testJsonData = {
      id: "import-test",
      metadata: {
        title: "JSON Import Test",
        composer: "Traditional",
        periodOrOrigin: "Folk",
        attribution: "Public Domain",
        difficulty: "Beginner",
        key: "C major",
        originalKey: "C major",
        timeSignature: "4/4",
        tuning: "E A D G B E",
        defaultCapo: 0,
        description: "Test import sheet description",
        isPublicDomain: true,
      },
      chordsUsed: ["C", "F", "G"],
      sections: [
        {
          id: "sec-1",
          title: "Verse 1",
          type: "verse",
          lines: [
            {
              segments: [
                { chord: "C", text: "Twinkle " },
                { chord: "F", text: "twinkle " },
                { chord: "G", text: "little star" },
              ],
            },
          ],
        },
      ],
    };
    fs.writeFileSync(tempJsonPath, JSON.stringify(testJsonData, null, 2), "utf8");
    await jsonInput.setInputFiles(tempJsonPath);
    await expect(editorPanel.locator(".song-editor-notice")).toContainText("Imported");

    // 11. Test tabs, transpose, capo and auto-scroll
    const mainSongReader = page.locator("section#song-chords").first();

    // Instrument Tabs
    const ukuleleTab = mainSongReader.locator('button[role="tab"]:has-text("Ukulele")');
    await ukuleleTab.click();
    await expect(ukuleleTab).toHaveClass(/is-active/);
    await expect(mainSongReader.locator(".meta-value:has-text('G C E A')")).toBeVisible();

    const pianoTab = mainSongReader.locator('button[role="tab"]:has-text("Piano Notes")');
    await pianoTab.click();
    await expect(pianoTab).toHaveClass(/is-active/);

    const guitarTab = mainSongReader.locator('button[role="tab"]:has-text("Guitar")');
    await guitarTab.click();
    await expect(guitarTab).toHaveClass(/is-active/);

    // Transpose
    const transposeUpBtn = mainSongReader.locator('button[aria-label="Transpose up 1 semitone"]');
    await transposeUpBtn.click();
    await expect(mainSongReader.locator(".transpose-display")).toContainText("+1 st");

    const resetTransposeBtn = mainSongReader.locator('button[aria-label="Reset transpose to original key"]');
    await resetTransposeBtn.click();
    await expect(mainSongReader.locator(".transpose-display")).toContainText("0 (Original)");

    // Capo
    const capoSelect = mainSongReader.locator("#capo-select");
    await capoSelect.selectOption("2");
    await expect(mainSongReader.locator(".song-meta-strip")).toContainText("Fret 2");

    // Auto-Scroll Controls
    const autoScrollBtn = mainSongReader.locator("button.play-scroll-btn");
    await expect(autoScrollBtn).toBeVisible();
    await autoScrollBtn.click();

    const restartScrollBtn = mainSongReader.locator('button[aria-label="Restart scroll to top"]');
    await expect(restartScrollBtn).toBeVisible();
    await restartScrollBtn.click();

    const speed2xBtn = mainSongReader.locator('.speed-btn:has-text("2x")');
    await speed2xBtn.click();
    await expect(speed2xBtn).toHaveClass(/is-selected/);

    await page.screenshot({ path: "test-results/04-desktop-controls.png", fullPage: true });

    // 12. Repeats layout checks at mobile width
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Verify main components are visible and responsive
    await expect(analysisPanel).toBeVisible();
    await expect(mainSongReader).toBeVisible();
    await expect(editorPanel).toBeVisible();

    await page.screenshot({ path: "test-results/05-mobile-layout.png", fullPage: true });

    // 13. Fail on console errors or failed API requests
    console.log("Console Errors Logged:", consoleErrors);
    console.log("Failed Requests Logged:", failedRequests);

    expect(consoleErrors, `Console errors occurred during execution:\n${consoleErrors.join("\n")}`).toEqual([]);
    expect(failedRequests, `Network failures occurred during execution:\n${failedRequests.join("\n")}`).toEqual([]);
  });
});
