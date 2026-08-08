import { Music2, ArrowUpRight } from "lucide-react";

export function SiteHeader() {
  return <header className="site-header"><a className="brand" href="#top" aria-label="SwarAI home"><span className="brand-mark"><Music2 size={18} /></span><span>Swar<span className="brand-accent">AI</span></span></a><nav><a href="#studio">Studio</a><a href="#how-it-works">How it works</a><a href="#about">About</a></nav><a className="header-cta" href="#studio">Open studio <ArrowUpRight size={15} /></a></header>;
}
