export enum Role {
  USER = 'user',
  MODEL = 'model',
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  timestamp: Date;
}

export enum AvatarState {
  IDLE = 'idle',
  LISTENING = 'listening',
  THINKING = 'thinking',
  SPEAKING = 'speaking',
}

export enum AppMode {
  LANDING = 'landing',
  TEXT_CHAT = 'text_chat',
  LIVE_VOICE = 'live_voice',
}