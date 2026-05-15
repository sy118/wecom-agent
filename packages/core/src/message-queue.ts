/** Serial task queue per chatKey — borrowed from Kite */
export class MessageQueue {
  private queue: Array<() => Promise<void>> = []
  private running = false

  enqueue(task: () => Promise<void>): void {
    this.queue.push(task)
    if (!this.running) this.drain()
  }

  private async drain(): Promise<void> {
    this.running = true
    while (this.queue.length > 0) {
      const task = this.queue.shift()!
      try {
        await task()
      } catch (err) {
        console.error('[MessageQueue] Task failed:', err)
      }
    }
    this.running = false
  }

  get size(): number {
    return this.queue.length + (this.running ? 1 : 0)
  }

  get isRunning(): boolean {
    return this.running
  }
}
