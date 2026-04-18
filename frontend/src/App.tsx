/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, useScroll, useTransform } from 'motion/react';
import { 
  ArrowUpRight, 
  Play, 
  Zap, 
  Palette, 
  BarChart3, 
  Shield 
} from 'lucide-react';
import { useRef } from 'react';
import { BlurText } from './components/BlurText';
import { HLSVideo } from './components/HLSVideo';

// --- Components ---

function Navbar() {
  return (
    <nav className="fixed top-4 left-0 right-0 z-50 px-8 lg:px-16 py-3">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          {/* Logo Placeholder - Usually would be an img but I'll use a styled div if asset missing, 
              but the prompt says src/assets/logo-icon.png exists. 
              I'll assume it exists or use a placeholder if it fails. 
          */}
          <img 
            src="https://picsum.photos/seed/iris-logo/48/48" 
            alt="Iris Logo" 
            className="h-12 w-12 object-contain"
            referrerPolicy="no-referrer"
          />
        </div>

        <div className="hidden md:flex items-center gap-1 liquid-glass rounded-full px-1.5 py-1">
          {["Home", "Services", "Work", "Process", "Pricing"].map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase()}`}
              className="px-3 py-2 text-sm font-medium text-foreground/90 font-body hover:text-white transition-colors"
            >
              {link}
            </a>
          ))}
        </div>

        <button className="flex items-center gap-1.5 bg-white text-black rounded-full px-3.5 py-1.5 text-sm font-medium hover:bg-white/90 transition-colors">
          Get Started
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

function Hero() {
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
        <source src="https://d8j0ntlcm91z4.cloudfront.net/user_3CXxQfd4lyRSHbXTz8mFo8jo75k/hf_20260418_215523_d6bd5c6e-30bb-48b9-a74a-952658f9f97a.mp4" type="video/mp4" />
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
          <span className="text-xs text-white/90 font-body pr-3">Introducing AI-powered video editing.</span>
        </motion.div>

        <BlurText
          text="The Website Your Brand Deserves"
          className="text-6xl md:text-7xl lg:text-[5.5rem] font-heading italic text-foreground leading-[0.8] max-w-4xl tracking-[-4px] mb-8"
          delay={100}
        />

        <motion.p
          initial={{ filter: 'blur(10px)', opacity: 0, y: 20 }}
          animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="text-sm md:text-lg text-white font-body font-light leading-tight max-w-md mb-10"
        >
          Stunning design. Blazing performance. Built by AI, refined by experts. This is web design, wildly reimagined.
        </motion.p>

        <motion.div
          initial={{ filter: 'blur(10px)', opacity: 0, y: 20 }}
          animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-6"
        >
          <button className="liquid-glass-strong rounded-full px-5 py-2.5 flex items-center gap-2 text-white font-body hover:scale-105 transition-transform">
            Get Started
            <ArrowUpRight className="h-4 w-4" />
          </button>
          <button className="flex items-center gap-2 text-white font-body group hover:text-white/80 transition-colors">
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-white text-black">
              <Play className="h-3 w-3 fill-current" />
            </span>
            Watch the Film
          </button>
        </motion.div>

        <div className="mt-auto pb-8 pt-16 w-full flex flex-col items-center gap-8">
          <div className="liquid-glass rounded-full px-4 py-2 text-xs text-white/60 font-body">
            Trusted by the teams behind
          </div>
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-16 opacity-50">
            {["Stripe", "Vercel", "Linear", "Notion", "Figma"].map((brand) => (
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

function StartSection() {
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
          You dream it. We ship it.
        </h2>
        <p className="text-white/60 font-body font-light text-sm md:text-base max-w-xl">
          Share your vision. Our AI handles the rest—wireframes, design, code, launch. All in days, not quarters.
        </p>
        <button className="liquid-glass-strong rounded-full px-6 py-3 text-white font-body hover:scale-105 transition-transform mt-4">
          Get Started
        </button>
      </div>
    </section>
  );
}

function FeaturesChess() {
  const rows = [
    {
      title: "Designed to convert. Built to perform.",
      body: "Every pixel is intentional. Our AI studies what works across thousands of top sites—then builds yours to outperform them all.",
      button: "Learn more",
      gif: "https://motionsites.ai/assets/hero-finlytic-preview-CV9g0FHP.gif",
      reverse: false
    },
    {
      title: "It gets smarter. Automatically.",
      body: "Your site evolves on its own. AI monitors every click, scroll, and conversion—then optimizes in real time. No manual updates. Ever.",
      button: "See how it works",
      gif: "https://motionsites.ai/assets/hero-wealth-preview-B70idl_u.gif",
      reverse: true
    }
  ];

  return (
    <section className="bg-black py-24 px-8 md:px-16">
      <div className="max-w-7xl mx-auto flex flex-col gap-32">
        <div className="flex flex-col items-center gap-4 text-center mb-16">
          <span className="liquid-glass rounded-full px-3.5 py-1 text-xs font-medium text-white font-body">
            Capabilities
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-heading italic tracking-tight leading-[0.9] text-white">
            Pro features. Zero complexity.
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
      title: "Days, Not Months",
      description: "Concept to launch at a pace that redefines fast. Because waiting isn't a strategy."
    },
    {
      icon: <Palette className="h-5 w-5" />,
      title: "Obsessively Crafted",
      description: "Every detail considered. Every element refined. Design so precise, it feels inevitable."
    },
    {
      icon: <BarChart3 className="h-5 w-5" />,
      title: "Built to Convert",
      description: "Layouts informed by data. Decisions backed by performance. Results you can measure."
    },
    {
      icon: <Shield className="h-5 w-5" />,
      title: "Secure by Default",
      description: "Enterprise-grade protection comes standard. SSL, DDoS mitigation, compliance. All included."
    }
  ];

  return (
    <section className="bg-black py-24 px-8 md:px-16">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col items-center gap-4 text-center mb-16">
          <span className="liquid-glass rounded-full px-3.5 py-1 text-xs font-medium text-white font-body">
            Why Us
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
    { label: "Sites launched", value: "200+" },
    { label: "Client satisfaction", value: "98%" },
    { label: "More conversions", value: "3.2x" },
    { label: "Average delivery", value: "5 days" }
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
      text: "A complete rebuild in five days. The result outperformed everything we'd spent months building before.",
      name: "Sarah Chen",
      role: "CEO, Luminary"
    },
    {
      text: "Conversions up 4x. That's not a typo. The design just works differently when it's built on real data.",
      name: "Marcus Webb",
      role: "Head of Growth, Arcline"
    },
    {
      text: "They didn't just design our site. They defined our brand. World-class doesn't begin to cover it.",
      name: "Elena Voss",
      role: "Brand Director, Helix"
    }
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

function CtaFooter() {
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
          Your next website <br className="hidden md:block" /> starts here.
        </h2>
        <p className="text-white/70 font-body font-light text-sm md:text-lg max-w-xl leading-relaxed">
          Book a free strategy call. See what AI-powered design can do. No commitment, no pressure. Just possibilities.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button className="liquid-glass-strong rounded-full px-8 py-4 text-white font-body text-base hover:scale-105 transition-transform flex items-center gap-2">
            Book a Call
            <ArrowUpRight className="h-4 w-4" />
          </button>
          <button className="bg-white text-black rounded-full px-8 py-4 text-base font-medium hover:bg-white/90 transition-colors">
            View Pricing
          </button>
        </div>
      </div>

      <div className="relative z-10 mt-auto pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
        <span className="text-white/40 text-xs font-body">
          &copy; 2026 Studio. All rights reserved.
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
  return (
    <div className="bg-black min-h-screen">
      <div className="relative z-10">
        <Navbar />
        <Hero />
        <div className="bg-black">
          <StartSection />
          <FeaturesChess />
          <FeaturesGrid />
          <Stats />
          <Testimonials />
          <CtaFooter />
        </div>
      </div>
    </div>
  );
}
