type SoundType = "move" | "capture" | "check" | "lowtime" | "start" | "end";

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  constructor() {
    const saved = localStorage.getItem("tc_muted");
    this.isMuted = saved === "true";
  }

  private getContext(): AudioContext {
    if (!this.ctx) {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    localStorage.setItem("tc_muted", String(muted));
  }

  public getMuted() {
    return this.isMuted;
  }

  public play(type: SoundType) {
    if (this.isMuted) return;

    const ctx = this.getContext();
    const t = ctx.currentTime;

    // --- "SOFT" GLASS THEME ---
    if (type === "move") {
      this.tone(t, 300, "sine", 0.1, 0.3);
    } else if (type === "capture") {
      this.tone(t, 500, "sine", 0.1, 0.3);
    } else if (type === "check") {
      this.tone(t, 400, "triangle", 0.2, 0.2);
    } else if (type === "lowtime") {
      this.tone(t, 800, "sine", 0.05, 0.1);
    } else if (type === "start") {
      // Gentle ascending chord
      this.chord(t, [300, 400, 500], "sine", 0.8);
    } else if (type === "end") {
      // Descending chord
      this.chord(t, [500, 400, 300], "sine", 1.2);
    }
  }

  private tone(
    t: number,
    freq: number,
    type: OscillatorType,
    dur: number,
    vol: number
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private chord(t: number, freqs: number[], type: OscillatorType, dur: number) {
    freqs.forEach((f, i) => {
      this.tone(t + i * 0.05, f, type, dur, 0.1);
    });
  }
}

export const sounds = new SoundEngine();
