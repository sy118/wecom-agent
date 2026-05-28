export function logStructured(event: string, payload: Record<string, any>): void {
  console.info(JSON.stringify({
    event,
    timestamp: Date.now(),
    ...payload,
  }))
}
