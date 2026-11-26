let ctx: AudioContext | null = null

/** Short audio feedback after a scan: high tone = added, low tone = not found. */
export function beep(ok: boolean) {
  try {
    ctx ??= new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 1200 : 300
    osc.type = 'square'
    gain.gain.value = 0.05
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.3))
  } catch {
    /* audio not available – ignore */
  }
}
