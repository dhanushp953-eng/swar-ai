import type { SongSheet } from "@/types/song-sheet";

export const twinkleLittleStarSongSheet: SongSheet = {
  id: "twinkle-twinkle-little-star",
  metadata: {
    title: "Twinkle, Twinkle, Little Star",
    composer: "Traditional Nursery Rhyme",
    periodOrOrigin: "Poem: Jane Taylor (1806) · Melody: Traditional French Theme",
    attribution: "Public Domain · Free to learn and share",
    difficulty: "Beginner",
    key: "C major",
    originalKey: "C major",
    timeSignature: "4/4",
    tuning: "E A D G B E",
    defaultCapo: 0,
    description: "The classic folk lullaby built on three foundational primary chords: C Major (I), F Major (IV), and G Major (V).",
    isPublicDomain: true,
  },
  chordsUsed: ["C", "F", "G"],
  sections: [
    {
      id: "section-intro",
      title: "Intro",
      type: "intro",
      lines: [
        {
          id: "intro-1",
          segments: [
            { chord: "C", text: "[ " },
            { chord: "F", text: "Strum " },
            { chord: "C", text: "Count: " },
            { chord: "G", text: "1 - 2 - 3 - 4" },
            { chord: "C", text: " ]" },
          ],
        },
      ],
    },
    {
      id: "section-verse-1",
      title: "Verse",
      type: "verse",
      lines: [
        {
          id: "v1-line-1",
          segments: [
            { chord: "C", text: "Twinkle, " },
            { chord: null, text: "twinkle, " },
            { chord: "F", text: "little " },
            { chord: "C", text: "star," },
          ],
        },
        {
          id: "v1-line-2",
          segments: [
            { chord: "F", text: "How I " },
            { chord: "C", text: "wonder " },
            { chord: "G", text: "what you " },
            { chord: "C", text: "are!" },
          ],
        },
        {
          id: "v1-line-3",
          segments: [
            { chord: "C", text: "Up a-" },
            { chord: "F", text: "bove the " },
            { chord: "C", text: "world so " },
            { chord: "G", text: "high," },
          ],
        },
        {
          id: "v1-line-4",
          segments: [
            { chord: "C", text: "Like a " },
            { chord: "F", text: "diamond " },
            { chord: "C", text: "in the " },
            { chord: "G", text: "sky." },
          ],
        },
        {
          id: "v1-line-5",
          segments: [
            { chord: "C", text: "Twinkle, " },
            { chord: null, text: "twinkle, " },
            { chord: "F", text: "little " },
            { chord: "C", text: "star," },
          ],
        },
        {
          id: "v1-line-6",
          segments: [
            { chord: "F", text: "How I " },
            { chord: "C", text: "wonder " },
            { chord: "G", text: "what you " },
            { chord: "C", text: "are!" },
          ],
        },
      ],
    },
    {
      id: "section-outro",
      title: "Outro",
      type: "outro",
      lines: [
        {
          id: "outro-1",
          segments: [
            { chord: "F", text: "How I " },
            { chord: "C", text: "wonder " },
            { chord: "G", text: "what you " },
            { chord: "C", text: "are." },
          ],
        },
        {
          id: "outro-2",
          segments: [
            { chord: "C", text: "[ Slow " },
            { chord: "F", text: "final " },
            { chord: "C", text: "strum ~ ]" },
          ],
        },
      ],
    },
  ],
};
