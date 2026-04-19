import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ProgressData {
  completedSubmissions: Set<number>;
  completedProblems: Set<number>;
  completedAuthored: Set<number>;
  completedReviewed: Set<number>;
  completedCorrected: Set<number>;
  completedDataAdded: Set<number>;
  completedBoard: Set<number>;
  phase?: string;
}

interface ProgressJSON {
  completedSubmissions: number[];
  completedProblems: number[];
  completedAuthored: number[];
  completedReviewed: number[];
  completedCorrected: number[];
  completedDataAdded: number[];
  completedBoard: number[];
  phase?: string;
}

export class ProgressTracker {
  private readonly filePath: string;
  private data: ProgressData;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = {
      completedSubmissions: new Set(),
      completedProblems: new Set(),
      completedAuthored: new Set(),
      completedReviewed: new Set(),
      completedCorrected: new Set(),
      completedDataAdded: new Set(),
      completedBoard: new Set(),
    };
  }

  get progress(): ProgressData {
    return this.data;
  }

  get phase(): string | undefined {
    return this.data.phase;
  }

  set phase(phase: string | undefined) {
    this.data.phase = phase;
  }

  isCompleted(category: string, id: number): boolean {
    const set = this.getSet(category);
    return set.has(id);
  }

  markCompleted(category: string, id: number): void {
    const set = this.getSet(category);
    set.add(id);
  }

  async save(): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const json: ProgressJSON = {
      completedSubmissions: [...this.data.completedSubmissions],
      completedProblems: [...this.data.completedProblems],
      completedAuthored: [...this.data.completedAuthored],
      completedReviewed: [...this.data.completedReviewed],
      completedCorrected: [...this.data.completedCorrected],
      completedDataAdded: [...this.data.completedDataAdded],
      completedBoard: [...this.data.completedBoard],
      phase: this.data.phase,
    };

    const tmp = this.filePath + '.tmp';
    await writeFile(tmp, JSON.stringify(json, null, 2), 'utf-8');
    await rename(tmp, this.filePath);
  }

  async load(): Promise<void> {
    let raw: string;

    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch {
      // File doesn't exist yet — start fresh
      return;
    }

    const json: ProgressJSON = JSON.parse(raw);

    this.data = {
      completedSubmissions: new Set(json.completedSubmissions ?? []),
      completedProblems: new Set(json.completedProblems ?? []),
      completedAuthored: new Set(json.completedAuthored ?? []),
      completedReviewed: new Set(json.completedReviewed ?? []),
      completedCorrected: new Set(json.completedCorrected ?? []),
      completedDataAdded: new Set(json.completedDataAdded ?? []),
      completedBoard: new Set(json.completedBoard ?? []),
      phase: json.phase,
    };
  }

  private getSet(category: string): Set<number> {
    switch (category) {
      case 'submissions':
        return this.data.completedSubmissions;
      case 'problems':
        return this.data.completedProblems;
      case 'authored':
        return this.data.completedAuthored;
      case 'reviewed':
        return this.data.completedReviewed;
      case 'corrected':
        return this.data.completedCorrected;
      case 'dataadded':
        return this.data.completedDataAdded;
      case 'board':
        return this.data.completedBoard;
      default:
        throw new Error(`Unknown progress category: ${category}`);
    }
  }
}
