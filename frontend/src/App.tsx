/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Landing page scaffold imported from Silas's AI Studio export.
 * Wired here so every "Get Started" CTA drops into the iris Studio editor
 * (pages/Studio.tsx) while keeping the landing as the first view.
 */

import { motion } from 'motion/react';
import {
  ArrowUpRight,
  Play,
  Zap,
  Palette,
  BarChart3,
  Shield,
} from 'lucide-react';
import { useState } from 'react';
import { BlurText } from './components/BlurText';
import { HLSVideo } from './components/HLSVideo';
import { Studio } from './pages/Studio';

// --- Components ---

function Navbar({ onEnter }: { onEnter: () => void }) {
  return (
    <nav className="fixed top-4 left-0 right-0 z-50 px-8 lg:px-16 py-3">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <IrisMark />
          <span className="text-white font-heading italic text-2xl tracking-tight">iris</span>
        </div>

        <div className="hidden md:flex items-center gap-1 liquid-glass rounded-full px-1.5 py-1">
          {["Home", "Studio", "Process", "Pricing"].map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase()}`}
              className="px-3 py-2 text-sm font-medium text-foreground/90 font-body hover:text-white transition-colors"
            >
              {link}
            </a>
          ))}
        </div>

        <button
          onClick={onEnter}
          className="flex items-center gap-1.5 bg-white text-black rounded-full px-3.5 py-1.5 text-sm font-medium hover:bg-white/90 transition-colors"
        >
          Open Studio
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

// Tiny inline chrome-lens SVG (no external asset needed)
function IrisMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="nav-chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4f4f4" />
          <stop offset="48%" stopColor="#d0d0d0" />
          <stop offset="52%" stopColor="#8a8a8a" />
          <stop offset="100%" stopColor="#e8e8e8" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="none" stroke="url(#nav-chrome)" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="10" fill="url(#nav-chrome)" />
    </svg>
  );
}

function Hero({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="relative h-[1000px] overflow-visible bg-black">
      <video
        autoPlay
        loop
        muted
        playsInline
        poster="/images/hero_bg.jpeg"
        className="absolute left-0 top-[20%] w-full h-auto object-contain z-0"
      >
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_3CXxQfd4lyRSHbXTz8mFo8jo75k/hf_20260418_215523_d6bd5c6e-30bb-48b9-a74a-952658f9f97a.mp4"
          type="video/mp4"
        />
      </video>

      <div className="absolute inset-0 bg-black/5 z-0" />
      <div
        className="absolute bottom-0 left-0 right-0 h-[300px] z-0 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, black)' }}
      />

      <div className="relative z-10 flex flex-col items-center pt-[150px] px-8 text-center max-w-5xl mx-auto h-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="liquid-glass rounded-full px-1 py-1 mb-8 flex items-center gap-2"
        >
          <span className="bg-white text-black rounded-full px-3 py-1 text-xs font-semibold">New</span>
          <span className="text-xs text-white/90 font-body pr-3">
            Single-prompt AI edits inside a non-linear studio.
          </span>
        </motion.div>

        <BlurText
          text="Rewrite the reel, piece by piece."
          className="text-6xl md:text-7xl lg:text-[5.5rem] font-heading italic text-foreground leading-[0.8] max-w-4xl tracking-[-4px] mb-8"
          delay={100}
        />

        <motion.p
          initial={{ filter: 'blur(10px)', opacity: 0, y: 20 }}
          animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="text-sm md:text-lg text-white font-body font-light leading-tight max-w-md mb-10"
        >
          Cut, split, trim — then describe the change. Iris rewrites a clip in place with a single Veo 3.1 pass.
        </motion.p>

        <motion.div
          initial={{ filter: 'blur(10px)', opacity: 0, y: 20 }}
          animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-6"
        >
          <button
            onClick={onEnter}
            className="liquid-glass-strong rounded-full px-5 py-2.5 flex items-center gap-2 text-white font-body hover:scale-105 transition-transform"
          >
            Open the Studio
            <ArrowUpRight className="h-4 w-4" />
          </button>
          <button className="flex items-center gap-2 text-white font-body group hover:text-white/80 transition-colors">
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-white text-black">
              <Play className="h-3 w-3 fill-current" />
            </span>
            Watch the Reel
          </button>
        </motion.div>

        <div className="mt-auto pb-8 pt-16 w-full flex flex-col items-center gap-8">
          <div className="liquid-glass rounded-full px-4 py-2 text-xs text-white/60 font-body">
            Powered by
          </div>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-16 opacity-50">
            {["Veo 3.1", "Gemini", "SAM 2", "CLIP", "ElevenLabs"].map((brand) => (
              <span key={brand} className="text-2xl md:text-3xl font-heading italic text-white">
                {brand}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StartSection({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="relative min-h-[500px] flex items-center justify-center bg-black py-20 overflow-hidden">
      <HLSVideo
        src="https://stream.mux.com/9JXDljEVWYwWu01PUkAemafDugK89o01BR6zqJ3aS9u00A.m3u8"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div
        className="absolute top-0 left-0 right-0 h-[200px] z-1 pointer-events-none"
        style={{ background: 'linear-gradient(to top, transparent, black)' }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-[200px] z-1 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, black)' }}
      />

      <div className="relative z-10 text-center px-8 flex flex-col items-center gap-6 max-w-3xl border-0">
        <span className="liquid-glass rounded-full px-3.5 py-1 text-xs font-medium text-white font-body">
          How It Works
        </span>
        <h2 className="text-4xl md:text-5xl lg:text-6xl font-heading italic tracking-tight leading-[0.9] text-white">
          Assemble. Prompt. Ship.
        </h2>
        <p className="text-white/60 font-body font-light text-sm md:text-base max-w-xl">
          Drop footage on the timeline. Cut and trim like any NLE. Select a clip, describe the change, and a single AI edit replaces it — same duration, same slot.
        </p>
        <button
          onClick={onEnter}
          className="liquid-glass-strong rounded-full px-6 py-3 text-white font-body hover:scale-105 transition-transform mt-4"
        >
          Open the Studio
        </button>
      </div>
    </section>
  );
}

function FeaturesChess() {
  const rows = [
    {
      title: "A real timeline. Not a toy.",
      body: "Split at the playhead, drag clip edges to trim, slide clips around, level per-clip audio. The studio behaves like a non-linear editor because it is one.",
      button: "See the editor",
      gif: "https://motionsites.ai/assets/hero-finlytic-preview-CV9g0FHP.gif",
      reverse: false,
    },
    {
      title: "One prompt. One edit. One place.",
      body: "Select a clip, type the change, let Veo 3.1 re-shoot that moment. The output inherits the clip's duration and stays inside the cut.",
      button: "How it works",
      gif: "https://motionsites.ai/assets/hero-wealth-preview-B70idl_u.gif",
      reverse: true,
    },
  ];

  return (
    <section className="bg-black py-24 px-8 md:px-16">
      <div className="max-w-7xl mx-auto flex flex-col gap-32">
        <div className="flex flex-col items-center gap-4 text-center mb-16">
          <span className="liquid-glass rounded-full px-3.5 py-1 text-xs font-medium text-white font-body">
            Capabilities
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-heading italic tracking-tight leading-[0.9] text-white">
            Pro editor. Zero complexity.
          </h2>
        </div>

        {rows.map((row, idx) => (
          <div
            key={idx}
            className={`flex flex-col lg:flex-row items-center gap-16 ${row.reverse ? 'lg:flex-row-reverse' : ''}`}
          >
            <div className="flex-1 flex flex-col items-start gap-6">
              <h3 className="text-3xl md:text-4xl font-heading italic text-white leading-tight">
                {row.title}
              </h3>
              <p className="text-white/60 font-body font-light text-base leading-relaxed">
                {row.body}
              </p>
              <button className="liquid-glass-strong rounded-full px-6 py-2.5 text-white font-body hover:scale-105 transition-transform">
                {row.button}
              </button>
            </div>
            <div className="flex-1 w-full">
              <div className="liquid-glass rounded-2xl overflow-hidden aspect-video relative group">
                <img
                  src={row.gif}
                  alt={row.title}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeaturesGrid() {
  const cards = [
    {
      icon: <Zap className="h-5 w-5" />,
      title: "Single-pass AI",
      description: "One prompt = one generation. No variant shelves, no comparison fatigue. You get the edit or you reprompt.",
    },
    {
      icon: <Palette className="h-5 w-5" />,
      title: "Non-destructive",
      description: "Every cut, split, and trim is metadata. Your source footage is untouched until you export.",
    },
    {
      icon: <BarChart3 className="h-5 w-5" />,
      title: "Built to ship",
      description: "Designed for a 2-minute reel, not a feature film. Every step optimized for speed.",
    },
    {
      icon: <Shield className="h-5 w-5" />,
      title: "Your cut, your call",
      description: "No watermarks. No forced branding. The output is the raw clip, ready for your cut.",
    },
  ];

  return (
    <section className="bg-black py-24 px-8 md:px-16">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col items-center gap-4 text-center mb-16">
          <span className="liquid-glass rounded-full px-3.5 py-1 text-xs font-medium text-white font-body">
            Why iris
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-heading italic tracking-tight leading-[0.9] text-white">
            The difference is everything.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {cards.map((card, i) => (
            <div key={i} className="liquid-glass rounded-2xl p-6 flex flex-col gap-6 group hover:bg-white/5 transition-colors">
              <div className="liquid-glass-strong rounded-full w-10 h-10 flex items-center justify-center text-white ring-1 ring-white/10">
                {card.icon}
              </div>
              <h3 className="text-xl font-heading italic text-white">{card.title}</h3>
              <p className="text-white/60 font-body font-light text-sm leading-snug">
                {card.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const stats = [
    { label: "Seconds to first edit", value: "< 30" },
    { label: "Prompts per minute", value: "2" },
    { label: "Variants you pick from", value: "1" },
    { label: "AI models in the pipeline", value: "4" },
  ];

  return (
    <section className="relative py-24 px-8 md:px-16 overflow-hidden min-h-[600px] flex items-center justify-center">
      <HLSVideo
        src="https://stream.mux.com/NcU3HlHeF7CUL86azTTzpy3Tlb00d6iF3BmCdFslMJYM.m3u8"
        className="absolute inset-0 w-full h-full object-cover grayscale"
        style={{ filter: 'saturate(0)' }}
      />
      <div
        className="absolute top-0 left-0 right-0 h-[200px] z-1 pointer-events-none"
        style={{ background: 'linear-gradient(to top, transparent, black)' }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-[200px] z-1 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, black)' }}
      />

      <div className="relative z-10 w-full max-w-5xl">
        <div className="liquid-glass rounded-3xl p-12 md:p-16 border border-white/5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-12 text-center">
            {stats.map((stat, i) => (
              <div key={i} className="flex flex-col gap-2">
                <span className="text-4xl md:text-5xl lg:text-5xl font-heading italic text-white">
                  {stat.value}
                </span>
                <span className="text-white/60 font-body font-light text-xs uppercase tracking-widest">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const reviews = [
    {
      text: "First prompt landed the edit I wanted. Sat back down in the timeline and kept cutting. That's the whole game.",
      name: "Sarah Chen",
      role: "Director, Luminary",
    },
    {
      text: "It feels like Premiere with a genie on the side. The AI stays out of my way until I call it.",
      name: "Marcus Webb",
      role: "Editor, Arcline",
    },
    {
      text: "I don't want three options. I want one good one. That's what iris gives me every time.",
      name: "Elena Voss",
      role: "Creative Director, Helix",
    },
  ];

  return (
    <section className="bg-black py-24 px-8 md:px-16">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col items-center gap-4 text-center mb-16">
          <span className="liquid-glass rounded-full px-3.5 py-1 text-xs font-medium text-white font-body">
            What They Say
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-heading italic tracking-tight leading-[0.9] text-white">
            Don't take our word for it.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {reviews.map((rev, i) => (
            <div key={i} className="liquid-glass rounded-2xl p-8 flex flex-col gap-6">
              <p className="text-white/80 font-body font-light text-sm italic leading-relaxed">
                "{rev.text}"
              </p>
              <div className="flex flex-col">
                <span className="text-white font-body font-medium text-sm">{rev.name}</span>
                <span className="text-white/50 font-body font-light text-xs">{rev.role}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaFooter({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="relative pt-32 pb-12 px-8 md:px-16 overflow-hidden min-h-[800px] flex flex-col">
      <HLSVideo
        src="https://stream.mux.com/8wrHPCX2dC3msyYU9ObwqNdm00u3ViXvOSHUMRYSEe5Q.m3u8"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div
        className="absolute top-0 left-0 right-0 h-[300px] z-1 pointer-events-none"
        style={{ background: 'linear-gradient(to top, transparent, black)' }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-[200px] z-1 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, black)' }}
      />

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center gap-8 max-w-4xl mx-auto">
        <h2 className="text-5xl md:text-6xl lg:text-8xl font-heading italic leading-[0.8] tracking-tight text-white mb-4">
          Your next cut <br className="hidden md:block" /> starts here.
        </h2>
        <p className="text-white/70 font-body font-light text-sm md:text-lg max-w-xl leading-relaxed">
          Drop a clip. Draw a region. Describe the change. The studio is free to try — no account, no watermark, no variant roulette.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={onEnter}
            className="liquid-glass-strong rounded-full px-8 py-4 text-white font-body text-base hover:scale-105 transition-transform flex items-center gap-2"
          >
            Open the Studio
            <ArrowUpRight className="h-4 w-4" />
          </button>
          <a
            href="https://github.com/stephenhungg/iris"
            target="_blank"
            rel="noreferrer"
            className="bg-white text-black rounded-full px-8 py-4 text-base font-medium hover:bg-white/90 transition-colors"
          >
            View Source
          </a>
        </div>
      </div>

      <div className="relative z-10 mt-auto pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
        <span className="text-white/40 text-xs font-body">
          &copy; 2026 iris. All rights reserved.
        </span>
        <div className="flex items-center gap-6">
          {["Privacy", "Terms", "Contact"].map((link) => (
            <a key={link} href="#" className="text-white/40 text-xs font-body hover:text-white transition-colors">
              {link}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- Main App ---

export default function App() {
  const [view, setView] = useState<'landing' | 'studio'>('landing');
  const enter = () => setView('studio');
  const exit = () => setView('landing');

  if (view === 'studio') {
    return <Studio onExit={exit} />;
  }

  return (
    <div className="bg-black min-h-screen">
      <div className="relative z-10">
        <Navbar onEnter={enter} />
        <Hero onEnter={enter} />
        <div className="bg-black">
          <StartSection onEnter={enter} />
          <FeaturesChess />
          <FeaturesGrid />
          <Stats />
          <Testimonials />
          <CtaFooter onEnter={enter} />
        </div>
      </div>
    </div>
  );
}
