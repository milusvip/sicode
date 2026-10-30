/**
 * SiCode: which loopback ports a cold connect tries, and how it learns which of them are up.
 *
 * A connect used to probe the ports one after another with no deadline, then try them one after
 * another over the socket. A port that accepts a connection but never answers therefore held up
 * every later port for as long as the OS kept the request open — seconds, whenever something else
 * had taken that port. This module owns the two parts of that worth pinning down: the order of the
 * candidates, and that a probe which hangs or fails only ever rules its own port out.
 */

/** How long one `/status` probe may take before its port counts as not listening. */
export const PROBE_TIMEOUT_MS = 700

/**
 * The ports to try, in order.
 *
 * The desktop's own ports come first, so a leftover `bun dev` instance cannot take a push meant for
 * the packaged app. The port this extension talked to last comes after them: it is only a hint, and
 * may point at a channel that has since stopped.
 * @param {number} hint the port stored from the last hello
 * @param {readonly number[]} discovery the desktop's ports, most preferred first
 * @returns {number[]}
 */
export function candidatePorts(hint, discovery) {
  const ports = []

  for (const port of [...discovery, hint]) {
    if (Number.isFinite(port) && port > 0 && !ports.includes(port)) ports.push(port)
  }

  return ports
}

/**
 * The ports whose bridge answers, in candidate order.
 *
 * Every port is probed at once and each probe carries its own deadline, so one port that never
 * answers costs that deadline alone — it cannot delay, or hide, the port that would have connected.
 * @param {readonly number[]} ports
 * @param {(port: number, timeoutMs: number) => Promise<boolean>} probe
 * @param {number} [timeoutMs]
 * @returns {Promise<number[]>}
 */
export async function respondingPorts(ports, probe, timeoutMs = PROBE_TIMEOUT_MS) {
  const answers = await Promise.all(
    ports.map(async (port) => {
      try {
        return await probe(port, timeoutMs)
      } catch {
        return false
      }
    }),
  )

  return ports.filter((_, index) => answers[index])
}
