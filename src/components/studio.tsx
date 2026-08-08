"use client";

import { Circle, Info, Play, RotateCcw } from "lucide-react";
import { Piano } from "@/components/piano";

export function Studio() {
  return <section id="studio" className="studio-section"><div className="section-heading"><div><p className="eyebrow">Practice room / 01</p><h1>Make a little room<br /><em>for your sound.</em></h1></div><p className="heading-copy">A quiet place to build your ear and your hands. Start with the instrument below, then bring your own authorised audio when you&apos;re ready.</p></div><div className="lesson-workspace"><div className="workspace-top"><div><span className="status-dot" />Lesson workspace <span className="muted">/ empty</span></div><div className="workspace-actions"><button type="button" disabled aria-label="Reset lesson"><RotateCcw size={16} /></button><button type="button" disabled aria-label="Play lesson"><Play size={16} /></button></div></div><div className="empty-lesson"><div className="empty-icon"><Circle size={15} /></div><h3>Your lesson canvas is ready</h3><p>Song visualisations will appear here once an authorised track is added.</p><span><Info size={14} /> Audio analysis isn&apos;t available in this preview</span></div></div><Piano /><p className="legal-note">Only analyse audio you own or are authorised to use. Please respect the rights of music creators.</p></section>;
}
