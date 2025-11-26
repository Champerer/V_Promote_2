import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import Avatar from './components/Avatar';
import ChatInterface from './components/ChatInterface';
import { Message, Role, AvatarState, AppMode } from './types';
import { BIAC_SYSTEM_INSTRUCTION, MODEL_TEXT_CHAT, MODEL_TTS, MODEL_LIVE } from './constants';
import { base64ToUint8Array, decodeAudioData, arrayBufferToBase64 } from './services/audioUtils';

const WELCOME_MSG = "สวัสดีค่ะ ยินดีต้อนรับสู่ตู้ประชาสัมพันธ์อัจฉริยะของวิทยาลัยการอาชีพพุทธมณฑล ท่านสามารถสอบถามข้อมูลหลักสูตร การสมัครเรียน กิจกรรม หรือข้อมูลทั่วไปของวิทยาลัยได้เลยค่ะ";

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.LANDING);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-init',
      role: Role.MODEL,
      text: WELCOME_MSG,
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [avatarState, setAvatarState] = useState<AvatarState>(AvatarState.IDLE);
  const [isConnected, setIsConnected] = useState(false); // For Live API
  const [error, setError] = useState<string | null>(null);

  // --- Refs for Audio & API ---
  const aiRef = useRef<GoogleGenAI | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<Promise<any> | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const inputProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Initialize GenAI
  useEffect(() => {
    if (process.env.API_KEY) {
      aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY });
    } else {
      setError("API Key not found in environment variables.");
    }
    
    // Cleanup function
    return () => {
       stopLiveSession();
       if (audioContextRef.current) {
         audioContextRef.current.close();
       }
    };
  }, []);

  // --- Helper: Play TTS or Live Audio ---
  const playAudio = async (base64Audio: string, rate: number = 24000) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: rate });
      }
      
      const ctx = audioContextRef.current;
      
      // Resume if suspended (browser policy)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const audioBytes = base64ToUint8Array(base64Audio);
      const audioBuffer = await decodeAudioData(audioBytes, ctx, rate);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      // Schedule playback (gapless for Live, immediate for TTS if possible)
      const now = ctx.currentTime;
      const startTime = Math.max(nextStartTimeRef.current, now);
      source.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;

      // Update Avatar State
      setAvatarState(AvatarState.SPEAKING);
      source.onended = () => {
        // Only set back to IDLE/LISTENING if no more audio is queued close by
        if (ctx.currentTime >= nextStartTimeRef.current - 0.1) {
           setAvatarState(mode === AppMode.LIVE_VOICE ? AvatarState.LISTENING : AvatarState.IDLE);
        }
      };

      audioSourceRef.current = source;
    } catch (err) {
      console.error("Audio playback error:", err);
    }
  };

  // --- TEXT CHAT & TTS HANDLERS ---
  const handleSendMessage = async () => {
    if (!input.trim() || !aiRef.current) return;
    
    const userMsg: Message = { id: uuidv4(), role: Role.USER, text: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setAvatarState(AvatarState.THINKING);

    try {
      // 1. Generate Text Response
      const response = await aiRef.current.models.generateContent({
        model: MODEL_TEXT_CHAT,
        contents: [
            { role: 'user', parts: [{ text: BIAC_SYSTEM_INSTRUCTION }] }, // Prepend system prompt to context for Chat
            ...messages.map(m => ({ role: m.role === Role.USER ? 'user' : 'model', parts: [{ text: m.text }] })),
            { role: 'user', parts: [{ text: input }] }
        ],
        config: { systemInstruction: BIAC_SYSTEM_INSTRUCTION }
      });

      const textResponse = response.text || "ขออภัยค่ะ ระบบขัดข้องชั่วคราว";
      
      const modelMsg: Message = { id: uuidv4(), role: Role.MODEL, text: textResponse, timestamp: new Date() };
      setMessages(prev => [...prev, modelMsg]);

      // 2. Generate Speech (TTS)
      const ttsResponse = await aiRef.current.models.generateContent({
        model: MODEL_TTS,
        contents: [{ parts: [{ text: textResponse }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      });

      const audioData = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      setAvatarState(AvatarState.IDLE); // Reset before speaking
      if (audioData) {
        // Reset timing for new utterance
        if (audioContextRef.current) {
            nextStartTimeRef.current = audioContextRef.current.currentTime;
        }
        await playAudio(audioData, 24000);
      }

    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { id: uuidv4(), role: Role.MODEL, text: "ขออภัย เกิดข้อผิดพลาดในการเชื่อมต่อ", timestamp: new Date() }]);
      setAvatarState(AvatarState.IDLE);
    } finally {
      setIsLoading(false);
    }
  };

  // --- LIVE API HANDLERS ---

  const startLiveSession = async () => {
    if (!aiRef.current) return;
    setIsConnected(true);
    setAvatarState(AvatarState.LISTENING);
    setError(null);

    try {
      // Initialize Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if(!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      inputProcessorRef.current = processor;

      // Connect to Live API
      const sessionPromise = aiRef.current.live.connect({
        model: MODEL_LIVE,
        config: {
          systemInstruction: BIAC_SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
             voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          }
        },
        callbacks: {
          onopen: () => {
            console.log("Live Session Opened");
            // Start streaming audio input
             processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                // Convert Float32 to Int16 PCM
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    pcmData[i] = inputData[i] * 32768;
                }
                
                const base64Data = arrayBufferToBase64(pcmData.buffer);
                
                sessionPromise.then(session => {
                    session.sendRealtimeInput({
                        media: {
                            mimeType: 'audio/pcm;rate=16000',
                            data: base64Data
                        }
                    });
                });
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: (msg: LiveServerMessage) => {
             // Handle Audio Output
             const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (audioData) {
                 playAudio(audioData, 24000);
             }

             // Handle Interruption
             if (msg.serverContent?.interrupted) {
                 if (audioSourceRef.current) {
                     audioSourceRef.current.stop();
                 }
                 if(audioContextRef.current) {
                     nextStartTimeRef.current = audioContextRef.current.currentTime;
                 }
                 setAvatarState(AvatarState.LISTENING);
             }
          },
          onclose: () => {
            console.log("Live Session Closed");
            setIsConnected(false);
            setAvatarState(AvatarState.IDLE);
          },
          onerror: (e) => {
            console.error("Live Session Error", e);
            setError("เกิดข้อผิดพลาดในการเชื่อมต่อ Live API");
            stopLiveSession();
          }
        }
      });

      liveSessionRef.current = sessionPromise;

    } catch (err) {
      console.error(err);
      setError("ไม่สามารถเข้าถึงไมโครโฟนได้ หรือการเชื่อมต่อล้มเหลว");
      setIsConnected(false);
    }
  };

  const stopLiveSession = () => {
    setIsConnected(false);
    setAvatarState(AvatarState.IDLE);
    
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
    if (inputProcessorRef.current) {
        inputProcessorRef.current.disconnect();
        inputProcessorRef.current = null;
    }
  };


  return (
    <div className="relative w-screen h-screen overflow-hidden font-sans bg-blue-50">
      
      {/* BACKGROUND LAYER: Avatar fills the screen */}
      <div className="absolute inset-0 z-0">
         <Avatar state={avatarState} />
      </div>

      {/* FOREGROUND LAYER: UI Overlays */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between">
        
        {/* Header (Minimal, Transparent) */}
        <header className="p-6 w-full flex justify-between items-start pointer-events-auto">
           <div className="flex items-center gap-3 bg-white/30 backdrop-blur-md p-2 pr-6 rounded-full border border-white/50 shadow-sm cursor-pointer hover:bg-white/40 transition-colors"
                onClick={() => setMode(AppMode.LANDING)}>
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-inner">
                B
              </div>
              <div className="text-slate-800">
                <h1 className="text-sm font-bold leading-tight">วิทยาลัยการอาชีพพุทธมณฑล</h1>
                <p className="text-[10px] text-slate-600">Smart Kiosk</p>
              </div>
           </div>

           {/* Return Home Button (Visible in Live/Chat modes) */}
           {mode !== AppMode.LANDING && (
              <button 
                onClick={() => {
                   stopLiveSession();
                   setMode(AppMode.LANDING);
                }}
                className="bg-white/30 backdrop-blur-md p-3 rounded-full text-slate-700 hover:bg-white/50 transition-colors border border-white/50 shadow-sm"
              >
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
           )}
        </header>

        {/* Status Indicator (Subtle floating text near top/center) */}
        {avatarState !== AvatarState.IDLE && (
            <div className="absolute top-24 left-1/2 transform -translate-x-1/2 pointer-events-none">
                <span className="bg-white/60 backdrop-blur-md px-4 py-1 rounded-full text-slate-700 text-sm font-medium border border-white/40 shadow-sm animate-pulse">
                    {avatarState === AvatarState.LISTENING ? 'กำลังฟัง...' : 
                     avatarState === AvatarState.THINKING ? 'กำลังคิด...' : 
                     avatarState === AvatarState.SPEAKING ? 'กำลังพูด...' : ''}
                </span>
            </div>
        )}

        {/* BOTTOM AREA: Content varies by mode */}
        <div className="w-full relative flex justify-center items-end pb-8 md:pb-12 pointer-events-auto px-4 min-h-[160px]">
            
            {/* LANDING MODE CONTROLS */}
            {mode === AppMode.LANDING && (
               <>
                  {/* Left Corner: Text Chat */}
                  <div className="absolute left-6 bottom-8 md:left-10 md:bottom-10 flex flex-col items-center gap-2 z-20 animate-in slide-in-from-left-10 duration-700">
                      <button 
                          onClick={() => setMode(AppMode.TEXT_CHAT)}
                          className="w-16 h-16 md:w-20 md:h-20 bg-white/90 hover:bg-blue-50 text-blue-600 rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 border border-blue-100 backdrop-blur-md group"
                      >
                          <svg className="w-8 h-8 md:w-9 md:h-9 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                      </button>
                      <span className="text-sm text-slate-600 font-medium bg-white/60 backdrop-blur-md px-3 py-1 rounded-full shadow-sm border border-white/40">พิมพ์แชท</span>
                  </div>

                  {/* Right Corner: Live Voice */}
                  <div className="absolute right-6 bottom-8 md:right-10 md:bottom-10 flex flex-col items-center gap-2 z-20 animate-in slide-in-from-right-10 duration-700">
                      <button 
                          onClick={() => setMode(AppMode.LIVE_VOICE)}
                          className="w-20 h-20 md:w-24 md:h-24 bg-gradient-to-br from-rose-400 to-rose-600 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-all duration-300 ring-4 ring-white/40 backdrop-blur-md group"
                      >
                          <svg className="w-9 h-9 md:w-11 md:h-11 group-hover:animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                      </button>
                      <span className="text-sm text-slate-600 font-medium bg-white/60 backdrop-blur-md px-3 py-1 rounded-full shadow-sm border border-white/40">คุยด้วยเสียง</span>
                  </div>
               </>
            )}

            {/* LIVE VOICE CONTROLS */}
            {mode === AppMode.LIVE_VOICE && (
               <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-8 duration-500 z-20">
                  <div className="text-center mb-2">
                      <p className="text-slate-700 font-medium bg-white/70 backdrop-blur-sm px-4 py-1 rounded-full shadow-sm text-sm border border-white/30">
                          {isConnected ? "กำลังสนทนา..." : "แตะเพื่อเริ่มพูดคุย"}
                      </p>
                  </div>
                  
                  {!isConnected ? (
                     <button 
                        onClick={startLiveSession}
                        className="w-20 h-20 bg-gradient-to-tr from-rose-500 to-red-600 rounded-full shadow-xl flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-all ring-4 ring-white/30"
                     >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                     </button>
                  ) : (
                     <button 
                        onClick={stopLiveSession}
                        className="w-20 h-20 bg-white text-red-600 rounded-full shadow-xl flex items-center justify-center hover:bg-slate-50 active:scale-95 transition-all border-4 border-red-50 ring-4 ring-red-100"
                     >
                         <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                     </button>
                  )}
               </div>
            )}

            {/* TEXT CHAT INTERFACE */}
            {mode === AppMode.TEXT_CHAT && (
               <div className="w-full max-w-2xl h-[55vh] md:h-[65vh] animate-in slide-in-from-bottom-20 duration-500 z-20">
                  <ChatInterface 
                     messages={messages}
                     input={input}
                     setInput={setInput}
                     onSend={handleSendMessage}
                     isLoading={isLoading}
                  />
               </div>
            )}

        </div>
      </div>

      {/* Error Toast */}
      {error && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-red-50/90 backdrop-blur border border-red-200 text-red-700 px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-3">
           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
           <span className="text-sm font-medium">{error}</span>
           <button onClick={() => setError(null)} className="ml-2 font-bold hover:text-red-900">✕</button>
        </div>
      )}
    </div>
  );
};

export default App;