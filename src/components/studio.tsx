"use client";

import { LessonWorkspace } from "@/features/lesson/LessonWorkspace";

export function Studio() {
  return <section id="studio" className="studio-section"><div className="section-heading"><div><p className="eyebrow">Practice room / 01</p><h1>Make a little room<br /><em>for your sound.</em></h1></div><p className="heading-copy">A quiet place to build your ear and your hands. Start with the instrument below, then bring your own authorised audio when you&apos;re ready.</p></div><LessonWorkspace /><p className="legal-note">Only analyse audio you own or are authorised to use. Please respect the rights of music creators.</p></section>;
}
