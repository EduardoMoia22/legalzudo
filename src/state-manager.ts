import fs from "node:fs/promises";
import path from "node:path";

export interface PublishedRecord {
  filename: string;
  containerId: string;
  postId: string;
  caption: string;
  publishedAt: string;
}

export interface FailedRecord {
  filename: string;
  error: string;
  metaError?: unknown;
  failedAt: string;
}

export interface AppState {
  published: PublishedRecord[];
  failed: FailedRecord[];
  dailyCounters: Record<string, number>;
  lastRun: string | null;
}

const initialState: AppState = {
  published: [],
  failed: [],
  dailyCounters: {},
  lastRun: null
};

export class StateManager {
  constructor(private readonly stateFile: string) {}

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    try {
      await fs.access(this.stateFile);
    } catch {
      await this.write(initialState);
    }
  }

  async read(): Promise<AppState> {
    await this.init();
    const raw = await fs.readFile(this.stateFile, "utf8");
    return { ...initialState, ...JSON.parse(raw) } as AppState;
  }

  async write(state: AppState): Promise<void> {
    const tmpFile = `${this.stateFile}.tmp`;
    await fs.writeFile(tmpFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tmpFile, this.stateFile);
  }

  async update(mutator: (state: AppState) => void): Promise<AppState> {
    const state = await this.read();
    mutator(state);
    state.lastRun = new Date().toISOString();
    await this.write(state);
    return state;
  }

  async isAlreadyHandled(filename: string): Promise<boolean> {
    const state = await this.read();
    return (
      state.published.some((record) => record.filename === filename) ||
      state.failed.some((record) => record.filename === filename)
    );
  }

  async getDailyCount(dateKey: string): Promise<number> {
    const state = await this.read();
    return state.dailyCounters[dateKey] ?? 0;
  }

  async addPublished(record: PublishedRecord): Promise<void> {
    await this.update((state) => {
      state.published.push(record);
      const dateKey = record.publishedAt.slice(0, 10);
      state.dailyCounters[dateKey] = (state.dailyCounters[dateKey] ?? 0) + 1;
    });
  }

  async addFailed(record: FailedRecord): Promise<void> {
    await this.update((state) => {
      state.failed.push(record);
    });
  }
}
