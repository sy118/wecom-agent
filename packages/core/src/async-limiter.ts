export class AsyncLimiter {
  private active = 0
  private waiting: Array<() => void> = []
  private readonly maxConcurrent: number

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent))
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  get activeCount(): number {
    return this.active
  }

  get pendingCount(): number {
    return this.waiting.length
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.waiting.shift()
    if (next) next()
  }
}
