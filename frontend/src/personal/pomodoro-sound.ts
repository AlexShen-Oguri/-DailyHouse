// A finite, audible reminder: three pairs of rising notes over 4.55 seconds.
export function playPomodoroSound(context: AudioContext): () => void {
  const notes: { tone: OscillatorNode; disconnect: () => void }[] = [];
  const start = context.currentTime;
  for (let group = 0; group < 3; group++) for (const [index, frequency] of [880, 1174.66].entries()) {
    const at = start + group * 1.8 + index * .5;
    const tone = context.createOscillator(); const volume = context.createGain();
    let disconnected = false;
    const disconnect = () => {
      if (disconnected) return;
      disconnected = true; tone.disconnect(); volume.disconnect();
    };
    tone.type = 'sine'; tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0, at);
    volume.gain.linearRampToValueAtTime(.22, at + .025);
    volume.gain.setValueAtTime(.22, at + .18);
    volume.gain.exponentialRampToValueAtTime(.001, at + .42);
    tone.connect(volume); volume.connect(context.destination);
    tone.onended = disconnect;
    notes.push({ tone, disconnect });
    tone.start(at); tone.stop(at + .45);
  }
  return () => {
    for (const note of notes) {
      try { note.tone.stop(); } catch { /* Already ended. */ }
      note.disconnect();
    }
  };
}
