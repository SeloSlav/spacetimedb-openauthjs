import { useState, useEffect, useRef } from "react";

import logoUrl from "../../assets/ui/logo_alt.png";

const QUOTE_CYCLE_MS = 2200; // Cycle folk wisdom every 2.2s so it changes before loading typically finishes
const PROGRESS_LERP = 0.12; // Smooth interpolation toward target progress per frame

const QUOTES = [
  "Promaja kills more people than war.",
  "If you don't eat bread with pasta, are you really eating?",
  "Rakija fixes everything, inside and out.",
  "A house without a guest is like a village without a dog.",
  "Don't sit on concrete, you will freeze your ovaries.",
  "Put slippers on, you will catch a cold from the floor.",
  "It is not the coffee that is expensive, it is the company.",
  "Better a grave than a slave.",
  "He who sings thinks no evil.",
  "Every village has its own customs.",
  "Work is not a wolf—it won't run away into the forest.",
  "The guest in the house, God in the house.",
  "The first pancake is always lumpy.",
  "Measure seven times, cut once.",
  "When the fish stinks, it stinks from the head.",
  "He who digs a pit for others falls into it himself.",
  "Empty stomach has no ears.",
  "God gives bread to those who have no teeth.",
  "Patience is the mother of all virtues.",
  "A man without a moustache is like a woman without a wreath.",
  "Who sleeps at noon doesn't sleep at night.",
  "God gives the coldest winter to the poorest bird.",
  "The nail that sticks out gets hammered.",
  "When the cat's away, the mice dance.",
  "A rich man is just a poor man with money.",
  "A closed mouth catches no flies.",
  "Don't sell the bear skin before you've caught the bear.",
];

interface LoadingScreenProps {
  progress: number;
  visible: boolean;
  onSkip?: () => void;
}

export function LoadingScreen({ progress, visible, onSkip }: LoadingScreenProps) {
  const [quoteIndex, setQuoteIndex] = useState(() =>
    Math.floor(Math.random() * QUOTES.length)
  );
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const [showSkip, setShowSkip] = useState(false);
  const progressRef = useRef(0);

  progressRef.current = progress;

  // Cycle folk wisdom every QUOTE_CYCLE_MS so it changes before loading finishes
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % QUOTES.length);
    }, QUOTE_CYCLE_MS);
    return () => clearInterval(interval);
  }, [visible]);

  // Smooth progress bar interpolation
  useEffect(() => {
    if (!visible) {
      setDisplayedProgress(0);
      return;
    }
    let rafId: number;
    const tick = () => {
      const target = progressRef.current;
      setDisplayedProgress((prev) => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.5) return target;
        return prev + diff * PROGRESS_LERP;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [visible]);

  useEffect(() => {
    if (!visible || !onSkip) return;
    const t = setTimeout(() => setShowSkip(true), 8000);
    return () => clearTimeout(t);
  }, [visible, onSkip]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#020205",
        color: "#fff",
        fontFamily: "sans-serif",
        transition: "opacity 0.5s ease-out",
      }}
    >
      <img
        src={logoUrl}
        alt="Selo Empire"
        style={{
          width: "min(600px, 70vw)",
          maxWidth: "600px",
          height: "auto",
          marginBottom: "clamp(20px, 4vh, 60px)",
          filter: "drop-shadow(0 0 20px rgba(0,0,0,0.8)) drop-shadow(0 0 40px rgba(255,255,255,0.2))",
        }}
      />

      <div
        style={{
          width: "300px",
          height: "4px",
          background: "#333",
          borderRadius: "2px",
          overflow: "hidden",
          marginBottom: "20px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${displayedProgress}%`,
            background: "linear-gradient(90deg, #ff8c00, #ffcc00)",
          }}
        />
      </div>

      <p
        style={{
          fontSize: "18px",
          fontStyle: "italic",
          textAlign: "center",
          maxWidth: "80%",
          opacity: 0.9,
          height: "24px", // Fixed height to prevent layout jump
        }}
      >
        "{QUOTES[quoteIndex]}"
      </p>

      {showSkip && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          style={{
            marginTop: "24px",
            padding: "10px 24px",
            background: "rgba(255, 140, 0, 0.2)",
            border: "2px solid rgba(255, 140, 0, 0.6)",
            borderRadius: "8px",
            color: "#ff8c00",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "sans-serif",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 140, 0, 0.35)";
            e.currentTarget.style.borderColor = "#ff8c00";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 140, 0, 0.2)";
            e.currentTarget.style.borderColor = "rgba(255, 140, 0, 0.6)";
          }}
        >
          Continue anyway
        </button>
      )}
    </div>
  );
}
