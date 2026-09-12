import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock AudioContext and its methods
const mockStop = vi.fn();
const mockStart = vi.fn();
const mockConnect = vi.fn();
const mockOscillator = {
  type: "sine",
  frequency: { setValueAtTime: vi.fn() },
  connect: mockConnect,
  start: mockStart,
  stop: mockStop,
};
const mockGain = {
  gain: {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn(),
};
const mockAudioContext = {
  currentTime: 0,
  state: "running",
  resume: vi.fn(),
  destination: {},
  createOscillator: vi.fn(() => ({ ...mockOscillator })),
  createGain: vi.fn(() => ({ ...mockGain })),
};

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value;
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {};
  }),
};

// AudioContext must be constructible with `new`. Vitest 4 no longer wraps
// arrow-fn implementations into constructible mocks, so `vi.fn(() => x)` breaks
// `new AudioContext()` with "is not a constructor" — hence a real function.
function MockAudioContext(this: unknown) {
  return mockAudioContext;
}

// Stubbed before the module under test is imported.
vi.stubGlobal("localStorage", localStorageMock);
vi.stubGlobal("AudioContext", MockAudioContext);
vi.stubGlobal("window", {
  AudioContext: MockAudioContext,
});

describe("soundForMove", () => {
  it("picks the plain move sound for a quiet move", async () => {
    const { soundForMove } = await import("./soundEngine");
    expect(soundForMove("e4")).toBe("move");
    expect(soundForMove("Nf3")).toBe("move");
    expect(soundForMove("O-O")).toBe("move");
  });

  it("picks the capture sound for a capture", async () => {
    const { soundForMove } = await import("./soundEngine");
    expect(soundForMove("Bxc6")).toBe("capture");
    expect(soundForMove("exd5")).toBe("capture");
  });

  it("picks the check sound for a check or a mate", async () => {
    const { soundForMove } = await import("./soundEngine");
    expect(soundForMove("Qh5+")).toBe("check");
    expect(soundForMove("Qxf7#")).toBe("check");
  });

  it("prefers the check sound when a move both captures and checks", async () => {
    const { soundForMove } = await import("./soundEngine");
    expect(soundForMove("Qxh7+")).toBe("check");
  });

  it("falls back to the move sound when SAN is missing", async () => {
    const { soundForMove } = await import("./soundEngine");
    expect(soundForMove("")).toBe("move");
  });
});

describe("SoundEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    // Reset AudioContext mock state
    mockAudioContext.state = "running";
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("constructor", () => {
    it("initializes unmuted by default when no saved preference", async () => {
      const { sounds } = await import("./soundEngine.js");
      expect(sounds.getMuted()).toBe(false);
    });

    it("initializes muted when saved preference is true", async () => {
      localStorageMock.store["tc_muted"] = "true";
      const { sounds } = await import("./soundEngine.js");
      expect(sounds.getMuted()).toBe(true);
    });

    it("initializes unmuted when saved preference is false", async () => {
      localStorageMock.store["tc_muted"] = "false";
      const { sounds } = await import("./soundEngine.js");
      expect(sounds.getMuted()).toBe(false);
    });
  });

  describe("setMuted", () => {
    it("sets muted state to true", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.setMuted(true);
      expect(sounds.getMuted()).toBe(true);
    });

    it("sets muted state to false", async () => {
      localStorageMock.store["tc_muted"] = "true";
      const { sounds } = await import("./soundEngine.js");
      sounds.setMuted(false);
      expect(sounds.getMuted()).toBe(false);
    });

    it("persists muted state to localStorage", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.setMuted(true);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("tc_muted", "true");
    });
  });

  describe("getMuted", () => {
    it("returns current muted state", async () => {
      const { sounds } = await import("./soundEngine.js");
      expect(sounds.getMuted()).toBe(false);
      sounds.setMuted(true);
      expect(sounds.getMuted()).toBe(true);
    });
  });

  describe("play", () => {
    it("does not play sound when muted", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.setMuted(true);
      sounds.play("move");
      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });

    it("creates audio context and plays move sound", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.play("move");
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
      expect(mockAudioContext.createGain).toHaveBeenCalled();
    });

    it("creates audio context and plays capture sound", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.play("capture");
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it("creates audio context and plays check sound", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.play("check");
      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it("creates multiple oscillators for start sound (chord)", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.play("start");
      // Start sound plays a chord with 3 notes
      expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(3);
    });

    it("creates multiple oscillators for end sound (chord)", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.play("end");
      // End sound plays a chord with 3 notes
      expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(3);
    });

    it("creates 4 oscillators for reset sound", async () => {
      const { sounds } = await import("./soundEngine.js");
      sounds.play("reset");
      expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(4);
    });

    it("resumes audio context when suspended", async () => {
      mockAudioContext.state = "suspended";
      const { sounds } = await import("./soundEngine.js");
      sounds.play("move");
      expect(mockAudioContext.resume).toHaveBeenCalled();
    });
  });
});
