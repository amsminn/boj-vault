export interface RateLimiterOptions {
  baseDelay?: number;
  jitter?: number;
  paginationDelay?: number;
}

export class RateLimiter {
  private readonly baseDelay: number;
  private readonly jitter: number;
  private readonly paginationDelay: number;

  constructor(options: RateLimiterOptions = {}) {
    this.baseDelay = options.baseDelay ?? 4000;
    this.jitter = options.jitter ?? 1000;
    this.paginationDelay = options.paginationDelay ?? 6500;
  }

  async wait(): Promise<void> {
    const delay = this.baseDelay + this.randomJitter();
    await this.sleep(delay);
  }

  async waitPagination(): Promise<void> {
    const delay = this.paginationDelay + this.randomJitter();
    await this.sleep(delay);
  }

  async backoff(attempt: number): Promise<void> {
    const delay = Math.min(this.baseDelay * Math.pow(2, attempt), 300_000);
    await this.sleep(delay);
  }

  private randomJitter(): number {
    return (Math.random() * 2 - 1) * this.jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
