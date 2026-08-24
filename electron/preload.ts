import { ipcRenderer, contextBridge } from 'electron'
import {
  IPC_CHANNELS,
  MAIN_RENDERER_INVOKE_CHANNELS,
  MAIN_RENDERER_RECEIVE_CHANNELS,
  MAIN_RENDERER_SEND_CHANNELS,
} from "../shared/ipc-channels";

// Map renderer listener → wrapper that strips IpcRendererEvent, so off() can detach.
const receiveListenerWrappers = new WeakMap<
  (...args: any[]) => void,
  (event: Electron.IpcRendererEvent, ...args: any[]) => void
>();

// Expose API to the Renderer process (main window)
contextBridge.exposeInMainWorld('ipcRenderer', {
  on: (channel: string, func: (...args: any[]) => void) => {
    if ((MAIN_RENDERER_RECEIVE_CHANNELS as readonly string[]).includes(channel)) {
      const wrapper = (_event: Electron.IpcRendererEvent, ...args: any[]) =>
        func(...args);
      receiveListenerWrappers.set(func, wrapper);
      ipcRenderer.on(channel, wrapper);
    }
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, listener] = args
    if (typeof listener === "function") {
      const wrapper = receiveListenerWrappers.get(listener)
      if (wrapper) {
        receiveListenerWrappers.delete(listener)
        return ipcRenderer.off(channel, wrapper)
      }
    }
    return ipcRenderer.off(channel, listener)
  },
  send: (channel: string, ...args: any[]) => {
    if ((MAIN_RENDERER_SEND_CHANNELS as readonly string[]).includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    if ((MAIN_RENDERER_INVOKE_CHANNELS as readonly string[]).includes(channel)) {
      return ipcRenderer.invoke(channel, ...omit)
    }
  },
})

// Expose API to popup windows with proper security
contextBridge.exposeInMainWorld('popupAPI', {
  // For blink popups
  onUpdateColors: (callback: (colors: any) => void) => {
    ipcRenderer.on(IPC_CHANNELS.updateColors, (_event, colors) => callback(colors));
  },
  onUpdateMessage: (callback: (message: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.updateMessage, (_event, message) => callback(message));
  },
  onCameraMode: (callback: (isEnabled: boolean) => void) => {
    ipcRenderer.on(IPC_CHANNELS.cameraMode, (_event, isEnabled) => callback(isEnabled));
  },
  onBlinkClickThrough: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on(IPC_CHANNELS.blinkClickThrough, (_event, enabled) => callback(enabled));
  },
  
  // For sound player (file MP3 or procedural cheer)
  onPlaySound: (callback: (payload: {
    kind: string;
    volume: number;
    path?: string;
    mode?: "file" | "cheer";
  }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.playSound, (_event, payload) => callback(payload));
  },
  onStopSound: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.stopSound, () => callback());
  },
  notifyAudioFinished: () => {
    ipcRenderer.send(IPC_CHANNELS.audioFinished);
  },
  notifyAudioError: (payload: {
    kind?: string;
    reason: string;
    message?: string;
    contextState?: string;
  }) => {
    ipcRenderer.send(IPC_CHANNELS.audioError, payload);
  },
  notifyAudioOutputInvalidated: () => {
    ipcRenderer.send(IPC_CHANNELS.audioOutputInvalidated);
  },
  
  // For camera window
  onFaceTrackingData: (callback: (data: any) => void) => {
    ipcRenderer.on(IPC_CHANNELS.faceTrackingData, (_event, data) => callback(data));
  },
  onBlinkDetected: (callback: (blinkData: any) => void) => {
    ipcRenderer.on(IPC_CHANNELS.blinkDetected, (_event, blinkData) => callback(blinkData));
  },
  onVideoStream: (callback: (streamData: string | Record<string, unknown>) => void) => {
    ipcRenderer.on(IPC_CHANNELS.videoStream, (_event, streamData) => callback(streamData));
  },
  onThresholdUpdated: (callback: (threshold: number) => void) => {
    ipcRenderer.on(IPC_CHANNELS.thresholdUpdated, (_event, threshold) => callback(threshold));
  },
  requestVideoStream: () => {
    ipcRenderer.send(IPC_CHANNELS.requestVideoStream);
  },
  
  // For exercise popups
  onUpdateExercisePrompt: (callback: (prompt: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.updateExercisePrompt, (_event, prompt) => callback(prompt));
  },
  onApplyI18n: (callback: (payload: { locale: string; messages: Record<string, string> }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.applyI18n, (_event, payload) => callback(payload));
  },
  skipExercise: () => {
    ipcRenderer.send(IPC_CHANNELS.skipExercise);
  },
  snoozeExercise: () => {
    ipcRenderer.send(IPC_CHANNELS.snoozeExercise);
  },

  // For look-away / 20-20-20 popups
  onUpdateLookAwayCopy: (callback: (copy: { title: string; hint: string }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.updateLookAwayCopy, (_event, copy) => callback(copy));
  },
  skipLookAway: () => {
    ipcRenderer.send(IPC_CHANNELS.skipLookAway);
  },
  snoozeLookAway: () => {
    ipcRenderer.send(IPC_CHANNELS.snoozeLookAway);
  },

  // For blink reminder popups
  snoozeBlink: () => {
    ipcRenderer.send(IPC_CHANNELS.snoozeBlink);
  },
  
  // For popup editor
  onPopupEditorUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on(IPC_CHANNELS.updateColors, (_event, colors) => callback({ type: 'colors', data: colors }));
    ipcRenderer.on(IPC_CHANNELS.currentPopupState, (_event, state) => callback({ type: 'state', data: state }));
  },
  savePopupEditor: (data: any) => {
    ipcRenderer.send(IPC_CHANNELS.popupEditorSaved, data);
  },
})

// Type definitions for TypeScript
declare global {
  interface Window {
    popupAPI: {
      onUpdateColors: (callback: (colors: any) => void) => void;
      onUpdateMessage: (callback: (message: string) => void) => void;
      onCameraMode: (callback: (isEnabled: boolean) => void) => void;
      onBlinkClickThrough: (callback: (enabled: boolean) => void) => void;
      onPlaySound: (callback: (payload: {
        kind: string;
        volume: number;
        path?: string;
        mode?: "file" | "cheer";
      }) => void) => void;
      onStopSound: (callback: () => void) => void;
      notifyAudioFinished: () => void;
      notifyAudioError: (payload: {
        kind?: string;
        reason: string;
        message?: string;
        contextState?: string;
      }) => void;
      notifyAudioOutputInvalidated: () => void;
      onFaceTrackingData: (callback: (data: any) => void) => void;
      onBlinkDetected: (callback: (blinkData: any) => void) => void;
      onVideoStream: (callback: (streamData: string | Record<string, unknown>) => void) => void;
      onThresholdUpdated: (callback: (threshold: number) => void) => void;
      requestVideoStream: () => void;
      onUpdateExercisePrompt: (callback: (prompt: string) => void) => void;
      onUpdateLookAwayCopy: (callback: (copy: { title: string; hint: string }) => void) => void;
      onApplyI18n: (callback: (payload: { locale: string; messages: Record<string, string> }) => void) => void;
      skipExercise: () => void;
      snoozeExercise: () => void;
      skipLookAway: () => void;
      snoozeLookAway: () => void;
      snoozeBlink: () => void;
      onPopupEditorUpdate: (callback: (data: any) => void) => void;
      savePopupEditor: (data: any) => void;
    };
  }
}
