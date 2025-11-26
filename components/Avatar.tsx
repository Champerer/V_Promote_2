import React, { useEffect, useState } from 'react';
import { AvatarState } from '../types';

interface AvatarProps {
  state: AvatarState;
}

const Avatar: React.FC<AvatarProps> = ({ state }) => {
  const [blink, setBlink] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0); // 0 to 1
  const [eyebrowLift, setEyebrowLift] = useState(0);

  // Blinking Logic
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 200);
    }, 4000 + Math.random() * 2000); // Random blink every 4-6s

    return () => clearInterval(blinkInterval);
  }, []);

  // Animation Loop (Mouth & Eyebrows)
  useEffect(() => {
    let animationFrameId: number;
    let time = 0;

    const animate = () => {
      // Mouth Logic
      if (state === AvatarState.SPEAKING) {
        time += 0.2;
        const value = (Math.sin(time) + Math.sin(time * 1.5) * 0.5 + 1.5) / 3; 
        setMouthOpen(0.1 + value * 0.6); 
      } else if (state === AvatarState.LISTENING) {
        time += 0.1; 
        const value = (Math.sin(time) + 1) / 2; 
        setMouthOpen(0.1 + value * 0.15); 
      } else {
        setMouthOpen(0.1); 
      }

      // Eyebrow Logic
      if (state === AvatarState.LISTENING) {
        setEyebrowLift(15); // Raise eyebrows when listening
      } else if (state === AvatarState.THINKING) {
        setEyebrowLift(Math.sin(time * 2) * 5 + 5); // Slight furrow/movement
      } else if (state === AvatarState.SPEAKING) {
        setEyebrowLift(Math.sin(time) * 4 + 2); // Expressive movement
      } else {
        setEyebrowLift(0);
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    if (state !== AvatarState.IDLE) {
      animate();
    } else {
      setMouthOpen(0.1);
      setEyebrowLift(0);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [state]);

  const getEyeScaleY = () => {
    if (blink) return 0.1;
    if (state === AvatarState.LISTENING) return 1.1; 
    return 1;
  };

  return (
    <div className="w-full h-full relative overflow-hidden flex items-center justify-center bg-slate-50">
      
      {/* Background Skin (Gradient) */}
      <div className="absolute inset-0 bg-gradient-to-b from-blue-50 via-blue-100 to-indigo-100 animate-gradient"></div>

      {/* Face SVG */}
      <svg 
        viewBox="0 0 200 200" 
        className="w-full h-full max-w-[100vmin] max-h-[100vmin] relative z-10 drop-shadow-xl"
        preserveAspectRatio="xMidYMid meet"
      >
         {/* Brows Group */}
         <g transform={`translate(0, ${-eyebrowLift})`} style={{ transition: 'transform 0.2s ease-out' }}>
            {/* Left Eyebrow */}
            <path 
              d="M 40 55 Q 55 45 70 55" 
              fill="none" 
              stroke="#334155" 
              strokeWidth="6" 
              strokeLinecap="round" 
              className="opacity-80"
            />
            {/* Right Eyebrow */}
            <path 
              d="M 130 55 Q 145 45 160 55" 
              fill="none" 
              stroke="#334155" 
              strokeWidth="6" 
              strokeLinecap="round" 
              className="opacity-80"
            />
         </g>

         {/* Eyes Group */}
         <g transform={`scale(1, ${getEyeScaleY()})`} style={{ transformOrigin: 'center 90px', transition: 'transform 0.1s cubic-bezier(0.4, 0, 0.2, 1)' }}>
            
            {/* Left Eye */}
            <g transform="translate(55, 90)">
              <ellipse cx="0" cy="0" rx="24" ry="30" fill="#334155" /> {/* Dark Outline */}
              <ellipse cx="0" cy="0" rx="22" ry="28" fill="#1E293B" /> {/* Dark Iris Base */}
              <circle cx="0" cy="-6" r="12" fill="#60A5FA" opacity="0.9" /> {/* Blue Iris */}
              <circle cx="8" cy="-10" r="7" fill="white" opacity="0.95" /> {/* Big Shine */}
              <circle cx="-6" cy="12" r="4" fill="white" opacity="0.4" /> {/* Bottom Reflection */}
            </g>

            {/* Right Eye */}
            <g transform="translate(145, 90)">
              <ellipse cx="0" cy="0" rx="24" ry="30" fill="#334155" />
              <ellipse cx="0" cy="0" rx="22" ry="28" fill="#1E293B" />
              <circle cx="0" cy="-6" r="12" fill="#60A5FA" opacity="0.9" />
              <circle cx="8" cy="-10" r="7" fill="white" opacity="0.95" />
              <circle cx="-6" cy="12" r="4" fill="white" opacity="0.4" />
            </g>
         </g>

         {/* Cheeks (Blush) */}
         <ellipse cx="35" cy="130" rx="14" ry="9" fill="#F472B6" opacity="0.3" filter="blur(6px)" />
         <ellipse cx="165" cy="130" rx="14" ry="9" fill="#F472B6" opacity="0.3" filter="blur(6px)" />

         {/* Mouth */}
         <g transform="translate(100, 150)">
           {/* Main Mouth Shape */}
           <path
             d={`M -25 ${mouthOpen * 5} 
                 Q 0 ${mouthOpen * 60} 
                 25 ${mouthOpen * 5}
                 Q 0 ${mouthOpen * 20} -25 ${mouthOpen * 5} Z`}
             fill="#991B1B" 
             stroke={mouthOpen > 0.1 ? "none" : "#334155"}
             strokeWidth={mouthOpen > 0.1 ? "0" : "5"}
             strokeLinecap="round"
             style={{ transition: 'd 0.1s' }}
           />
           
           {/* Tongue */}
           <path 
             d={`M -15 ${mouthOpen * 40} Q 0 ${mouthOpen * 55} 15 ${mouthOpen * 40}`}
             fill="#F87171"
             opacity={mouthOpen > 0.3 ? 1 : 0}
             style={{ transition: 'opacity 0.1s' }}
           />
         </g>
      </svg>

      {/* Subtle Screen Gloss Overlay */}
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/20 pointer-events-none z-20"></div>

    </div>
  );
};

export default Avatar;